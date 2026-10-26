// Subida de imágenes de platos (protegida — solo el admin sube fotos).

const express = require('express');
const crypto = require('crypto');
const { upload, procesarYGuardarImagen } = require('../lib/imagenes');

const router = express.Router();

router.post('/upload', (req, res) => {
  upload.single('imagen')(req, res, async (err) => {
    if (err) {
      const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 5 MB.' : err.message;
      return res.status(400).json({ error: mensaje });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });
    }

    try {
      const nombreArchivo = `${crypto.randomUUID()}.jpg`;
      await procesarYGuardarImagen(req.file.buffer, nombreArchivo);
      res.status(201).json({ url: `/uploads/productos/${nombreArchivo}` });
    } catch (procesoErr) {
      console.error(procesoErr);
      res.status(400).json({ error: 'No se pudo procesar la imagen. Prueba con otro archivo.' });
    }
  });
});

module.exports = router;
