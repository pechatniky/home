// Telegram-бот: уведомления о ВСЕХ событиях + меню управления магазином.
// Токен и привязанные чаты задаются в Настройках админа. Работает через
// long-polling (getUpdates) — не нужен ни домен, ни HTTPS, ни открытый порт.
// Адрес API можно подменить переменной TELEGRAM_API_BASE (для тестов).
//
// Правила устойчивости: любая ошибка сети/API ловится, polling перезапускается
// с нарастающей паузой, а неверный токен останавливает бота без цикла.

const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { PRODUCTS_FILE, ORDERS_FILE } = require('../config');
const Ajustes = require('../lib/ajustes');
const { suscribir } = require('../lib/eventos');
const Pedidos = require('./pedidos');
const Stats = require('./stats');
const Backup = require('./backup');

const API_BASE = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');

const estado = {
  token: '',
  corriendo: false,
  generacion: 0,
  offset: 0,
  usuario: null, // @nombre del bot
  error: null,
  ultimoOk: null,
  abort: null,
};

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cup = (n) => `${Number.isInteger(n) ? n : Number(n).toFixed(2)} CUP`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Llamadas a la API ----------
async function api(metodo, cuerpo = {}, { timeoutMs = 15000, token } = {}) {
  const tk = token || estado.token;
  if (!tk) throw new Error('Sin token');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  if (metodo === 'getUpdates') estado.abort = ctl;
  try {
    const res = await fetch(`${API_BASE}/bot${tk}/${metodo}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      signal: ctl.signal,
    });
    let datos = null;
    try { datos = await res.json(); } catch (_) { /* respuesta no JSON */ }
    if (!datos || !datos.ok) {
      const e = new Error((datos && datos.description) || `HTTP ${res.status}`);
      e.codigo = (datos && datos.error_code) || res.status;
      e.reintentar = datos && datos.parameters && datos.parameters.retry_after;
      throw e;
    }
    return datos.result;
  } finally {
    clearTimeout(t);
    if (estado.abort === ctl) estado.abort = null;
  }
}

// Cola de envío secuencial (Telegram limita ~1 mensaje/s por chat).
const cola = [];
let procesando = false;

function encolar(trabajo) {
  cola.push(trabajo);
  if (!procesando) procesarCola();
}

async function procesarCola() {
  procesando = true;
  while (cola.length) {
    const t = cola.shift();
    try {
      await t();
    } catch (err) {
      console.error('Telegram: no se pudo enviar mensaje:', err.message);
    }
    await dormir(80);
  }
  procesando = false;
}

async function enviarConReintento(metodo, cuerpo) {
  try {
    return await api(metodo, cuerpo);
  } catch (err) {
    if (err.codigo === 429 && err.reintentar) {
      await dormir(Math.min(err.reintentar, 30) * 1000);
      return api(metodo, cuerpo);
    }
    throw err;
  }
}

function recortar(texto) {
  return texto.length > 3900 ? `${texto.slice(0, 3900)}…` : texto;
}

function enviar(chatId, texto, botones) {
  encolar(() => enviarConReintento('sendMessage', {
    chat_id: chatId,
    text: recortar(texto),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}),
  }));
}

async function editar(chatId, messageId, texto, botones) {
  try {
    await api('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: recortar(texto),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: botones || [] },
    });
  } catch (err) {
    if (!/not modified/i.test(err.message)) {
      // Si no se puede editar (mensaje viejo), mandamos uno nuevo
      enviar(chatId, texto, botones);
    }
  }
}

async function chatsAutorizados() {
  const a = await Ajustes.obtener();
  return a.telegram.chatIds;
}

async function notificar(texto, botones, { excepto } = {}) {
  const chats = await chatsAutorizados();
  chats.filter((c) => String(c) !== String(excepto)).forEach((c) => enviar(c, texto, botones));
}

// ---------- Formato de pedidos ----------
function textoPedido(p) {
  const l = [];
  const etiqueta = Pedidos.ETIQUETA_ESTADO[p.estado] || p.estado;
  l.push(`🧾 <b>Pedido #${p.numero || '?'}</b> — ${esc(etiqueta)}`);
  if (p.fueraDeHorario) l.push('🌙 <i>Fuera de horario — entrega diferida</i>');
  l.push(`👤 ${esc(p.cliente.nombre)} · ${esc(p.cliente.telefono)}`);
  l.push(`📍 ${esc(Pedidos.nombreMunicipio(p.cliente.municipio))} · ${esc(p.cliente.direccion)}`);
  if (p.cliente.ubicacion) {
    const { lat, lng } = p.cliente.ubicacion;
    l.push(`🗺 <a href="https://www.openstreetmap.org/?mlat=${lat}&amp;mlon=${lng}#map=17/${lat}/${lng}">Ver en el mapa</a>`);
  }
  l.push('');
  p.items.forEach((it) => l.push(`• ${it.cantidad}× ${esc(it.nombre)} — ${cup(it.precio * it.cantidad)}`));
  l.push('');
  l.push(`Subtotal ${cup(p.totalCup)} + envío ${cup(p.envioCup || 0)}${p.envioGratis ? ' (gratis)' : ''}`);
  l.push(`💵 <b>Total ${cup(p.totalConEnvioCup)}</b>`);
  if (p.metodoPago) l.push(`💳 ${esc(p.metodoPago.nombre)}`);
  if (p.cliente.nota) l.push(`📝 ${esc(p.cliente.nota)}`);
  if (p.notaAdmin) l.push(`🔒 ${esc(p.notaAdmin)}`);
  return l.join('\n');
}

function botonesPedido(p) {
  const id = p.id;
  const fila = [];
  if (p.estado === 'nuevo') fila.push({ text: '👨‍🍳 En preparación', callback_data: `o:${id}:p` });
  if (p.estado === 'en_preparacion') fila.push({ text: '🚚 Enviado', callback_data: `o:${id}:e` });
  if (p.estado === 'enviado') fila.push({ text: '✅ Completado', callback_data: `o:${id}:c` });
  const filas = [];
  if (fila.length) filas.push(fila);
  const f2 = [];
  if (p.estado !== 'cancelado' && p.estado !== 'completado') f2.push({ text: '❌ Cancelar', callback_data: `o:${id}:x` });
  f2.push({ text: '🔄', callback_data: `o:${id}:v` });
  filas.push(f2);
  return filas;
}

// ---------- Formateo de eventos ----------
function formatearEvento(tipo, d) {
  switch (tipo) {
    case 'pedido_nuevo':
      return { texto: `🆕 <b>¡Pedido nuevo!</b>\n\n${textoPedido(d.pedido)}`, botones: botonesPedido(d.pedido) };
    case 'pedido_cancelado_cliente':
      return { texto: `🚫 <b>El cliente canceló el pedido #${d.pedido.numero}</b>\n${esc(d.pedido.cliente.nombre)} · ${cup(d.pedido.totalConEnvioCup)}` };
    case 'pedido_estado': {
      const p = d.pedido;
      if (d.cancelado) return { texto: `🚫 Pedido #${p.numero} cancelado (${esc(d.actor)})\n${esc(p.cliente.nombre)} · ${cup(p.totalConEnvioCup)}` };
      return { texto: `🔄 Pedido #${p.numero}: ${esc(Pedidos.ETIQUETA_ESTADO[d.anterior])} → <b>${esc(Pedidos.ETIQUETA_ESTADO[p.estado])}</b>\n${esc(p.cliente.nombre)} (${esc(d.actor)})` };
    }
    case 'pedido_editado':
      return { texto: `✏️ Pedido #${d.pedido.numero} editado (${esc(d.actor)})\n${esc(d.resumen.join('; '))}\nNuevo total: <b>${cup(d.pedido.totalConEnvioCup)}</b>` };
    case 'stock_bajo':
      return { texto: `📉 Stock bajo: <b>${esc(d.producto.nombre)}</b> — quedan ${d.quedan}` };
    case 'stock_agotado':
      return { texto: `⛔ Se agotó: <b>${esc(d.producto.nombre)}</b>` };
    case 'cliente_nuevo':
      return { texto: `👤 Cliente nuevo: <b>${esc(d.cliente.nombre)}</b>\n${esc(d.cliente.email)} · ${esc(d.cliente.telefono)}` };
    case 'tienda_estado':
      return { texto: d.cerrado ? `🔴 Tienda <b>cerrada</b> a mano (${esc(d.actor)})` : `🟢 Tienda <b>abierta</b> de nuevo (${esc(d.actor)})` };
    case 'backup':
      return { texto: d.ok ? `💾 Copia de seguridad lista: <code>${esc(d.nombre)}</code> (${Math.round(d.tamano / 1024)} KB)${d.manual ? '' : ' · automática'}` : `❌ Falló la copia de seguridad: ${esc(d.error)}` };
    case 'seguridad':
      return { texto: `🔐 ${esc(d.mensaje)}` };
    case 'error':
      return { texto: `⚠️ <b>Error del servidor</b>\n<code>${esc(String(d.mensaje).slice(0, 600))}</code>` };
    case 'servidor':
      return { texto: `🟢 Servidor iniciado${d.reinicio ? ` (reinicio #${d.reinicio})` : ''}` };
    default:
      return null;
  }
}

let ultimoError = 0;
async function alEvento(tipo, datos) {
  try {
    if (!estado.corriendo) return;
    const a = await Ajustes.obtener();
    if (a.telegram.eventos[tipo] === false) return;
    if (tipo === 'error') {
      if (Date.now() - ultimoError < 60000) return; // máx. 1 por minuto
      ultimoError = Date.now();
    }
    const f = formatearEvento(tipo, datos);
    if (!f) return;
    const actor = String(datos.actor || '');
    const excepto = actor.startsWith('telegram:') ? actor.slice(9) : null;
    await notificar(f.texto, f.botones, { excepto });
  } catch (err) {
    console.error('Telegram: error al procesar evento', tipo, err.message);
  }
}

// ---------- Menú ----------
async function menuPrincipal() {
  const a = await Ajustes.obtener();
  const est = Ajustes.estadoTienda(a);
  const tiendaTxt = est.abierto ? '🟢 Tienda abierta · cerrar' : (a.horario.cerradoManual ? '🔴 Cerrada a mano · abrir' : '🔴 Fuera de horario');
  return {
    texto: `📋 <b>${esc(a.tienda.nombre)}</b> — menú de control\n${esc(est.texto)}`,
    botones: [
      [{ text: '🆕 Nuevos', callback_data: 'm:nuevos' }, { text: '🔥 Activos', callback_data: 'm:activos' }],
      [{ text: '📊 Hoy', callback_data: 'm:hoy' }, { text: '📅 7 días', callback_data: 'm:semana' }],
      [{ text: '📦 Stock', callback_data: 'm:stock' }, { text: tiendaTxt, callback_data: 'm:tienda' }],
      [{ text: '💾 Copia ahora', callback_data: 'm:backup' }, { text: '🔔 Avisos', callback_data: 'm:avisos' }],
      [{ text: 'ℹ️ Estado del servidor', callback_data: 'm:estado' }],
    ],
  };
}

const VOLVER = [[{ text: '⬅️ Menú', callback_data: 'm:menu' }]];

async function pedidosPorEstados(estados) {
  const pedidos = await readJson(ORDERS_FILE, []);
  return pedidos.filter((p) => estados.includes(p.estado)).sort((a, b) => new Date(a.creadoEn) - new Date(b.creadoEn));
}

async function enviarListaPedidos(chat, titulo, estados) {
  const lista = await pedidosPorEstados(estados);
  if (!lista.length) { enviar(chat, `${titulo}\n\nNo hay pedidos. 🎉`, VOLVER); return; }
  const filas = lista.slice(0, 15).map((p) => [{
    text: `#${p.numero} ${p.cliente.nombre} · ${cup(p.totalConEnvioCup)} · ${Pedidos.ETIQUETA_ESTADO[p.estado]}`.slice(0, 60),
    callback_data: `o:${p.id}:v`,
  }]);
  filas.push(...VOLVER);
  enviar(chat, `${titulo} (${lista.length})${lista.length > 15 ? '\nMostrando los 15 más antiguos.' : ''}`, filas);
}

function textoStats(s, titulo) {
  const l = [`📊 <b>${titulo}</b>`];
  l.push(`Pedidos: <b>${s.pedidos}</b>${s.cancelados ? ` (+${s.cancelados} cancelados)` : ''}`);
  l.push(`Ingresos: <b>${cup(s.ingresos)}</b> (platos ${cup(s.ingresosPlatos)} + envíos ${cup(s.ingresosEnvio)})`);
  l.push(`Ticket promedio: ${cup(s.ticketPromedio)}`);
  l.push(`Clientes activos: ${s.clientesActivos} · nuevos: ${s.clientesNuevos}`);
  if (s.topPlatos.length) {
    l.push('', '<b>Más pedidos:</b>');
    s.topPlatos.slice(0, 5).forEach((p) => l.push(`• ${esc(p.nombre)} ×${p.cantidad}`));
  }
  return l.join('\n');
}

async function enviarStock(chat, mensajeId) {
  const productos = await Pedidos.leerProductos();
  const a = await Ajustes.obtener();
  const umbral = a.pedidos.stockBajoUmbral;
  const interesantes = productos.filter((p) => !p.disponible || (Pedidos.tieneStock(p) && p.stock <= umbral));
  const l = ['📦 <b>Stock y disponibilidad</b>', ''];
  if (!interesantes.length) l.push('Todo en orden: ningún plato agotado ni con poco stock.');
  interesantes.slice(0, 12).forEach((p) => {
    const st = Pedidos.tieneStock(p) ? ` · quedan ${p.stock}` : '';
    l.push(`${p.disponible ? '🟢' : '🔴'} ${esc(p.nombre)}${st}`);
  });
  const filas = interesantes.slice(0, 12).map((p) => [{
    text: `${p.disponible ? '⏸ Ocultar' : '▶️ Mostrar'}: ${p.nombre}`.slice(0, 60),
    callback_data: `p:${p.id}:t`,
  }]);
  filas.push(...VOLVER);
  if (mensajeId) await editar(chat, mensajeId, l.join('\n'), filas); else enviar(chat, l.join('\n'), filas);
}

async function enviarAvisos(chat, mensajeId) {
  const a = await Ajustes.obtener();
  const filas = Object.entries(Ajustes.EVENTOS_TELEGRAM).map(([k, etiqueta]) => [{
    text: `${a.telegram.eventos[k] === false ? '🔕' : '🔔'} ${etiqueta}`.slice(0, 60),
    callback_data: `a:${k}`,
  }]);
  filas.push(...VOLVER);
  const texto = '🔔 <b>Avisos</b>\nToca para activar o desactivar cada tipo de notificación:';
  if (mensajeId) await editar(chat, mensajeId, texto, filas); else enviar(chat, texto, filas);
}

async function estadoServidor() {
  const a = await Ajustes.obtener();
  const backups = await Backup.listar();
  const pedidos = await readJson(ORDERS_FILE, []);
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  const seg = Math.round(process.uptime());
  const up = seg > 3600 ? `${Math.floor(seg / 3600)} h ${Math.floor((seg % 3600) / 60)} min` : `${Math.floor(seg / 60)} min`;
  return [
    'ℹ️ <b>Estado del servidor</b>',
    `En marcha: ${up}`,
    `Memoria: ${mem} MB`,
    `Pedidos guardados: ${pedidos.length}`,
    `Última copia: ${backups[0] ? new Date(backups[0].creadoEn).toLocaleString('es') : 'ninguna'}`,
    `Copias automáticas: ${a.backup.activo ? `cada ${a.backup.frecuenciaHoras} h` : 'desactivadas'}`,
  ].join('\n');
}

// ---------- Entrada de mensajes ----------
async function vincularChat(chatId) {
  await Ajustes.actualizar((a) => {
    if (!a.telegram.chatIds.includes(String(chatId))) a.telegram.chatIds.push(String(chatId));
    return a;
  });
}

async function alMensaje(msg) {
  const chat = String(msg.chat.id);
  const texto = String(msg.text || '').trim();
  if (!texto.startsWith('/')) return;
  const [comandoCrudo, ...resto] = texto.split(/\s+/);
  const comando = comandoCrudo.split('@')[0].toLowerCase();
  const arg = resto.join(' ');

  const a = await Ajustes.obtener();
  const autorizado = a.telegram.chatIds.includes(chat);

  if (comando === '/start' || comando === '/vincular') {
    if (!autorizado) {
      if (arg && arg === a.telegram.codigoVinculo) {
        await vincularChat(chat);
        enviar(chat, '✅ <b>¡Listo!</b> Este chat quedó vinculado. Recibirás aquí los avisos de la tienda. Usa /menu para controlarla.');
        const m = await menuPrincipal();
        enviar(chat, m.texto, m.botones);
        return;
      }
      enviar(chat, '🔒 Este chat no está vinculado.\nEn el panel: Ajustes → Telegram, copia el código y envíame:\n<code>/start CÓDIGO</code>');
      return;
    }
  }

  if (!autorizado) {
    enviar(chat, '🔒 Este chat no está vinculado. Envía <code>/start CÓDIGO</code> (lo ves en Ajustes → Telegram).');
    return;
  }

  switch (comando) {
    case '/start':
    case '/menu': {
      const m = await menuPrincipal();
      enviar(chat, m.texto, m.botones);
      break;
    }
    case '/nuevos': await enviarListaPedidos(chat, '🆕 <b>Pedidos nuevos</b>', ['nuevo']); break;
    case '/activos': await enviarListaPedidos(chat, '🔥 <b>Pedidos activos</b>', ['nuevo', 'en_preparacion', 'enviado']); break;
    case '/hoy': enviar(chat, textoStats(await Stats.calcular('hoy'), 'Hoy'), VOLVER); break;
    case '/semana': enviar(chat, textoStats(await Stats.calcular('7d'), 'Últimos 7 días'), VOLVER); break;
    case '/stock': await enviarStock(chat); break;
    case '/avisos': await enviarAvisos(chat); break;
    case '/estado': enviar(chat, await estadoServidor(), VOLVER); break;
    case '/abrir':
    case '/cerrar': {
      const cerrar = comando === '/cerrar';
      await Ajustes.actualizar((x) => { x.horario.cerradoManual = cerrar; return x; });
      require('../lib/eventos').emitir('tienda_estado', { cerrado: cerrar, actor: `telegram:${chat}` });
      enviar(chat, cerrar ? '🔴 Tienda cerrada a mano. Los clientes verán el aviso de cierre.' : '🟢 Tienda abierta (sigue el horario normal).', VOLVER);
      break;
    }
    case '/backup': await hacerBackup(chat); break;
    case '/desvincular':
      await Ajustes.actualizar((x) => { x.telegram.chatIds = x.telegram.chatIds.filter((c) => c !== chat); return x; });
      enviar(chat, '👋 Chat desvinculado. Ya no recibirás avisos aquí.');
      break;
    default:
      enviar(chat, 'Comandos: /menu /nuevos /activos /hoy /semana /stock /abrir /cerrar /backup /avisos /estado /desvincular', VOLVER);
  }
}

async function hacerBackup(chat) {
  enviar(chat, '💾 Creando copia de seguridad…');
  try {
    await Backup.crear({ manual: true });
    await Backup.enviarATelegram({ chats: [chat], manual: true });
  } catch (err) {
    enviar(chat, `❌ No se pudo crear la copia: ${esc(err.message)}`);
  }
}

async function alCallback(cb) {
  const chat = String(cb.message.chat.id);
  const mid = cb.message.message_id;
  const a = await Ajustes.obtener();
  if (!a.telegram.chatIds.includes(chat)) {
    await api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Chat no autorizado', show_alert: true }).catch(() => {});
    return;
  }
  const [tipo, x, y] = String(cb.data || '').split(':');
  let aviso = '';

  try {
    if (tipo === 'm') {
      if (x === 'menu') { const m = await menuPrincipal(); await editar(chat, mid, m.texto, m.botones); }
      else if (x === 'nuevos') await enviarListaPedidos(chat, '🆕 <b>Pedidos nuevos</b>', ['nuevo']);
      else if (x === 'activos') await enviarListaPedidos(chat, '🔥 <b>Pedidos activos</b>', ['nuevo', 'en_preparacion', 'enviado']);
      else if (x === 'hoy') enviar(chat, textoStats(await Stats.calcular('hoy'), 'Hoy'), VOLVER);
      else if (x === 'semana') enviar(chat, textoStats(await Stats.calcular('7d'), 'Últimos 7 días'), VOLVER);
      else if (x === 'stock') await enviarStock(chat, mid);
      else if (x === 'avisos') await enviarAvisos(chat, mid);
      else if (x === 'estado') enviar(chat, await estadoServidor(), VOLVER);
      else if (x === 'backup') await hacerBackup(chat);
      else if (x === 'tienda') {
        const est = Ajustes.estadoTienda(a);
        const cerrar = est.abierto; // si está abierta → cerrar; si no → quitar cierre manual
        await Ajustes.actualizar((z) => { z.horario.cerradoManual = cerrar; return z; });
        require('../lib/eventos').emitir('tienda_estado', { cerrado: cerrar, actor: `telegram:${chat}` });
        aviso = cerrar ? 'Tienda cerrada' : 'Cierre manual quitado';
        const m = await menuPrincipal();
        await editar(chat, mid, m.texto, m.botones);
      }
    } else if (tipo === 'o') {
      const actor = `telegram:${chat}`;
      let pedido;
      if (y === 'v') {
        pedido = (await readJson(ORDERS_FILE, [])).find((p) => p.id === x);
        if (!pedido) aviso = 'El pedido ya no existe';
        else enviar(chat, textoPedido(pedido), botonesPedido(pedido));
      } else if (y === 'x') {
        pedido = (await readJson(ORDERS_FILE, [])).find((p) => p.id === x);
        if (pedido) {
          await editar(chat, mid, `${textoPedido(pedido)}\n\n❓ <b>¿Cancelar este pedido?</b>`, [[
            { text: '✅ Sí, cancelar', callback_data: `o:${x}:X` },
            { text: '↩️ No', callback_data: `o:${x}:v2` },
          ]]);
        }
      } else if (y === 'v2') {
        pedido = (await readJson(ORDERS_FILE, [])).find((p) => p.id === x);
        if (pedido) await editar(chat, mid, textoPedido(pedido), botonesPedido(pedido));
      } else {
        const mapa = { p: 'en_preparacion', e: 'enviado', c: 'completado' };
        if (y === 'X') pedido = await Pedidos.cancelar(x, actor);
        else if (mapa[y]) pedido = await Pedidos.cambiarEstado(x, mapa[y], actor);
        if (pedido) {
          await editar(chat, mid, textoPedido(pedido), botonesPedido(pedido));
          aviso = `Pedido #${pedido.numero}: ${Pedidos.ETIQUETA_ESTADO[pedido.estado]}`;
        }
      }
    } else if (tipo === 'p' && y === 't') {
      let nombre = '';
      let nuevo = false;
      await queueWrite(async () => {
        const productos = await readJson(PRODUCTS_FILE, []);
        const prod = productos.find((p) => p.id === x);
        if (!prod) return;
        prod.disponible = !prod.disponible;
        nombre = prod.nombre;
        nuevo = prod.disponible;
        await writeJson(PRODUCTS_FILE, productos);
      });
      aviso = nombre ? `${nombre}: ${nuevo ? 'visible' : 'oculto'}` : 'Plato no encontrado';
      await enviarStock(chat, mid);
    } else if (tipo === 'a') {
      await Ajustes.actualizar((z) => { z.telegram.eventos[x] = z.telegram.eventos[x] === false; return z; });
      await enviarAvisos(chat, mid);
    }
  } catch (err) {
    aviso = err.esNegocio ? err.message : 'Ocurrió un error';
    if (!err.esNegocio) console.error('Telegram callback:', err);
  }
  await api('answerCallbackQuery', { callback_query_id: cb.id, ...(aviso ? { text: aviso.slice(0, 190) } : {}) }).catch(() => {});
}

async function procesarActualizacion(u) {
  try {
    if (u.message) await alMensaje(u.message);
    else if (u.callback_query) await alCallback(u.callback_query);
  } catch (err) {
    console.error('Telegram: error procesando actualización:', err);
  }
}

// ---------- Bucle de polling ----------
async function bucle(generacion) {
  let espera = 2000;
  while (estado.corriendo && estado.generacion === generacion) {
    try {
      const lote = await api('getUpdates', { offset: estado.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: 35000 });
      estado.error = null;
      estado.ultimoOk = Date.now();
      espera = 2000;
      for (const u of lote) {
        estado.offset = u.update_id + 1;
        await procesarActualizacion(u);
      }
    } catch (err) {
      if (!estado.corriendo || estado.generacion !== generacion) return;
      if (err.name === 'AbortError' && estado.abort === null && !estado.corriendo) return;
      if (err.codigo === 401 || err.codigo === 404) {
        estado.error = 'Token inválido: revisa el token en Ajustes → Telegram.';
        estado.corriendo = false;
        console.error('Telegram: token inválido, bot detenido.');
        return;
      }
      estado.error = err.codigo === 409 ? 'Otro programa está usando este bot (conflicto 409). Cierra la otra instancia.' : `Sin conexión con Telegram: ${err.message}`;
      if (err.codigo !== 409 || espera >= 30000) console.warn('Telegram:', estado.error);
      await dormir(espera);
      espera = Math.min(espera * 2, 60000);
    }
  }
}

async function iniciar() {
  try {
    const a = await Ajustes.obtener();
    const token = a.telegram.token;
    if (estado.corriendo && estado.token === token) return;
    detener();
    if (!token) { estado.error = null; estado.usuario = null; return; }

    estado.token = token;
    estado.error = null;
    estado.generacion += 1;
    const gen = estado.generacion;

    try {
      const yo = await api('getMe', {}, { timeoutMs: 10000 });
      estado.usuario = yo.username;
    } catch (err) {
      if (err.codigo === 401 || err.codigo === 404) {
        estado.error = 'Token inválido: revisa el token en Ajustes → Telegram.';
        estado.corriendo = false;
        return;
      }
      estado.error = `Sin conexión con Telegram: ${err.message}`;
    }
    estado.corriendo = true;
    api('setMyCommands', {
      commands: [
        { command: 'menu', description: 'Menú de control' },
        { command: 'nuevos', description: 'Pedidos nuevos' },
        { command: 'activos', description: 'Pedidos activos' },
        { command: 'hoy', description: 'Resumen de hoy' },
        { command: 'stock', description: 'Stock y disponibilidad' },
        { command: 'abrir', description: 'Abrir la tienda' },
        { command: 'cerrar', description: 'Cerrar la tienda' },
        { command: 'backup', description: 'Copia de seguridad ahora' },
        { command: 'avisos', description: 'Activar/desactivar avisos' },
        { command: 'estado', description: 'Estado del servidor' },
      ],
    }).catch(() => {});
    bucle(gen).catch((err) => console.error('Telegram: el bucle terminó:', err));
    console.log(`🤖 Telegram conectado${estado.usuario ? ` como @${estado.usuario}` : ''}.`);
  } catch (err) {
    console.error('Telegram: no se pudo iniciar:', err.message);
  }
}

function detener() {
  estado.corriendo = false;
  estado.generacion += 1;
  if (estado.abort) { try { estado.abort.abort(); } catch (_) { /* ignorar */ } }
}

async function reiniciar() {
  detener();
  estado.token = '';
  await iniciar();
}

async function estadoPublico() {
  const a = await Ajustes.obtener();
  return {
    configurado: Boolean(a.telegram.token),
    activo: estado.corriendo,
    bot: estado.usuario,
    error: estado.error,
    codigoVinculo: a.telegram.codigoVinculo,
    enlace: estado.usuario ? `https://t.me/${estado.usuario}?start=${a.telegram.codigoVinculo}` : null,
    chatIds: a.telegram.chatIds,
  };
}

// Envía un archivo (multipart) a una lista de chats. Devuelve cuántos lo recibieron.
async function enviarDocumento(chats, buffer, nombreArchivo, caption) {
  if (!estado.token) throw new Error('Sin token');
  let ok = 0;
  let ultimoError = null;
  for (const chat of chats) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 120000);
    try {
      const form = new FormData();
      form.append('chat_id', String(chat));
      if (caption) form.append('caption', caption.slice(0, 1000));
      form.append('document', new Blob([buffer], { type: 'application/zip' }), nombreArchivo);
      const res = await fetch(`${API_BASE}/bot${estado.token}/sendDocument`, { method: 'POST', body: form, signal: ctl.signal });
      let datos = null;
      try { datos = await res.json(); } catch (_) { /* no JSON */ }
      if (datos && datos.ok) ok += 1;
      else ultimoError = (datos && datos.description) || `HTTP ${res.status}`;
    } catch (err) {
      ultimoError = err.name === 'AbortError' ? 'tiempo de espera agotado' : err.message;
    } finally { clearTimeout(t); }
  }
  if (!ok && ultimoError) throw new Error(`Telegram: ${ultimoError}`);
  return ok;
}

async function enviarPrueba() {
  const a = await Ajustes.obtener();
  if (!a.telegram.token) throw new Error('Primero guarda el token del bot.');
  if (!a.telegram.chatIds.length) throw new Error('Todavía no hay ningún chat vinculado. Abre el bot en Telegram y envía /start con el código.');
  if (!estado.corriendo) throw new Error(estado.error || 'El bot no está conectado.');
  await Promise.all(a.telegram.chatIds.map((c) => enviarConReintento('sendMessage', { chat_id: c, text: '✅ Prueba de notificación: todo funciona.\nUsa /menu para controlar la tienda.' })));
}

suscribir((tipo, datos) => { alEvento(tipo, datos); });

module.exports = { iniciar, detener, reiniciar, estadoPublico, enviarPrueba, enviarDocumento };
