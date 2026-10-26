// Настройки магазина (data/settings.json): значения по умолчанию, валидация
// по секциям, расчёт «открыто/закрыто» по часам работы с учётом часового
// пояса. Всё, что владелец может менять без программиста, живёт здесь.

const crypto = require('crypto');
const { readJson, writeJson, queueWrite } = require('./jsonStore');
const { SETTINGS_FILE, MUNICIPIOS_HABANA, TEMAS } = require('../config');

const ZONA_POR_DEFECTO = 'America/Havana';
const DIAS_ES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const EVENTOS_TELEGRAM = {
  pedido_nuevo: '🆕 Pedido nuevo',
  pedido_cancelado_cliente: '🚫 Cliente cancela su pedido',
  pedido_estado: '🔄 Cambio de estado de un pedido',
  pedido_editado: '✏️ Pedido editado por el admin',
  stock_bajo: '📉 Stock bajo',
  stock_agotado: '⛔ Plato agotado',
  cliente_nuevo: '👤 Cliente nuevo registrado',
  tienda_estado: '🏪 Tienda abierta/cerrada a mano',
  backup: '💾 Copia de seguridad',
  seguridad: '🔐 Inicio de sesión del admin / cambio de contraseña',
  error: '⚠️ Errores del servidor',
  servidor: '🟢 Servidor iniciado',
};

function horarioPorDefecto() {
  const dias = {};
  for (let i = 0; i < 7; i++) dias[i] = { abierto: true, desde: '09:00', hasta: '21:00' };
  return dias;
}

function defaults() {
  const envios = {};
  MUNICIPIOS_HABANA.forEach((m) => { envios[m.id] = 0; });
  const eventos = {};
  Object.keys(EVENTOS_TELEGRAM).forEach((k) => { eventos[k] = true; });
  return {
    tasaCup: 380,
    actualizadoEn: null,
    enviosPorMunicipio: envios,
    tienda: {
      nombre: 'Pechatniky',
      emoji: '🍲',
      eslogan: 'Comida lista, directo a tu puerta',
      descripcion: 'Pide comida lista para entregar, directo desde el menú de Pechatniky.',
      anuncioActivo: false,
      anuncio: '',
      tituloSitio: '', // título de la pestaña del navegador (vacío = nombre — eslogan)
      icono: '', // versión del icono personalizado ('' = el de fábrica)
    },
    contactos: {
      telefono: '',
      whatsapp: '',
      telegram: '',
      instagram: '',
      facebook: '',
      email: '',
      direccion: '',
    },
    horario: {
      activo: true,
      zona: ZONA_POR_DEFECTO,
      cerradoManual: false,
      mensajeCierre: '',
      aceptarFueraDeHorario: true,
      dias: horarioPorDefecto(),
    },
    pedidos: {
      pedidoMinimoCup: 0,
      envioGratisDesdeCup: 0,
      tiempoEstimado: '40–60 min',
      pagos: [
        { id: 'efectivo', nombre: 'Efectivo al recibir', instrucciones: '', activo: true },
        { id: 'transferencia', nombre: 'Transferencia', instrucciones: '', activo: false },
      ],
      stockBajoUmbral: 5,
    },
    apariencia: { temaPorDefecto: 'oscuro' },
    admin: { sonidoPedidoNuevo: true },
    telegram: {
      token: '',
      chatIds: [],
      codigoVinculo: '',
      eventos,
    },
    backup: {
      activo: true,
      frecuenciaHoras: 24,
      conservar: 14,
      incluirImagenes: true,
      telegramActivo: false, // enviar el ZIP de datos al chat de Telegram
      telegramCadaHoras: 24,
      telegramUltimo: null, // lo gestiona el servidor
    },
  };
}

// Mezcla profunda: los objetos se mezclan clave a clave, arrays y valores
// simples del "origen" reemplazan a los del "base".
function mezclar(base, origen) {
  if (origen === undefined || origen === null) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return origen;
  if (typeof origen !== 'object' || Array.isArray(origen)) return base;
  const out = { ...base };
  Object.keys(origen).forEach((k) => {
    out[k] = k in base ? mezclar(base[k], origen[k]) : origen[k];
  });
  return out;
}

function completar(crudo) {
  const base = defaults();
  const { enviosPorProvincia, ...resto } = crudo || {};
  const out = mezclar(base, resto);
  // Municipios nuevos que falten → 0
  MUNICIPIOS_HABANA.forEach(({ id }) => {
    if (out.enviosPorMunicipio[id] === undefined) out.enviosPorMunicipio[id] = 0;
  });
  if (!out.telegram.codigoVinculo) out.telegram.codigoVinculo = nuevoCodigo();
  return out;
}

function nuevoCodigo() {
  return crypto.randomBytes(4).toString('hex'); // 8 caracteres
}

// ---------- Acceso con caché corta ----------
let cache = null;
let cacheHasta = 0;

async function obtener() {
  const ahora = Date.now();
  if (cache && ahora < cacheHasta) return cache;
  const crudo = await readJson(SETTINGS_FILE, {});
  cache = completar(crudo);
  cacheHasta = ahora + 3000;
  return cache;
}

// Aplica `mutar(actual)` → nuevo objeto dentro de la cola de escritura.
async function actualizar(mutar) {
  let resultado = null;
  await queueWrite(async () => {
    const crudo = await readJson(SETTINGS_FILE, {});
    const actual = completar(crudo);
    const nuevo = mutar(actual) || actual;
    nuevo.actualizadoEn = new Date().toISOString();
    await writeJson(SETTINGS_FILE, nuevo);
    cache = nuevo;
    cacheHasta = Date.now() + 3000;
    resultado = nuevo;
  });
  return resultado;
}

function invalidarCache() { cache = null; }

// ---------- Validación por secciones ----------
const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function txt(v, max, errors, etiqueta) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (s.length > max) { errors.push(`${etiqueta} es demasiado largo (máx. ${max} caracteres).`); return s.slice(0, max); }
  return s;
}

function num(v, { min = 0, max = 1e7, etiqueta, entero = false }, errors) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    errors.push(`${etiqueta} debe ser un número entre ${min} y ${max}.`);
    return min;
  }
  return entero ? Math.round(n) : Math.round(n * 100) / 100;
}

function zonaValida(z) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (_) { return false; }
}

function limpiarUsuario(v) {
  return String(v || '').trim().replace(/^@/, '').replace(/^https?:\/\/(t\.me|instagram\.com|www\.instagram\.com)\//i, '').replace(/\/+$/, '');
}

function sanear(parche, actual) {
  const errors = [];
  const out = {};

  if (parche.tasaCup !== undefined) {
    const t = Number(parche.tasaCup);
    if (!Number.isFinite(t) || t <= 0) errors.push('La tasa debe ser un número mayor a 0.');
    else if (t > 1000000) errors.push('Esa tasa parece demasiado alta. Revisa el valor.');
    else out.tasaCup = Math.round(t * 100) / 100;
  }

  if (parche.enviosPorMunicipio !== undefined) {
    const envios = { ...actual.enviosPorMunicipio };
    const src = parche.enviosPorMunicipio;
    if (src === null || typeof src !== 'object') errors.push('El costo de envío no es válido.');
    else {
      MUNICIPIOS_HABANA.forEach(({ id, nombre }) => {
        if (src[id] === undefined) return;
        const n = Number(src[id]);
        if (!Number.isFinite(n) || n < 0) errors.push(`El envío para "${nombre}" debe ser un número mayor o igual a 0.`);
        else if (n > 100000) errors.push(`El envío para "${nombre}" parece demasiado alto. Revisa el valor.`);
        else envios[id] = Math.round(n * 100) / 100;
      });
      out.enviosPorMunicipio = envios;
    }
  }

  if (parche.tienda && typeof parche.tienda === 'object') {
    const p = parche.tienda;
    const t = { ...actual.tienda };
    if (p.nombre !== undefined) { t.nombre = txt(p.nombre, 40, errors, 'El nombre'); if (!t.nombre) errors.push('El nombre de la tienda no puede quedar vacío.'); }
    if (p.emoji !== undefined) t.emoji = txt(p.emoji, 8, errors, 'El emoji') || '🍲';
    if (p.eslogan !== undefined) t.eslogan = txt(p.eslogan, 80, errors, 'El eslogan');
    if (p.descripcion !== undefined) t.descripcion = txt(p.descripcion, 200, errors, 'La descripción');
    if (p.anuncioActivo !== undefined) t.anuncioActivo = Boolean(p.anuncioActivo);
    if (p.anuncio !== undefined) t.anuncio = txt(p.anuncio, 200, errors, 'El anuncio');
    if (p.tituloSitio !== undefined) t.tituloSitio = txt(p.tituloSitio, 60, errors, 'El título del sitio');
    out.tienda = t;
  }

  if (parche.contactos && typeof parche.contactos === 'object') {
    const p = parche.contactos;
    const c = { ...actual.contactos };
    if (p.telefono !== undefined) c.telefono = txt(p.telefono, 30, errors, 'El teléfono');
    if (p.whatsapp !== undefined) c.whatsapp = txt(p.whatsapp, 30, errors, 'El WhatsApp');
    if (p.telegram !== undefined) c.telegram = limpiarUsuario(txt(p.telegram, 60, errors, 'El usuario de Telegram'));
    if (p.instagram !== undefined) c.instagram = limpiarUsuario(txt(p.instagram, 60, errors, 'El usuario de Instagram'));
    if (p.facebook !== undefined) c.facebook = txt(p.facebook, 120, errors, 'El enlace de Facebook');
    if (p.email !== undefined) {
      c.email = txt(p.email, 120, errors, 'El email');
      if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) errors.push('El email de contacto no es válido.');
    }
    if (p.direccion !== undefined) c.direccion = txt(p.direccion, 160, errors, 'La dirección');
    out.contactos = c;
  }

  if (parche.horario && typeof parche.horario === 'object') {
    const p = parche.horario;
    const h = { ...actual.horario, dias: { ...actual.horario.dias } };
    if (p.activo !== undefined) h.activo = Boolean(p.activo);
    if (p.cerradoManual !== undefined) h.cerradoManual = Boolean(p.cerradoManual);
    if (p.aceptarFueraDeHorario !== undefined) h.aceptarFueraDeHorario = Boolean(p.aceptarFueraDeHorario);
    if (p.mensajeCierre !== undefined) h.mensajeCierre = txt(p.mensajeCierre, 160, errors, 'El mensaje de cierre');
    if (p.zona !== undefined) {
      const z = String(p.zona).trim();
      if (!zonaValida(z)) errors.push('La zona horaria no es válida (ejemplo: America/Havana).');
      else h.zona = z;
    }
    if (p.dias && typeof p.dias === 'object') {
      for (let i = 0; i < 7; i++) {
        const d = p.dias[i];
        if (!d || typeof d !== 'object') continue;
        const nuevo = { ...h.dias[i] };
        if (d.abierto !== undefined) nuevo.abierto = Boolean(d.abierto);
        if (d.desde !== undefined) {
          if (!HORA_RE.test(String(d.desde))) errors.push(`La hora de apertura del ${DIAS_ES[i]} no es válida.`);
          else nuevo.desde = String(d.desde);
        }
        if (d.hasta !== undefined) {
          if (!HORA_RE.test(String(d.hasta))) errors.push(`La hora de cierre del ${DIAS_ES[i]} no es válida.`);
          else nuevo.hasta = String(d.hasta);
        }
        h.dias[i] = nuevo;
      }
    }
    out.horario = h;
  }

  if (parche.pedidos && typeof parche.pedidos === 'object') {
    const p = parche.pedidos;
    const o = { ...actual.pedidos };
    if (p.pedidoMinimoCup !== undefined) o.pedidoMinimoCup = num(p.pedidoMinimoCup, { max: 1e6, etiqueta: 'El pedido mínimo' }, errors);
    if (p.envioGratisDesdeCup !== undefined) o.envioGratisDesdeCup = num(p.envioGratisDesdeCup, { max: 1e6, etiqueta: 'El envío gratis desde' }, errors);
    if (p.tiempoEstimado !== undefined) o.tiempoEstimado = txt(p.tiempoEstimado, 40, errors, 'El tiempo estimado');
    if (p.stockBajoUmbral !== undefined) o.stockBajoUmbral = num(p.stockBajoUmbral, { max: 1000, etiqueta: 'El umbral de stock bajo', entero: true }, errors);
    if (Array.isArray(p.pagos)) {
      const vistos = new Set();
      o.pagos = p.pagos.slice(0, 8).map((m, i) => {
        let id = String((m && m.id) || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 30).toLowerCase();
        if (!id || vistos.has(id)) id = `pago_${crypto.randomBytes(3).toString('hex')}`;
        vistos.add(id);
        const nombre = txt(m && m.nombre, 50, errors, 'El nombre del método de pago');
        if (!nombre) errors.push(`El método de pago #${i + 1} necesita un nombre.`);
        return {
          id,
          nombre,
          instrucciones: txt(m && m.instrucciones, 300, errors, 'Las instrucciones de pago'),
          activo: Boolean(m && m.activo),
        };
      });
      if (!o.pagos.some((m) => m.activo)) errors.push('Activa al menos un método de pago.');
    }
    out.pedidos = o;
  }

  if (parche.apariencia && typeof parche.apariencia === 'object') {
    const a = { ...actual.apariencia };
    if (parche.apariencia.temaPorDefecto !== undefined) {
      if (!TEMAS.includes(parche.apariencia.temaPorDefecto)) errors.push('Tema inválido.');
      else a.temaPorDefecto = parche.apariencia.temaPorDefecto;
    }
    out.apariencia = a;
  }

  if (parche.admin && typeof parche.admin === 'object') {
    const a = { ...actual.admin };
    if (parche.admin.sonidoPedidoNuevo !== undefined) a.sonidoPedidoNuevo = Boolean(parche.admin.sonidoPedidoNuevo);
    out.admin = a;
  }

  if (parche.telegram && typeof parche.telegram === 'object') {
    const p = parche.telegram;
    const t = { ...actual.telegram, eventos: { ...actual.telegram.eventos } };
    if (p.token !== undefined && !String(p.token).includes('•')) {
      const tok = String(p.token).trim();
      if (tok && !/^\d{5,}:[\w-]{20,}$/.test(tok)) errors.push('El token de Telegram no tiene el formato correcto (ejemplo: 123456789:AAH…). Cópialo tal cual desde @BotFather.');
      else t.token = tok;
    }
    if (p.eventos && typeof p.eventos === 'object') {
      Object.keys(EVENTOS_TELEGRAM).forEach((k) => {
        if (p.eventos[k] !== undefined) t.eventos[k] = Boolean(p.eventos[k]);
      });
    }
    if (Array.isArray(p.chatIds)) {
      t.chatIds = [...new Set(p.chatIds.map((c) => String(c).trim()).filter((c) => /^-?\d{1,20}$/.test(c)))].slice(0, 10);
    }
    if (p.regenerarCodigo) t.codigoVinculo = nuevoCodigo();
    out.telegram = t;
  }

  if (parche.backup && typeof parche.backup === 'object') {
    const p = parche.backup;
    const b = { ...actual.backup };
    if (p.activo !== undefined) b.activo = Boolean(p.activo);
    if (p.frecuenciaHoras !== undefined) b.frecuenciaHoras = num(p.frecuenciaHoras, { min: 1, max: 24 * 30, etiqueta: 'La frecuencia de copias (horas)', entero: true }, errors);
    if (p.conservar !== undefined) b.conservar = num(p.conservar, { min: 1, max: 365, etiqueta: 'Cuántas copias conservar', entero: true }, errors);
    if (p.incluirImagenes !== undefined) b.incluirImagenes = Boolean(p.incluirImagenes);
    if (p.telegramActivo !== undefined) b.telegramActivo = Boolean(p.telegramActivo);
    if (p.telegramCadaHoras !== undefined) b.telegramCadaHoras = num(p.telegramCadaHoras, { min: 1, max: 24 * 30, etiqueta: 'La frecuencia de envío por Telegram (horas)', entero: true }, errors);
    out.backup = b;
  }

  return { errors, value: out };
}

// ---------- Vistas ----------
function mascara(token) {
  if (!token) return '';
  return `••••••••${token.slice(-4)}`;
}

// Para el panel de admin: todo, con el token enmascarado.
function paraAdmin(a) {
  return { ...a, telegram: { ...a.telegram, token: mascara(a.telegram.token), tokenConfigurado: Boolean(a.telegram.token) } };
}

// Para clientes: solo lo que la tienda necesita mostrar.
function paraPublico(a, estado) {
  const pagos = a.pedidos.pagos.filter((m) => m.activo).map(({ id, nombre, instrucciones }) => ({ id, nombre, instrucciones }));
  return {
    tienda: a.tienda,
    contactos: a.contactos,
    horario: { activo: a.horario.activo, dias: a.horario.dias, aceptarFueraDeHorario: a.horario.aceptarFueraDeHorario },
    estado,
    pedidos: {
      pedidoMinimoCup: a.pedidos.pedidoMinimoCup,
      envioGratisDesdeCup: a.pedidos.envioGratisDesdeCup,
      tiempoEstimado: a.pedidos.tiempoEstimado,
      pagos,
    },
    apariencia: a.apariencia,
  };
}

// ---------- Hora local y horario de trabajo ----------
function partesLocales(fecha, zona) {
  let z = zona;
  if (!zonaValida(z)) z = ZONA_POR_DEFECTO;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: z, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = {};
  fmt.formatToParts(fecha).forEach((x) => { p[x.type] = x.value; });
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    dow,
    minutos: Number(p.hour) * 60 + Number(p.minute),
    hora: `${p.hour}:${p.minute}`,
  };
}

function aMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function hoyLocal(a, ahora = new Date()) {
  return partesLocales(ahora, a.horario.zona).fecha;
}

// ¿Está dentro de la ventana del día `dow` (o de la ventana nocturna del día anterior)?
function ventanaActual(a, loc) {
  const dias = a.horario.dias;
  const hoy = dias[loc.dow];
  if (hoy && hoy.abierto) {
    const d = aMinutos(hoy.desde);
    const h = aMinutos(hoy.hasta);
    if (h > d) {
      if (loc.minutos >= d && loc.minutos < h) return { hasta: hoy.hasta };
    } else if (loc.minutos >= d) {
      return { hasta: hoy.hasta }; // cruza medianoche
    }
  }
  const ayer = dias[(loc.dow + 6) % 7];
  if (ayer && ayer.abierto) {
    const d = aMinutos(ayer.desde);
    const h = aMinutos(ayer.hasta);
    if (h <= d && loc.minutos < h) return { hasta: ayer.hasta };
  }
  return null;
}

function proximaApertura(a, loc, desdeManana) {
  for (let off = desdeManana ? 1 : 0; off <= 7; off++) {
    const dow = (loc.dow + off) % 7;
    const d = a.horario.dias[dow];
    if (!d || !d.abierto) continue;
    if (off === 0 && aMinutos(d.desde) <= loc.minutos) continue;
    return { offset: off, dow, hora: d.desde };
  }
  return null;
}

function textoDia(offset, dow) {
  if (offset === 0) return 'hoy';
  if (offset === 1) return 'mañana';
  return `el ${DIAS_ES[dow]}`;
}

// Resultado: { abierto, manual, cierraA, proxima, texto, textoEntrega }
function estadoTienda(a, ahora = new Date()) {
  const h = a.horario;
  const loc = partesLocales(ahora, h.zona);

  if (h.cerradoManual) {
    const prox = proximaApertura(a, loc, true);
    return {
      abierto: false, manual: true, cierraA: null, proxima: prox,
      texto: h.mensajeCierre || 'Cerrado por hoy',
      textoEntrega: prox ? `${textoDia(prox.offset, prox.dow)} a partir de las ${prox.hora}` : 'en cuanto volvamos a abrir',
      ...ahoraLocal(loc),
    };
  }
  if (!h.activo) {
    return { abierto: true, manual: false, cierraA: null, proxima: null, texto: 'Abierto', textoEntrega: '', ...ahoraLocal(loc) };
  }
  const v = ventanaActual(a, loc);
  if (v) {
    return { abierto: true, manual: false, cierraA: v.hasta, proxima: null, texto: `Abierto hasta las ${v.hasta}`, textoEntrega: '', ...ahoraLocal(loc) };
  }
  const prox = proximaApertura(a, loc, false);
  const cuando = prox ? `${textoDia(prox.offset, prox.dow)} a partir de las ${prox.hora}` : 'en cuanto volvamos a abrir';
  return {
    abierto: false, manual: false, cierraA: null, proxima: prox,
    texto: prox ? `Cerrado · abrimos ${cuando}` : 'Cerrado',
    textoEntrega: cuando,
    ...ahoraLocal(loc),
  };
}

function ahoraLocal(loc) {
  return { fechaLocal: loc.fecha, horaLocal: loc.hora };
}

module.exports = {
  EVENTOS_TELEGRAM, DIAS_ES,
  defaults, obtener, actualizar, invalidarCache, sanear, paraAdmin, paraPublico,
  estadoTienda, hoyLocal, partesLocales, nuevoCodigo,
};
