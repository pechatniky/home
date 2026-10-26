// Статистика по заказам (веб-страница /estadisticas и Telegram-бот).
// Выручка = сумма totalConEnvioCup заказов, которые не отменены.
// Дни и часы считаются по часовому поясу магазина.

const { readJson } = require('../lib/jsonStore');
const { ORDERS_FILE, CLIENTES_FILE } = require('../config');
const Ajustes = require('../lib/ajustes');

const redondear = (n) => Math.round(n * 100) / 100;

function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// periodo: 'hoy' | 'ayer' | '7d' | '30d' | 'todo'
async function calcular(periodo = '7d') {
  const ajustes = await Ajustes.obtener();
  const zona = ajustes.horario.zona;
  const hoy = Ajustes.hoyLocal(ajustes);
  const [pedidosTodos, clientes] = await Promise.all([readJson(ORDERS_FILE, []), readJson(CLIENTES_FILE, [])]);

  let desde = null;
  let hasta = hoy;
  if (periodo === 'hoy') desde = hoy;
  else if (periodo === 'ayer') { desde = sumarDias(hoy, -1); hasta = desde; }
  else if (periodo === '7d') desde = sumarDias(hoy, -6);
  else if (periodo === '30d') desde = sumarDias(hoy, -29);

  const conFecha = pedidosTodos.map((p) => ({ p, dia: Ajustes.partesLocales(new Date(p.creadoEn), zona) }));
  const enRango = conFecha.filter(({ dia }) => (!desde || dia.fecha >= desde) && dia.fecha <= hasta);

  const validos = enRango.filter(({ p }) => p.estado !== 'cancelado');
  const cancelados = enRango.length - validos.length;
  const ingresos = redondear(validos.reduce((s, { p }) => s + (p.totalConEnvioCup ?? p.totalCup ?? 0), 0));
  const ingresosPlatos = redondear(validos.reduce((s, { p }) => s + (p.totalCup || 0), 0));
  const ingresosEnvio = redondear(validos.reduce((s, { p }) => s + (p.envioCup || 0), 0));

  // Serie por día (todos los días del rango, incluso los vacíos)
  const porDia = new Map();
  let inicio = desde;
  if (!inicio) {
    inicio = validos.length ? validos.reduce((m, { dia }) => (dia.fecha < m ? dia.fecha : m), hoy) : hoy;
  }
  for (let d = inicio, n = 0; d <= hasta && n < 400; d = sumarDias(d, 1), n++) porDia.set(d, { fecha: d, pedidos: 0, ingresos: 0 });
  validos.forEach(({ p, dia }) => {
    const reg = porDia.get(dia.fecha);
    if (reg) { reg.pedidos += 1; reg.ingresos = redondear(reg.ingresos + (p.totalConEnvioCup ?? p.totalCup ?? 0)); }
  });

  // Top platos
  const platos = new Map();
  validos.forEach(({ p }) => p.items.forEach((it) => {
    const r = platos.get(it.productoId) || { nombre: it.nombre, cantidad: 0, ingresos: 0 };
    r.cantidad += it.cantidad;
    r.ingresos = redondear(r.ingresos + it.precio * it.cantidad);
    platos.set(it.productoId, r);
  }));
  const topPlatos = [...platos.values()].sort((a, b) => b.cantidad - a.cantidad || b.ingresos - a.ingresos).slice(0, 10);

  // Por municipio
  const mun = new Map();
  validos.forEach(({ p }) => {
    const id = p.cliente.municipio || 'otro';
    const r = mun.get(id) || { municipio: id, pedidos: 0, ingresos: 0 };
    r.pedidos += 1;
    r.ingresos = redondear(r.ingresos + (p.totalConEnvioCup ?? p.totalCup ?? 0));
    mun.set(id, r);
  });
  const porMunicipio = [...mun.values()].sort((a, b) => b.pedidos - a.pedidos);

  // Por hora del día
  const porHora = Array.from({ length: 24 }, (_, h) => ({ hora: h, pedidos: 0 }));
  validos.forEach(({ dia }) => { porHora[Math.floor(dia.minutos / 60)].pedidos += 1; });

  // Por método de pago
  const pagos = new Map();
  validos.forEach(({ p }) => {
    const n = (p.metodoPago && p.metodoPago.nombre) || 'Sin especificar';
    const r = pagos.get(n) || { nombre: n, pedidos: 0, ingresos: 0 };
    r.pedidos += 1;
    r.ingresos = redondear(r.ingresos + (p.totalConEnvioCup ?? p.totalCup ?? 0));
    pagos.set(n, r);
  });

  // Clientes: nuevos en el periodo y recurrentes
  const clientesNuevos = clientes.filter((c) => {
    if (!c.creadoEn) return false;
    const f = Ajustes.partesLocales(new Date(c.creadoEn), zona).fecha;
    return (!desde || f >= desde) && f <= hasta;
  }).length;
  const idsEnRango = new Set(validos.map(({ p }) => p.clienteId));
  const primerPedido = new Map();
  conFecha.filter(({ p }) => p.estado !== 'cancelado').forEach(({ p, dia }) => {
    const prev = primerPedido.get(p.clienteId);
    if (!prev || dia.fecha < prev) primerPedido.set(p.clienteId, dia.fecha);
  });
  let recurrentes = 0;
  idsEnRango.forEach((id) => { if (desde && primerPedido.get(id) < desde) recurrentes += 1; });

  // Por estado
  const porEstado = {};
  enRango.forEach(({ p }) => { porEstado[p.estado] = (porEstado[p.estado] || 0) + 1; });

  const fueraDeHorario = validos.filter(({ p }) => p.fueraDeHorario).length;

  return {
    periodo, desde: inicio, hasta,
    pedidos: validos.length,
    cancelados,
    ingresos, ingresosPlatos, ingresosEnvio,
    ticketPromedio: validos.length ? redondear(ingresos / validos.length) : 0,
    clientesNuevos, clientesActivos: idsEnRango.size, clientesRecurrentes: recurrentes,
    fueraDeHorario,
    porDia: [...porDia.values()],
    topPlatos, porMunicipio, porHora,
    porPago: [...pagos.values()].sort((a, b) => b.pedidos - a.pedidos),
    porEstado,
  };
}

module.exports = { calcular };
