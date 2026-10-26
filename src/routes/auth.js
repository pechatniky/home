// Login / logout — las únicas rutas de /api que no exigen sesión previa
// (obviamente, para poder crear la sesión).

const express = require('express');
const { readJson } = require('../lib/jsonStore');
const { USERS_FILE } = require('../config');
const { emitir } = require('../lib/eventos');

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const password = String((req.body && req.body.password) || '');
    const usuarios = await readJson(USERS_FILE);
    const quien = String((req.body && req.body.usuario) || '').trim().toLowerCase();
    const usuario = usuarios.find((u) => u.password === password && (!quien || String(u.usuario || u.id).toLowerCase() === quien));
    if (!usuario) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    req.session.autenticado = true;
    req.session.userId = usuario.id;
    emitir('seguridad', { mensaje: `Inicio de sesión en el panel de admin (IP ${req.ip}).` });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ¿Hay sesión de administrador? La tienda lo usa para mostrar (solo a él) el
// botón del panel. No revela nada a quien no es admin.
router.get('/es-admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ admin: Boolean(req.session && req.session.autenticado) });
});

router.post('/logout', (req, res) => {
  // Solo cierra la sesión de admin; la de cliente (si existe) se conserva.
  delete req.session.autenticado;
  delete req.session.userId;
  res.json({ ok: true });
});

module.exports = router;
