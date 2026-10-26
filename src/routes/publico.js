// API pública (sin sesión de administrador): catálogo para el cliente y
// creación de pedidos. El catálogo (GET /menu) es visible para cualquiera,
// pero crear un pedido requiere tener una cuenta de cliente con sesión
// iniciada (ver POST /orders).
// Montado en /api/public, registrado ANTES del middleware requireAuth.

const express = require('express');
const { readJson } = require('../lib/jsonStore');
const { CATEGORIES_FILE, MUNICIPIOS_HABANA } = require('../config');
const { validateClienteInput } = require('../validators/pedidos');
const { direccionAproximada } = require('../lib/geocoding');
const Ajustes = require('../lib/ajustes');
const Pedidos = require('../services/pedidos');

const router = express.Router();

// Un producto sin datos internos de stock: el cliente solo se entera de
// "Agotado" o "Quedan N" cuando queda poco (por debajo del umbral).
function productoPublico(p, umbral) {
  const { stock, reponerDiario, stockFecha, ...resto } = p;
  const controla = stock !== null && stock !== undefined;
  return {
    ...resto,
    agotado: controla && stock <= 0,
    quedan: controla && stock > 0 && stock <= umbral ? stock : null,
  };
}

// Pedido tal como lo ve el cliente (sin notas internas ni claves técnicas).
function vistaCliente(p) {
  const { claveIdempotencia, notaAdmin, envioManual, ...resto } = p;
  return resto;
}

router.get('/menu', async (req, res, next) => {
  try {
    const [categorias, productos, ajustes] = await Promise.all([
      readJson(CATEGORIES_FILE, []),
      Pedidos.leerProductos(),
      Ajustes.obtener(),
    ]);
    const umbral = ajustes.pedidos.stockBajoUmbral;
    const disponibles = productos.filter((p) => p.disponible).map((p) => productoPublico(p, umbral));
    const enviosPorMunicipio = { ...ajustes.enviosPorMunicipio };
    MUNICIPIOS_HABANA.forEach(({ id }) => { if (enviosPorMunicipio[id] === undefined) enviosPorMunicipio[id] = 0; });
    const estado = Ajustes.estadoTienda(ajustes);
    res.set('Cache-Control', 'no-store');
    res.json({
      categorias,
      productos: disponibles,
      tasaCup: ajustes.tasaCup,
      enviosPorMunicipio,
      config: Ajustes.paraPublico(ajustes, estado),
    });
  } catch (err) { next(err); }
});

// Crear un pedido. Precios, totales, envío y stock se calculan SIEMPRE en el
// servidor. Requiere cuenta de cliente (sesión iniciada).
router.post('/orders', async (req, res, next) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión o crea una cuenta para hacer tu pedido.' });
  }
  try {
    const body = req.body || {};
    const { errors, value: cliente } = validateClienteInput(body.cliente);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const clave = typeof body.clave === 'string' && /^[\w-]{8,64}$/.test(body.clave) ? body.clave : null;

    // Dirección aproximada: se resuelve una sola vez (puede tardar hasta 4 s,
    // por eso va ANTES de entrar a la cola de escritura).
    cliente.direccionAproximada = cliente.ubicacion
      ? await direccionAproximada(cliente.ubicacion.lat, cliente.ubicacion.lng)
      : null;

    const { pedido, repetido } = await Pedidos.crearPedido({
      clienteId: req.session.clienteId,
      cliente,
      itemsCrudos: body.items,
      metodoPagoId: body.metodoPago ? String(body.metodoPago) : null,
      clave,
    });
    res.status(repetido ? 200 : 201).json(vistaCliente(pedido));
  } catch (err) { next(err); }
});

router.post('/orders/:id/cancelar', async (req, res, next) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión para cancelar un pedido.' });
  }
  try {
    const pedido = await Pedidos.cancelar(req.params.id, 'cliente', req.session.clienteId);
    res.json(vistaCliente(pedido));
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.vistaCliente = vistaCliente;
