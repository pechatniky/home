// Sirve el icono personalizado (si el admin subió uno) ANTES que los
// archivos estáticos por defecto. Sin icono personalizado, no hace nada.

const express = require('express');
const fs = require('fs');
const Icono = require('../lib/icono');
const Ajustes = require('../lib/ajustes');

const router = express.Router();

function servir(nombre) {
  return async (req, res, next) => {
    try {
      const a = await Ajustes.obtener();
      const ruta = a.tienda.icono ? Icono.rutaDe(nombre) : null;
      if (!ruta || !fs.existsSync(ruta)) return next();
      res.set('Cache-Control', 'public, max-age=3600');
      res.type('png').sendFile(ruta);
    } catch (err) { next(err); }
  };
}

['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png'].forEach((n) => {
  router.get(`/icons/${n}`, servir(n));
});
router.get('/favicon-32.png', servir('favicon-32.png'));
// Los navegadores piden /favicon.ico por su cuenta
router.get('/favicon.ico', async (req, res, next) => {
  try {
    const a = await Ajustes.obtener();
    const ruta = a.tienda.icono ? Icono.rutaDe('favicon-32.png') : null;
    if (ruta && fs.existsSync(ruta)) { res.set('Cache-Control', 'public, max-age=3600'); return res.type('png').sendFile(ruta); }
    res.redirect(302, '/icons/icon-192.png');
  } catch (err) { next(err); }
});

module.exports = router;
