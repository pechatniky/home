// Datos y preferencias del usuario administrador que inició sesión:
// tema de color y cambio de contraseña. Rutas protegidas por requireAuth.

const express = require('express');
const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { USERS_FILE, TEMAS } = require('../config');
const { emitir } = require('../lib/eventos');

const router = express.Router();

function vista(u) {
  return { id: u.id, usuario: u.usuario, tema: TEMAS.includes(u.tema) ? u.tema : 'oscuro' };
}

router.get('/me', async (req, res, next) => {
  try {
    const usuarios = await readJson(USERS_FILE);
    const usuario = usuarios.find((u) => u.id === req.session.userId);
    if (!usuario) return res.status(401).json({ error: 'Sesión inválida.' });
    res.json(vista(usuario));
  } catch (err) { next(err); }
});

router.put('/me/tema', async (req, res, next) => {
  const tema = String((req.body && req.body.tema) || '');
  if (!TEMAS.includes(tema)) {
    return res.status(400).json({ error: 'Tema inválido.' });
  }
  try {
    let actualizado = null;
    await queueWrite(async () => {
      const usuarios = await readJson(USERS_FILE);
      const idx = usuarios.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) return;
      usuarios[idx].tema = tema;
      actualizado = usuarios[idx];
      await writeJson(USERS_FILE, usuarios);
    });
    if (!actualizado) return res.status(401).json({ error: 'Sesión inválida.' });
    res.json(vista(actualizado));
  } catch (err) { next(err); }
});

// Cambio de contraseña del admin (pide la actual).
router.post('/password', async (req, res, next) => {
  const actual = String((req.body && req.body.actual) || '');
  const nueva = String((req.body && req.body.nueva) || '');
  if (nueva.length < 8) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres.' });
  if (!/\d/.test(nueva)) return res.status(400).json({ error: 'La contraseña nueva debe incluir al menos un número.' });
  if (!/[^A-Za-z0-9\s]/.test(nueva)) return res.status(400).json({ error: 'La contraseña nueva debe incluir al menos un símbolo especial (por ejemplo ! ? # $ % & *).' });
  if (nueva.length > 100) return res.status(400).json({ error: 'La contraseña nueva es demasiado larga.' });
  try {
    let error = null;
    await queueWrite(async () => {
      const usuarios = await readJson(USERS_FILE);
      const idx = usuarios.findIndex((u) => u.id === req.session.userId);
      if (idx === -1) { error = 'Sesión inválida.'; return; }
      if (usuarios[idx].password !== actual) { error = 'La contraseña actual no es correcta.'; return; }
      if (usuarios.some((u, i) => i !== idx && u.password === nueva)) { error = 'Elige otra contraseña.'; return; }
      usuarios[idx].password = nueva;
      await writeJson(USERS_FILE, usuarios);
    });
    if (error) return res.status(400).json({ error });
    emitir('seguridad', { mensaje: 'La contraseña del panel de admin fue cambiada.' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
