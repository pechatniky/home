// Ajustes generales de la tienda (protegido). Montado en /api/settings.
// Todo lo que el dueño puede cambiar sin tocar código: tienda, contactos,
// horario, pedidos/pagos, envío, apariencia, Telegram, copias de seguridad.

const express = require('express');
const Ajustes = require('../lib/ajustes');
const Telegram = require('../services/telegram');
const { emitir } = require('../lib/eventos');
const { TEMAS } = require('../config');
const Icono = require('../lib/icono');
const { upload } = require('../lib/imagenes');

const router = express.Router();

function respuesta(a) {
  return {
    ...Ajustes.paraAdmin(a),
    _estado: Ajustes.estadoTienda(a),
    _temas: TEMAS,
    _eventosTelegram: Ajustes.EVENTOS_TELEGRAM,
  };
}

router.get('/', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(respuesta(await Ajustes.obtener()));
  } catch (err) { next(err); }
});

// Actualización parcial por secciones: solo se tocan las claves recibidas.
router.put('/', async (req, res, next) => {
  try {
    const actual = await Ajustes.obtener();
    const { errors, value } = Ajustes.sanear(req.body || {}, actual);
    if (errors.length) return res.status(400).json({ error: errors[0], errors });
    if (Object.keys(value).length === 0) {
      return res.status(400).json({ error: 'No se recibió ningún dato para actualizar.' });
    }

    const tokenAntes = actual.telegram.token;
    const cierreAntes = actual.horario.cerradoManual;
    const nuevo = await Ajustes.actualizar((a) => Object.assign(a, value));

    if (nuevo.telegram.token !== tokenAntes) Telegram.reiniciar().catch(() => {});
    if (nuevo.horario.cerradoManual !== cierreAntes) {
      emitir('tienda_estado', { cerrado: nuevo.horario.cerradoManual, actor: 'panel' });
    }
    res.json(respuesta(nuevo));
  } catch (err) { next(err); }
});

// Icono del sitio: sube una imagen y se generan todos los tamaños.
router.post('/icono', (req, res) => {
  upload.single('icono')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 5 MB.' : err.message });
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    try {
      const version = await Icono.generar(req.file.buffer);
      const nuevo = await Ajustes.actualizar((a) => { a.tienda.icono = version; return a; });
      res.status(201).json(respuesta(nuevo));
    } catch (e) {
      console.error('Icono:', e.message);
      res.status(400).json({ error: e.message && e.message.includes('pequeña') ? e.message : 'No se pudo procesar la imagen. Prueba con otro archivo (PNG o JPG cuadrado).' });
    }
  });
});

router.delete('/icono', async (req, res, next) => {
  try {
    await Icono.quitar();
    const nuevo = await Ajustes.actualizar((a) => { a.tienda.icono = ''; return a; });
    res.json(respuesta(nuevo));
  } catch (err) { next(err); }
});

router.get('/telegram', async (req, res, next) => {
  try { res.json(await Telegram.estadoPublico()); } catch (err) { next(err); }
});

router.post('/telegram/prueba', async (req, res) => {
  try {
    await Telegram.enviarPrueba();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Quitar un chat vinculado desde el panel
router.post('/telegram/desvincular', async (req, res, next) => {
  try {
    const chat = String((req.body && req.body.chatId) || '');
    await Ajustes.actualizar((a) => { a.telegram.chatIds = a.telegram.chatIds.filter((c) => c !== chat); return a; });
    res.json(await Telegram.estadoPublico());
  } catch (err) { next(err); }
});

module.exports = router;
