// Cuentas de clientes de la tienda (opcional — el pedido sin cuenta sigue
// funcionando igual). Sin verificación de ningún tipo: email + contraseña y
// la cuenta ya queda activa. Montado en /api/public junto con publico.js,
// así que tampoco pasa por requireAuth.
//
// El INICIO DE SESIÓN es por EMAIL — el identificador único de la cuenta.
// El teléfono sigue siendo obligatorio al registrarse (para coordinar la
// entrega), pero ya no sirve para entrar. El email no se puede cambiar
// después; el teléfono sí, desde "Mi perfil" (ver PUT /me / validatePerfil).
//
// La sesión de un cliente (req.session.clienteId) es independiente de la
// sesión de administrador (req.session.autenticado) — ambas conviven en la
// misma cookie sin pisarse.

const express = require('express');
const crypto = require('crypto');
const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { CLIENTES_FILE, ORDERS_FILE, TEMAS } = require('../config');
const { emitir } = require('../lib/eventos');
const { vistaCliente } = require('./publico');
const { validateRegistro, validateLogin, validatePerfil } = require('../validators/clientes');

const router = express.Router();

function datosPublicosCliente(cliente) {
  return {
    id: cliente.id,
    nombre: cliente.nombre,
    email: cliente.email,
    telefono: cliente.telefono,
    direccion: cliente.direccion || '',
    // Tema por defecto para cuentas creadas antes de agregar este campo
    // (null → la tienda usa el tema por defecto de Ajustes).
    tema: TEMAS.includes(cliente.tema) ? cliente.tema : null,
  };
}

router.post('/register', async (req, res, next) => {
  try {
    const { errors, value } = validateRegistro(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    let nuevo = null;
    let error = null;

    await queueWrite(async () => {
      const clientes = await readJson(CLIENTES_FILE);
      if (clientes.some((c) => c.email === value.email)) {
        error = 'Ya existe una cuenta con ese email.';
        return;
      }
      nuevo = { id: crypto.randomUUID(), ...value, tema: null, creadoEn: new Date().toISOString() };
      clientes.push(nuevo);
      await writeJson(CLIENTES_FILE, clientes);
    });

    if (error) return res.status(400).json({ error });

    req.session.clienteId = nuevo.id;
    emitir('cliente_nuevo', { cliente: nuevo });
    res.status(201).json(datosPublicosCliente(nuevo));
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { errors, value } = validateLogin(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    const clientes = await readJson(CLIENTES_FILE);
    const cliente = clientes.find((c) => c.email === value.email && c.password === value.password);
    if (!cliente) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    req.session.clienteId = cliente.id;
    res.json(datosPublicosCliente(cliente));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

router.post('/logout', (req, res) => {
  delete req.session.clienteId;
  res.json({ ok: true });
});

router.get('/me', async (req, res) => {
  if (!req.session.clienteId) return res.json({ cliente: null });
  try {
    const clientes = await readJson(CLIENTES_FILE);
    const cliente = clientes.find((c) => c.id === req.session.clienteId);
    if (!cliente) return res.json({ cliente: null });
    res.json({ cliente: datosPublicosCliente(cliente) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cargar la cuenta.' });
  }
});

// Cambiar el nombre, el teléfono y la dirección "por defecto" que se
// autocompletan al pedir. El email NO se toca acá — es fijo desde el
// registro (validatePerfil ni siquiera lo toma del body).
router.put('/me', async (req, res) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión para editar tu perfil.' });
  }
  try {
    const { errors, value } = validatePerfil(req.body);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    let actualizado = null;
    await queueWrite(async () => {
      const clientes = await readJson(CLIENTES_FILE);
      const idx = clientes.findIndex((c) => c.id === req.session.clienteId);
      if (idx === -1) return;
      clientes[idx].nombre = value.nombre;
      clientes[idx].telefono = value.telefono;
      clientes[idx].direccion = value.direccion;
      actualizado = clientes[idx];
      await writeJson(CLIENTES_FILE, clientes);
    });

    if (!actualizado) return res.status(404).json({ error: 'La cuenta no existe.' });
    res.json(datosPublicosCliente(actualizado));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el perfil.' });
  }
});

// Tema de la tienda para este cliente (independiente del tema de la
// administración, que se guarda por separado en users.json).
router.put('/me/tema', async (req, res) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión para cambiar el tema.' });
  }
  const tema = String((req.body && req.body.tema) || '');
  if (!TEMAS.includes(tema)) return res.status(400).json({ error: 'Tema inválido.' });
  try {
    let actualizado = null;
    await queueWrite(async () => {
      const clientes = await readJson(CLIENTES_FILE);
      const idx = clientes.findIndex((c) => c.id === req.session.clienteId);
      if (idx === -1) return;
      clientes[idx].tema = tema;
      actualizado = clientes[idx];
      await writeJson(CLIENTES_FILE, clientes);
    });

    if (!actualizado) return res.status(404).json({ error: 'La cuenta no existe.' });
    res.json(datosPublicosCliente(actualizado));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el tema.' });
  }
});

// Cambio de contraseña del cliente (pide la actual).
router.post('/me/password', async (req, res) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión para cambiar tu contraseña.' });
  }
  const actual = String((req.body && req.body.actual) || '');
  const nueva = String((req.body && req.body.nueva) || '');
  if (nueva.length < 4) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 4 caracteres.' });
  if (nueva.length > 100) return res.status(400).json({ error: 'La contraseña nueva es demasiado larga.' });
  try {
    let error = null;
    await queueWrite(async () => {
      const clientes = await readJson(CLIENTES_FILE);
      const idx = clientes.findIndex((c) => c.id === req.session.clienteId);
      if (idx === -1) { error = 'La cuenta no existe.'; return; }
      if (clientes[idx].password !== actual) { error = 'La contraseña actual no es correcta.'; return; }
      clientes[idx].password = nueva;
      await writeJson(CLIENTES_FILE, clientes);
    });
    if (error) return res.status(400).json({ error });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo cambiar la contraseña.' });
  }
});

router.get('/mis-pedidos', async (req, res) => {
  if (!req.session.clienteId) {
    return res.status(401).json({ error: 'Inicia sesión para ver tus pedidos.' });
  }
  try {
    const pedidos = await readJson(ORDERS_FILE);
    const propios = pedidos
      .filter((p) => p.clienteId === req.session.clienteId)
      .sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn))
      .map(vistaCliente);
    res.set('Cache-Control', 'no-store');
    res.json(propios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar tus pedidos.' });
  }
});

module.exports = router;
