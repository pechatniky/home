// Бизнес-логика заказов и остатков. Здесь все изменения заказов — чтобы
// веб-панель, магазин и Telegram-бот работали по одним и тем же правилам
// (проверки, склад, история, уведомления).

const crypto = require('crypto');
const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { PRODUCTS_FILE, ORDERS_FILE, MUNICIPIOS_HABANA } = require('../config');
const Ajustes = require('../lib/ajustes');
const { emitir } = require('../lib/eventos');

class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.status = status;
    this.esNegocio = true;
  }
}

const redondear = (n) => Math.round(n * 100) / 100;
const tieneStock = (p) => p.stock !== null && p.stock !== undefined;

// ---------- Остатки: ежедневное пополнение ----------
// "reponerDiario": cada día (по часовому поясу магазина) остаток возвращается
// к этому числу. Делается лениво — при первом обращении нового дня.
function aplicarReposicion(productos, hoy) {
  let cambio = false;
  productos.forEach((p) => {
    if (p.reponerDiario !== null && p.reponerDiario !== undefined && p.stockFecha !== hoy) {
      p.stock = p.reponerDiario;
      p.stockFecha = hoy;
      cambio = true;
    }
  });
  return cambio;
}

async function leerProductos() {
  const ajustes = await Ajustes.obtener();
  const hoy = Ajustes.hoyLocal(ajustes);
  let productos = await readJson(PRODUCTS_FILE, []);
  if (productos.some((p) => p.reponerDiario !== null && p.reponerDiario !== undefined && p.stockFecha !== hoy)) {
    await queueWrite(async () => {
      productos = await readJson(PRODUCTS_FILE, []);
      if (aplicarReposicion(productos, hoy)) await writeJson(PRODUCTS_FILE, productos);
    });
  }
  return productos;
}

// Проверка порога остатков после списания → события для Telegram.
function revisarAlertasStock(antes, despues, producto, umbral) {
  if (despues === null || despues === undefined) return;
  if (despues <= 0 && (antes === null || antes === undefined || antes > 0)) {
    emitir('stock_agotado', { producto: { id: producto.id, nombre: producto.nombre } });
  } else if (despues <= umbral && despues > 0 && (antes === null || antes === undefined || antes > umbral)) {
    emitir('stock_bajo', { producto: { id: producto.id, nombre: producto.nombre }, quedan: despues });
  }
}

// ---------- Состав заказа ----------
function construirItems(itemsCrudos, productos) {
  if (!Array.isArray(itemsCrudos) || itemsCrudos.length === 0) {
    throw new ErrorNegocio('El pedido no tiene ningún plato.');
  }
  if (itemsCrudos.length > 60) throw new ErrorNegocio('El pedido tiene demasiados platos distintos.');

  const acumulado = new Map();
  for (const crudo of itemsCrudos) {
    const productoId = String((crudo && crudo.productoId) || '');
    const cantidad = Number(crudo && crudo.cantidad);
    const producto = productos.find((p) => p.id === productoId);
    if (!producto) throw new ErrorNegocio('Uno de los platos del pedido ya no existe.');
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw new ErrorNegocio(`La cantidad de "${producto.nombre}" no es válida.`);
    acumulado.set(productoId, (acumulado.get(productoId) || 0) + cantidad);
  }

  const items = [];
  for (const [productoId, cantidad] of acumulado) {
    const producto = productos.find((p) => p.id === productoId);
    if (!producto.disponible) throw new ErrorNegocio(`"${producto.nombre}" ya no está disponible.`);
    if (producto.maximoPorPedido && cantidad > producto.maximoPorPedido) {
      throw new ErrorNegocio(`"${producto.nombre}" tiene un máximo de ${producto.maximoPorPedido} por pedido.`);
    }
    if (tieneStock(producto)) {
      if (producto.stock <= 0) throw new ErrorNegocio(`"${producto.nombre}" se agotó. Quítalo del pedido para continuar.`);
      if (cantidad > producto.stock) {
        throw new ErrorNegocio(`Solo quedan ${producto.stock} de "${producto.nombre}". Ajusta la cantidad para continuar.`);
      }
    }
    items.push({
      productoId: producto.id,
      nombre: producto.nombre,
      precio: producto.precio,
      cantidad,
      porcion: producto.porcion || null,
    });
  }
  const totalCup = redondear(items.reduce((s, it) => s + it.precio * it.cantidad, 0));
  return { items, totalCup };
}

function calcularEnvio(ajustes, municipio, subtotal) {
  const gratisDesde = Number(ajustes.pedidos.envioGratisDesdeCup) || 0;
  if (gratisDesde > 0 && subtotal >= gratisDesde) return { envioCup: 0, envioGratis: true };
  return { envioCup: Number(ajustes.enviosPorMunicipio[municipio]) || 0, envioGratis: false };
}

function nombreMunicipio(id) {
  const m = MUNICIPIOS_HABANA.find((x) => x.id === id);
  return m ? m.nombre : id;
}

// ---------- Создание ----------
async function crearPedido({ clienteId, cliente, itemsCrudos, metodoPagoId, clave }) {
  const ajustes = await Ajustes.obtener();
  const estado = Ajustes.estadoTienda(ajustes);

  if (!estado.abierto && !ajustes.horario.aceptarFueraDeHorario) {
    throw new ErrorNegocio(
      estado.manual
        ? (ajustes.horario.mensajeCierre || 'Por hoy no estamos recibiendo pedidos.') + (estado.proxima ? ` Volvemos ${estado.textoEntrega}.` : '')
        : `Ahora estamos cerrados. Volvemos ${estado.textoEntrega}.`,
      409
    );
  }

  const pagos = ajustes.pedidos.pagos.filter((m) => m.activo);
  let pago = pagos.find((m) => m.id === metodoPagoId);
  if (!pago) {
    if (metodoPagoId) throw new ErrorNegocio('Ese método de pago no está disponible.');
    pago = pagos[0];
  }
  if (!pago) throw new ErrorNegocio('No hay métodos de pago disponibles. Contáctanos.', 503);

  let creado = null;
  let existente = null;

  await queueWrite(async () => {
    const pedidos = await readJson(ORDERS_FILE, []);

    // Идемпотентность: тот же ключ от того же клиента = тот же заказ
    // (двойной тап, повтор запроса после обрыва сети).
    if (clave) {
      const previo = pedidos.find((p) => p.claveIdempotencia === clave && p.clienteId === clienteId);
      if (previo) { existente = previo; return; }
    }

    const hoy = Ajustes.hoyLocal(ajustes);
    const productos = await readJson(PRODUCTS_FILE, []);
    aplicarReposicion(productos, hoy);

    const { items, totalCup } = construirItems(itemsCrudos, productos);

    const minimo = Number(ajustes.pedidos.pedidoMinimoCup) || 0;
    if (minimo > 0 && totalCup < minimo) {
      throw new ErrorNegocio(`El pedido mínimo es de ${minimo} CUP (sin contar el envío). Te faltan ${redondear(minimo - totalCup)} CUP.`);
    }

    const { envioCup, envioGratis } = calcularEnvio(ajustes, cliente.municipio, totalCup);
    const ahora = new Date().toISOString();
    const numero = pedidos.reduce((m, p) => Math.max(m, Number(p.numero) || 0), 0) + 1;

    const alertas = [];
    items.forEach((it) => {
      const prod = productos.find((p) => p.id === it.productoId);
      if (tieneStock(prod)) {
        const antes = prod.stock;
        prod.stock = antes - it.cantidad;
        alertas.push([antes, prod.stock, prod]);
      }
    });

    const fuera = !estado.abierto;
    creado = {
      id: crypto.randomUUID(),
      numero,
      clienteId,
      cliente,
      items,
      totalCup,
      envioCup,
      envioGratis,
      totalConEnvioCup: redondear(totalCup + envioCup),
      metodoPago: { id: pago.id, nombre: pago.nombre },
      estado: 'nuevo',
      fueraDeHorario: fuera,
      mensajeEntrega: fuera ? `Ahora estamos cerrados. Tu pedido se entregará ${estado.textoEntrega}.` : '',
      tiempoEstimado: fuera ? '' : ajustes.pedidos.tiempoEstimado,
      claveIdempotencia: clave || null,
      creadoEn: ahora,
      actualizadoEn: ahora,
      historial: [{ fecha: ahora, tipo: 'creado', texto: 'Pedido recibido' }],
    };
    pedidos.push(creado);

    // Primero productos, luego pedidos: si falla entre ambas escrituras es
    // mejor perder 1 unidad de stock que un pedido.
    await writeJson(PRODUCTS_FILE, productos);
    await writeJson(ORDERS_FILE, pedidos);

    creado._alertas = alertas;
  });

  if (existente) return { pedido: existente, repetido: true };

  const alertas = creado._alertas || [];
  delete creado._alertas;
  const umbral = ajustes.pedidos.stockBajoUmbral;
  alertas.forEach(([antes, despues, prod]) => revisarAlertasStock(antes, despues, prod, umbral));
  emitir('pedido_nuevo', { pedido: creado });
  return { pedido: creado, repetido: false };
}

// ---------- Вспомогательное: изменить один заказ под очередью ----------
async function conPedido(id, fn) {
  let resultado;
  await queueWrite(async () => {
    const pedidos = await readJson(ORDERS_FILE, []);
    const idx = pedidos.findIndex((p) => p.id === id);
    if (idx === -1) throw new ErrorNegocio('El pedido no existe.', 404);
    resultado = await fn(pedidos[idx], pedidos);
  });
  return resultado;
}

function anotar(pedido, tipo, texto) {
  pedido.historial = pedido.historial || [];
  pedido.historial.push({ fecha: new Date().toISOString(), tipo, texto });
  pedido.actualizadoEn = new Date().toISOString();
}

async function devolverStock(pedido) {
  const ajustes = await Ajustes.obtener();
  const productos = await readJson(PRODUCTS_FILE, []);
  let cambio = false;
  pedido.items.forEach((it) => {
    const prod = productos.find((p) => p.id === it.productoId);
    if (prod && tieneStock(prod)) {
      let nuevo = prod.stock + it.cantidad;
      if (prod.reponerDiario !== null && prod.reponerDiario !== undefined) nuevo = Math.min(nuevo, prod.reponerDiario);
      prod.stock = nuevo;
      cambio = true;
    }
  });
  if (cambio) await writeJson(PRODUCTS_FILE, productos);
  return ajustes;
}

const ETIQUETA_ESTADO = {
  nuevo: 'Nuevo', en_preparacion: 'En preparación', enviado: 'Enviado', completado: 'Completado', cancelado: 'Cancelado',
};

// ---------- Estado ----------
async function cambiarEstado(id, estado, actor = 'admin') {
  const { ESTADOS_PEDIDO_EDITABLES } = require('../config');
  if (!ESTADOS_PEDIDO_EDITABLES.includes(estado)) throw new ErrorNegocio('Estado inválido.');
  let pedido;
  let anterior;
  await conPedido(id, async (p, pedidos) => {
    if (p.estado === 'cancelado') throw new ErrorNegocio('Este pedido está cancelado y ya no se puede modificar.');
    anterior = p.estado;
    if (anterior === estado) { pedido = p; return; }
    p.estado = estado;
    anotar(p, 'estado', `Estado: ${ETIQUETA_ESTADO[estado]} (${actor})`);
    await writeJson(ORDERS_FILE, pedidos);
    pedido = p;
  });
  if (anterior !== estado) emitir('pedido_estado', { pedido, anterior, actor });
  return pedido;
}

// actor: 'admin' | 'telegram' | 'cliente'
async function cancelar(id, actor = 'admin', clienteId = null) {
  let pedido;
  await conPedido(id, async (p, pedidos) => {
    if (actor === 'cliente') {
      if (p.clienteId !== clienteId) throw new ErrorNegocio('Este pedido no pertenece a tu cuenta.', 403);
      if (p.estado !== 'nuevo') throw new ErrorNegocio('Este pedido ya está en preparación y no se puede cancelar.');
    } else {
      if (p.estado === 'cancelado') throw new ErrorNegocio('Este pedido ya está cancelado.');
      if (p.estado === 'completado') throw new ErrorNegocio('Este pedido ya fue completado y no se puede cancelar.');
    }
    p.estado = 'cancelado';
    anotar(p, 'cancelado', `Cancelado (${actor})`);
    await devolverStock(p);
    await writeJson(ORDERS_FILE, pedidos);
    pedido = p;
  });
  emitir(actor === 'cliente' ? 'pedido_cancelado_cliente' : 'pedido_estado', { pedido, anterior: null, actor, cancelado: true });
  return pedido;
}

// ---------- Редактирование админом ----------
const ESTADOS_EDITABLES_CONTENIDO = ['nuevo', 'en_preparacion', 'enviado'];

async function editar(id, cambios, actor = 'admin') {
  const { validateClienteEditable } = require('../validators/pedidos');
  const ajustes = await Ajustes.obtener();
  let pedido;
  let resumen = [];

  await conPedido(id, async (p, pedidos) => {
    if (!ESTADOS_EDITABLES_CONTENIDO.includes(p.estado)) {
      throw new ErrorNegocio('Solo se pueden editar pedidos que no estén completados ni cancelados.');
    }
    resumen = [];
    const productos = await readJson(PRODUCTS_FILE, []);
    aplicarReposicion(productos, Ajustes.hoyLocal(ajustes));
    let productosCambiaron = false;
    const alertas = [];

    // --- Datos del cliente
    if (cambios.cliente && typeof cambios.cliente === 'object') {
      const { errors, value } = validateClienteEditable(cambios.cliente, p.cliente);
      if (errors.length) throw new ErrorNegocio(errors[0]);
      ['nombre', 'telefono', 'direccion', 'nota', 'municipio'].forEach((k) => {
        if (value[k] !== p.cliente[k]) {
          resumen.push(k === 'municipio' ? `municipio: ${nombreMunicipio(value[k])}` : `${k} actualizado`);
          p.cliente[k] = value[k];
        }
      });
    }

    // --- Platos
    let subtotalCambio = false;
    if (Array.isArray(cambios.items)) {
      const nuevos = [];
      const vistos = new Set();
      for (const crudo of cambios.items) {
        const productoId = String((crudo && crudo.productoId) || '');
        const cantidad = Number(crudo && crudo.cantidad);
        if (!Number.isInteger(cantidad) || cantidad < 0) throw new ErrorNegocio('Hay una cantidad no válida.');
        if (cantidad === 0) continue;
        if (vistos.has(productoId)) throw new ErrorNegocio('Un plato aparece repetido en el pedido.');
        vistos.add(productoId);
        const viejo = p.items.find((it) => it.productoId === productoId);
        const prod = productos.find((x) => x.id === productoId);
        if (!viejo && !prod) throw new ErrorNegocio('Uno de los platos no existe.');
        let precio = viejo ? viejo.precio : prod.precio;
        if (crudo.precio !== undefined && crudo.precio !== null && crudo.precio !== '') {
          const pr = Number(crudo.precio);
          if (!Number.isFinite(pr) || pr < 0) throw new ErrorNegocio('Hay un precio no válido.');
          precio = redondear(pr);
        }
        nuevos.push({
          productoId,
          nombre: viejo ? viejo.nombre : prod.nombre,
          precio,
          cantidad,
          porcion: viejo ? viejo.porcion : (prod.porcion || null),
        });
      }
      if (nuevos.length === 0) throw new ErrorNegocio('El pedido debe tener al menos un plato. Para anularlo usa "Cancelar pedido".');

      // Ajuste de stock por diferencia
      const ids = new Set([...p.items.map((i) => i.productoId), ...nuevos.map((i) => i.productoId)]);
      for (const pid of ids) {
        const antes = (p.items.find((i) => i.productoId === pid) || {}).cantidad || 0;
        const despues = (nuevos.find((i) => i.productoId === pid) || {}).cantidad || 0;
        const delta = despues - antes;
        const prod = productos.find((x) => x.id === pid);
        if (delta !== 0 && prod && tieneStock(prod)) {
          if (delta > 0 && prod.stock < delta) throw new ErrorNegocio(`Solo quedan ${prod.stock} de "${prod.nombre}".`);
          const stockAntes = prod.stock;
          prod.stock = stockAntes - delta;
          if (prod.reponerDiario !== null && prod.reponerDiario !== undefined) prod.stock = Math.min(prod.stock, prod.reponerDiario);
          productosCambiaron = true;
          alertas.push([stockAntes, prod.stock, prod]);
        }
        if (delta !== 0) {
          const nombre = (nuevos.find((i) => i.productoId === pid) || p.items.find((i) => i.productoId === pid)).nombre;
          resumen.push(despues === 0 ? `quitado ${nombre}` : antes === 0 ? `agregado ${despues}× ${nombre}` : `${nombre} ${antes}→${despues}`);
        }
      }
      // cambios de precio sin cambio de cantidad
      nuevos.forEach((n) => {
        const v = p.items.find((i) => i.productoId === n.productoId);
        if (v && v.precio !== n.precio) { resumen.push(`precio de ${n.nombre} ${v.precio}→${n.precio}`); subtotalCambio = true; }
      });
      if (resumen.length || subtotalCambio) subtotalCambio = true;
      p.items = nuevos;
      p.totalCup = redondear(p.items.reduce((s, it) => s + it.precio * it.cantidad, 0));
    }

    // --- Envío
    const envioAntes = p.envioCup;
    if (cambios.envioCup !== undefined && cambios.envioCup !== null && cambios.envioCup !== '') {
      const e = Number(cambios.envioCup);
      if (!Number.isFinite(e) || e < 0 || e > 100000) throw new ErrorNegocio('El costo de envío no es válido.');
      p.envioCup = redondear(e);
      p.envioGratis = false;
      p.envioManual = true;
    } else if (!p.envioManual && (subtotalCambio || (cambios.cliente && cambios.cliente.municipio !== undefined))) {
      const { envioCup, envioGratis } = calcularEnvio(ajustes, p.cliente.municipio, p.totalCup);
      p.envioCup = envioCup;
      p.envioGratis = envioGratis;
    }
    if (p.envioCup !== envioAntes) resumen.push(`envío ${envioAntes}→${p.envioCup}`);
    p.totalConEnvioCup = redondear(p.totalCup + p.envioCup);

    // --- Nota interna del admin
    if (cambios.notaAdmin !== undefined) {
      const nota = String(cambios.notaAdmin || '').trim().slice(0, 300);
      if (nota !== (p.notaAdmin || '')) { p.notaAdmin = nota; resumen.push('nota interna'); }
    }

    if (resumen.length === 0) { pedido = p; return; }

    p.editadoEn = new Date().toISOString();
    anotar(p, 'edicion', `Editado: ${resumen.join('; ')}`);
    if (productosCambiaron) await writeJson(PRODUCTS_FILE, productos);
    await writeJson(ORDERS_FILE, pedidos);
    pedido = p;
    alertas.forEach(([a, d, prod]) => revisarAlertasStock(a, d, prod, ajustes.pedidos.stockBajoUmbral));
  });

  if (resumen.length) emitir('pedido_editado', { pedido, resumen, actor });
  return pedido;
}

module.exports = {
  ErrorNegocio, leerProductos, aplicarReposicion, crearPedido, cambiarEstado, cancelar, editar,
  calcularEnvio, nombreMunicipio, ETIQUETA_ESTADO, tieneStock, revisarAlertasStock,
};
