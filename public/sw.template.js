// Service worker de la PWA. La versión (__VERSION__) la inyecta el servidor
// (ver src/routes/paginas.js) y cambia cada vez que cambia el código.
//
// Estrategia:
//  - Archivos propios (HTML de la tienda, JS, CSS): red primero con límite de
//    tiempo → si no hay internet, se usa la copia guardada.
//  - Fotos, iconos y librerías (cambian poco): caché primero.
//  - /api/public/menu: red primero, y si falla, el último menú visto
//    (la tienda avisa que es una copia guardada).
//  - Todo lo demás (panel, resto de /api, mapas): no se toca.

const VERSION = '__VERSION__';
const CACHE = `pechatniky-${VERSION}`;
const CACHE_DATOS = 'pechatniky-datos';

const PRECARGA = [
  '/',
  '/css/styles.css',
  '/js/temas.js',
  '/js/alertas.js',
  '/js/tienda.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/favicon.svg',
  '/icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECARGA.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k.startsWith('pechatniky-') && k !== CACHE && k !== CACHE_DATOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function conLimite(promesa, ms) {
  return new Promise((ok, fallo) => {
    const t = setTimeout(() => fallo(new Error('timeout')), ms);
    promesa.then((v) => { clearTimeout(t); ok(v); }, (err) => { clearTimeout(t); fallo(err); });
  });
}

async function marcarDesdeCache(res) {
  const cabeceras = new Headers(res.headers);
  cabeceras.set('X-Desde-Cache', '1');
  const cuerpo = await res.clone().blob();
  return new Response(cuerpo, { status: res.status, statusText: res.statusText, headers: cabeceras });
}

async function redPrimero(req, nombreCache, ms, marcar) {
  const cache = await caches.open(nombreCache);
  try {
    const res = await conLimite(fetch(req), ms);
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const guardada = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (guardada) return marcar ? marcarDesdeCache(guardada) : guardada;
    throw err;
  }
}

async function cachePrimero(req) {
  const cache = await caches.open(CACHE);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const ruta = url.pathname;

  if (ruta === '/api/public/menu') {
    e.respondWith(redPrimero(req, CACHE_DATOS, 6000, true).then((res) => res, () => new Response(JSON.stringify({ error: 'Sin conexión.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (ruta.startsWith('/api/')) return;

  if (ruta === '/' && req.mode === 'navigate') {
    e.respondWith(redPrimero(req, CACHE, 4000));
    return;
  }
  if (ruta.startsWith('/uploads/') || ruta.startsWith('/icons/') || ruta.startsWith('/vendor/') || ruta === '/favicon.svg') {
    e.respondWith(cachePrimero(req));
    return;
  }
  if (ruta.startsWith('/css/') || ruta.startsWith('/js/')) {
    // Solo los archivos de la tienda; los del panel no se guardan.
    if (/\/(admin|pedidos|ajustes|estadisticas|login|monitorPedidos|comunAdmin|qr)/.test(ruta)) return;
    e.respondWith(redPrimero(req, CACHE, 3000));
  }
});
