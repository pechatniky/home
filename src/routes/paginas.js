// Rutas de páginas HTML (vistas) y archivos de la PWA. "/" es la tienda
// pública (con meta-etiquetas generadas según los Ajustes); el panel exige
// sesión de administrador.

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { VIEWS_DIR, PUBLIC_DIR } = require('../config');
const Ajustes = require('../lib/ajustes');
const Icono = require('../lib/icono');

const router = express.Router();

const esc = (s) => String(s === undefined || s === null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- Versión de la app (para el service worker) ----------
// Hash de tamaños y fechas de los archivos estáticos: cambia solo cuando
// cambia el código, y obliga a los navegadores a refrescar su caché.
function calcularVersion() {
  const h = crypto.createHash('md5');
  const recorrer = (dir) => {
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    entradas.sort((a, b) => a.name.localeCompare(b.name)).forEach((e) => {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'uploads' || e.name === 'vendor') return;
        recorrer(ruta);
      } else {
        try { const st = fs.statSync(ruta); h.update(`${ruta}:${st.size}:${st.mtimeMs}`); } catch (_) { /* ignorar */ }
      }
    });
  };
  recorrer(PUBLIC_DIR);
  recorrer(VIEWS_DIR);
  return h.digest('hex').slice(0, 10);
}
const VERSION = calcularVersion();

function leerVista(nombre) {
  return fs.readFileSync(path.join(VIEWS_DIR, nombre), 'utf-8');
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// ---------- Tienda (HTML con meta-etiquetas dinámicas) ----------
router.get('/', async (req, res, next) => {
  try {
    const a = await Ajustes.obtener();
    const t = a.tienda;
    const c = a.contactos;
    const base = baseUrl(req);
    const titulo = t.tituloSitio || (t.eslogan ? `${t.nombre} — ${t.eslogan}` : t.nombre);
    const iv = Icono.sufijo(t);
    const desc = t.descripcion || `Pide comida directo desde el menú de ${t.nombre}.`;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: t.nombre,
      description: desc,
      url: `${base}/`,
      image: `${base}/icons/icon-512.png${iv}`,
      servesCuisine: 'Comida lista',
      ...(c.telefono ? { telephone: c.telefono } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.direccion ? { address: c.direccion } : {}),
      areaServed: 'La Habana, Cuba',
    };
    const meta = [
      `<title>${esc(titulo)}</title>`,
      `<meta name="description" content="${esc(desc)}" />`,
      `<meta name="theme-color" content="#171320" />`,
      `<meta name="tema-defecto" content="${esc(a.apariencia.temaPorDefecto)}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${esc(t.nombre)}" />`,
      `<meta property="og:title" content="${esc(titulo)}" />`,
      `<meta property="og:description" content="${esc(desc)}" />`,
      `<meta property="og:url" content="${esc(base)}/" />`,
      `<meta property="og:image" content="${esc(base)}/icons/icon-512.png${iv}" />`,
      `<meta property="og:locale" content="es_ES" />`,
      `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${esc(titulo)}" />`,
      `<meta name="twitter:description" content="${esc(desc)}" />`,
      `<meta name="apple-mobile-web-app-capable" content="yes" />`,
      `<meta name="mobile-web-app-capable" content="yes" />`,
      `<meta name="apple-mobile-web-app-title" content="${esc(t.nombre)}" />`,
      `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`,
      `<link rel="manifest" href="/manifest.webmanifest" />`,
      Icono.etiquetas(t),
      `<link rel="canonical" href="${esc(base)}/" />`,
      `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`,
    ].join('\n');

    const html = leerVista('tienda.html')
      .replace('<!--META-->', meta)
      .replace(/\{\{NOMBRE\}\}/g, esc(t.nombre))
      .replace(/\{\{EMOJI\}\}/g, esc(t.emoji))
      .replace(/\{\{ESLOGAN\}\}/g, esc(t.eslogan));
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(html);
  } catch (err) { next(err); }
});

// ---------- Manifest PWA ----------
router.get('/manifest.webmanifest', async (req, res, next) => {
  try {
    const a = await Ajustes.obtener();
    const iv = Icono.sufijo(a.tienda);
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').send(JSON.stringify({
      name: a.tienda.tituloSitio || a.tienda.nombre,
      short_name: a.tienda.nombre.slice(0, 12),
      description: a.tienda.descripcion,
      id: '/',
      start_url: '/?utm_source=pwa',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      lang: 'es',
      background_color: '#121018',
      theme_color: '#171320',
      icons: [
        { src: `/icons/icon-192.png${iv}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/icons/icon-512.png${iv}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/icons/icon-maskable-512.png${iv}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      shortcuts: [{ name: 'Mis pedidos', url: '/?ver=pedidos', icons: [{ src: `/icons/icon-192.png${iv}`, sizes: '192x192' }] }],
    }));
  } catch (err) { next(err); }
});

router.get('/manifest-admin.webmanifest', async (req, res, next) => {
  try {
    const a = await Ajustes.obtener();
    const iv = Icono.sufijo(a.tienda);
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').send(JSON.stringify({
      name: `${a.tienda.nombre} — Panel`,
      short_name: 'Panel',
      id: '/admin',
      start_url: '/pedidos',
      scope: '/',
      display: 'standalone',
      lang: 'es',
      background_color: '#121018',
      theme_color: '#171320',
      icons: [
        { src: `/icons/icon-192.png${iv}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/icons/icon-512.png${iv}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/icons/icon-maskable-512.png${iv}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }));
  } catch (err) { next(err); }
});

// ---------- Service worker (con versión incrustada) ----------
router.get('/sw.js', (req, res, next) => {
  try {
    const js = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.template.js'), 'utf-8').replace('__VERSION__', VERSION);
    res.set({ 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
    res.type('application/javascript').send(js);
  } catch (err) { next(err); }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /pedidos\nDisallow: /ajustes\nDisallow: /estadisticas\nDisallow: /qr\nDisallow: /api/\nAllow: /\n');
});

router.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, uptime: Math.round(process.uptime()), version: VERSION });
});

// ---------- Panel de administración ----------
function paginaProtegida(nombreArchivo) {
  return async (req, res, next) => {
    if (!req.session || !req.session.autenticado) {
      return res.redirect('/?acceso=1');
    }
    try {
      const a = await Ajustes.obtener();
      const html = leerVista(nombreArchivo)
        .replace('<!--ICONO-->', Icono.etiquetas(a.tienda))
        .replace(/\{\{NOMBRE\}\}/g, esc(a.tienda.tituloSitio || a.tienda.nombre));
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(html);
    } catch (err) { next(err); }
  };
}

router.get('/admin', paginaProtegida('admin.html'));
router.get('/ajustes', paginaProtegida('ajustes.html'));
router.get('/pedidos', paginaProtegida('pedidos.html'));
router.get('/estadisticas', paginaProtegida('estadisticas.html'));
router.get('/qr', paginaProtegida('qr.html'));

// No hay página de login de admin: se entra desde el formulario de la tienda.
router.get('/login', (req, res) => {
  res.redirect(req.session && req.session.autenticado ? '/admin' : '/?acceso=1');
});

module.exports = router;
module.exports.VERSION = VERSION;
