// Pedidos — lado administrador (protegido). Montado en /api/orders.
// Toda la lógica vive en src/services/pedidos.js (la comparte el bot de
// Telegram); aquí solo se traduce HTTP ⇄ servicio.
//
// Estados: nuevo → en_preparacion → enviado → completado, y "cancelado"
// (el admin puede cancelar mientras no esté completado; el cliente, solo
// mientras siga "nuevo"). Un pedido completado o cancelado no se edita.

const express = require('express');
const { readJson } = require('../lib/jsonStore');
const { ORDERS_FILE } = require('../config');
const Pedidos = require('../services/pedidos');

const router = express.Router();

// ?dias=N limita a los últimos N días (por defecto 45; 0 = todos). Los pedidos
// activos (nuevo / en preparación / enviado) siempre se incluyen, sin importar
// su antigüedad. Así el sondeo cada 15 s no crece sin límite con el tiempo.
router.get('/', async (req, res, next) => {
  try {
    let pedidos = await readJson(ORDERS_FILE, []);
    const dias = req.query.dias === undefined ? 45 : Math.max(0, Math.min(3650, parseInt(req.query.dias, 10) || 0));
    if (dias > 0) {
      const corte = Date.now() - dias * 86400000;
      pedidos = pedidos.filter((p) => new Date(p.creadoEn).getTime() >= corte || ['nuevo', 'en_preparacion', 'enviado'].includes(p.estado));
    }
    pedidos.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
    res.set('Cache-Control', 'no-store');
    res.json(pedidos);
  } catch (err) { next(err); }
});

// Exportar pedidos a CSV (abre bien en Excel: UTF-8 con BOM, ; como separador).
router.get('/export.csv', async (req, res, next) => {
  try {
    const dias = Math.max(0, Math.min(3650, parseInt(req.query.dias, 10) || 0));
    let pedidos = await readJson(ORDERS_FILE, []);
    if (dias > 0) {
      const corte = Date.now() - dias * 86400000;
      pedidos = pedidos.filter((p) => new Date(p.creadoEn).getTime() >= corte);
    }
    pedidos.sort((a, b) => new Date(a.creadoEn) - new Date(b.creadoEn));
    const celda = (v) => {
      let t = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@]/.test(t)) t = `'${t}`; // evita fórmulas al abrir en Excel
      return `"${t.replace(/"/g, '""')}"`;
    };
    const cab = ['N.º', 'Fecha', 'Estado', 'Cliente', 'Teléfono', 'Municipio', 'Dirección', 'Platos', 'Subtotal CUP', 'Envío CUP', 'Total CUP', 'Pago', 'Fuera de horario', 'Nota'];
    const filas = pedidos.map((p) => [
      p.numero, p.creadoEn, p.estado, p.cliente.nombre, p.cliente.telefono, Pedidos.nombreMunicipio(p.cliente.municipio), p.cliente.direccion,
      p.items.map((i) => `${i.cantidad}x ${i.nombre}`).join(' | '),
      p.totalCup, p.envioCup || 0, p.totalConEnvioCup ?? p.totalCup, p.metodoPago ? p.metodoPago.nombre : '', p.fueraDeHorario ? 'sí' : 'no', p.cliente.nota || '',
    ].map(celda).join(';'));
    const csv = `\uFEFF${[cab.map(celda).join(';'), ...filas].join('\r\n')}\r\n`;
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pedidos.csv"', 'Cache-Control': 'no-store' });
    res.send(csv);
  } catch (err) { next(err); }
});

router.get('/nuevos-count', async (req, res, next) => {
  try {
    const pedidos = await readJson(ORDERS_FILE, []);
    res.json({ count: pedidos.filter((p) => p.estado === 'nuevo').length });
  } catch (err) { next(err); }
});

router.post('/:id/cancelar', async (req, res, next) => {
  try {
    res.json(await Pedidos.cancelar(req.params.id, 'admin'));
  } catch (err) { next(err); }
});

router.patch('/:id/estado', async (req, res, next) => {
  try {
    const estado = String((req.body && req.body.estado) || '');
    res.json(await Pedidos.cambiarEstado(req.params.id, estado, 'admin'));
  } catch (err) { next(err); }
});

// Edición del contenido: platos (cantidades/precios), datos del cliente,
// envío y nota interna. Ver Pedidos.editar().
router.put('/:id', async (req, res, next) => {
  try {
    res.json(await Pedidos.editar(req.params.id, req.body || {}, 'admin'));
  } catch (err) { next(err); }
});

module.exports = router;
