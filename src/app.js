// Сборка Express-приложения: middleware, лимиты, роуты, обработка ошибок.
//
// Порядок регистрации роутов важен:
//   1. /api/public/*  — без авторизации (каталог, заказы и аккаунты клиентов)
//   2. /api (login)   — тоже без авторизации
//   3. requireAuth     — всё остальное под /api закрывается паролем
//   4. /api/...        — защищённые API-роуты панели администратора
//   5. /               — HTML-страницы и файлы PWA

const express = require('express');
const session = require('express-session');
const path = require('path');

const config = require('./config');
const requireAuth = require('./middleware/requireAuth');
const FileSessionStore = require('./lib/sessionStore');
const { crearLimitador } = require('./middleware/rateLimit');
const { emitir } = require('./lib/eventos');
const { obtenerSecreto } = require('./lib/bootstrap');

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  // Detrás de nginx/Cloudflare req.ip debe ser la IP real del cliente.
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');

  // Сжатие ответов (если пакет установлен) — важно для медленного интернета.
  try { app.use(require('compression')()); } catch (_) { /* opcional */ }

  app.use(express.json({ limit: '200kb' }));

  const store = new FileSessionStore({ file: config.SESSIONS_FILE });
  app.locals.sessionStore = store;
  app.use(session({
    name: 'pechatniky.sid',
    secret: obtenerSecreto(),
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true, // la sesión se renueva con el uso
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
      // secure: true — actívalo cuando el sitio funcione solo por HTTPS
    },
  }));

  // Icono personalizado del sitio (antes que los estáticos por defecto)
  app.use(require('./routes/iconos'));

  // ---------- Archivos estáticos con caché sensata ----------
  app.use(express.static(config.PUBLIC_DIR, {
    etag: true,
    index: false,
    setHeaders(res, file) {
      const rel = path.relative(config.PUBLIC_DIR, file).split(path.sep).join('/');
      if (rel.startsWith('uploads/')) res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      else if (rel.startsWith('vendor/')) res.setHeader('Cache-Control', 'public, max-age=2592000');
      else if (rel.startsWith('icons/') || rel === 'favicon.svg') res.setHeader('Cache-Control', 'public, max-age=86400');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // ---------- Límites de peticiones ----------
  // (Generosos a propósito: muchos clientes comparten IP en redes móviles.)
  const limiteGeneral = crearLimitador({ ventanaMs: 60 * 1000, max: 1500, mensaje: 'Demasiadas solicitudes seguidas.' });
  const limiteLoginAdmin = crearLimitador({ ventanaMs: 15 * 60 * 1000, max: 25, mensaje: 'Demasiados intentos de acceso.' });
  const limiteLoginCliente = crearLimitador({
    ventanaMs: 15 * 60 * 1000, max: 20, mensaje: 'Demasiados intentos de inicio de sesión.',
    clave: (req) => `${req.ip}|${String((req.body && req.body.email) || '').toLowerCase()}`,
  });
  const limiteRegistro = crearLimitador({ ventanaMs: 60 * 60 * 1000, max: 20, mensaje: 'Se crearon demasiadas cuentas desde esta conexión.' });
  const limitePedidos = crearLimitador({
    ventanaMs: 10 * 60 * 1000, max: 25, mensaje: 'Estás enviando pedidos demasiado seguido.',
    clave: (req) => req.session.clienteId || req.ip,
  });
  const limiteClaves = crearLimitador({ ventanaMs: 60 * 60 * 1000, max: 15, mensaje: 'Demasiados intentos de cambiar la contraseña.' });

  app.use('/api', limiteGeneral);
  app.post('/api/login', limiteLoginAdmin);
  app.post('/api/public/login', limiteLoginCliente);
  app.post('/api/public/register', limiteRegistro);
  app.post('/api/public/orders', limitePedidos);
  app.post('/api/public/me/password', limiteClaves);
  app.post('/api/password', limiteClaves);

  // ---------- API pública ----------
  app.use('/api/public', require('./routes/publico'));
  app.use('/api/public', require('./routes/clientes'));

  // ---------- Login / logout ----------
  app.use('/api', require('./routes/auth'));

  // ---------- A partir de aquí, sesión de administrador ----------
  app.use('/api', requireAuth);
  app.use('/api', require('./routes/usuario'));
  app.use('/api', require('./routes/upload'));
  app.use('/api/products', require('./routes/productos'));
  app.use('/api/categories', require('./routes/categorias'));
  app.use('/api/settings', require('./routes/ajustes'));
  app.use('/api/orders', require('./routes/pedidos'));
  app.use('/api/backups', require('./routes/backups'));
  app.use('/api/stats', require('./routes/stats'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

  // ---------- Páginas ----------
  app.use('/', require('./routes/paginas'));

  app.use((req, res) => {
    res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No encontrado</title><body style="font-family:system-ui;text-align:center;padding:60px 20px"><h1>404</h1><p>Esta página no existe.</p><p><a href="/">Volver a la tienda</a></p>');
  });

  // ---------- Errores: nunca tumban el proceso ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) { try { res.end(); } catch (_) { /* ignorar */ } return; }
    const esApi = req.originalUrl.startsWith('/api');
    let status = 500;
    let mensaje = 'Ocurrió un error en el servidor. Intenta de nuevo en un momento.';

    if (err && err.esNegocio) {
      status = err.status;
      mensaje = err.message;
    } else if (err && err.type === 'entity.parse.failed') {
      status = 400; mensaje = 'La solicitud no es válida.';
    } else if (err && err.type === 'entity.too.large') {
      status = 413; mensaje = 'La solicitud es demasiado grande.';
    } else {
      console.error(`Error en ${req.method} ${req.originalUrl}:`, err);
      emitir('error', { mensaje: `${req.method} ${req.originalUrl}: ${err && err.message}` });
      if (err && err.code === 'JSON_CORRUPTO') mensaje = err.message;
    }
    if (esApi) res.status(status).json({ error: mensaje });
    else res.status(status).type('text').send(mensaje);
  });

  return app;
}

module.exports = { crearApp };
