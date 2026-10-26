// Copias de seguridad (protegido). Montado en /api/backups.

const express = require('express');
const Backup = require('../services/backup');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try { res.json({ copias: await Backup.listar(), enCurso: Backup.enCurso() }); } catch (err) { next(err); }
});

router.post('/', async (req, res) => {
  try {
    const r = await Backup.crear({ manual: true });
    res.status(201).json(r);
  } catch (err) {
    res.status(400).json({ error: `No se pudo crear la copia: ${err.message}` });
  }
});

// Enviar ahora el ZIP de datos a los chats de Telegram vinculados
router.post('/telegram', async (req, res) => {
  try {
    const r = await Backup.enviarATelegram({ manual: true });
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:nombre/descargar', async (req, res) => {
  if (!Backup.NOMBRE_RE.test(req.params.nombre)) return res.status(400).json({ error: 'Nombre inválido.' });
  try {
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${req.params.nombre}.zip"`,
    });
    await Backup.escribirZip(req.params.nombre, res);
  } catch (err) {
    console.error('Error al descargar copia:', err.message);
    if (!res.headersSent) res.status(404).json({ error: 'La copia no existe.' });
    else res.destroy();
  }
});

router.delete('/:nombre', async (req, res) => {
  try {
    await Backup.eliminar(req.params.nombre);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
