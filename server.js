// Точка входа. Запускается обычным `node server.js` (без pm2):
//
//  • Процесс-СУПЕРВИЗОР (по умолчанию) запускает сам сервер как дочерний
//    процесс и перезапускает его, если он вдруг упал (с нарастающей паузой,
//    чтобы не крутиться в цикле). Отключить: NO_SUPERVISOR=1.
//  • Внутри сервера любая необработанная ошибка логируется и отправляется в
//    Telegram, но процесс продолжает работать.
//  • Фатальные проблемы конфигурации (порт занят и т.п.) — понятное сообщение
//    и выход без бесконечных перезапусков.
//
// Логи: logs/server.log. Состояние: GET /health.

const { spawn } = require('child_process');

const ES_HIJO = process.env.PECHATNIKY_CHILD === '1';
const CODIGO_FATAL = 78;

// ============================================================
//  Supervisor
// ============================================================
function supervisor() {
  require('./src/lib/log').instalar();
  let hijo = null;
  let apagando = false;
  let reinicios = 0;
  let espera = 1000;
  let inicio = 0;

  function lanzar() {
    inicio = Date.now();
    hijo = spawn(process.execPath, [__filename], {
      stdio: 'inherit',
      env: { ...process.env, PECHATNIKY_CHILD: '1', PECHATNIKY_REINICIOS: String(reinicios) },
    });
    hijo.on('error', (err) => console.error('No se pudo lanzar el servidor:', err.message));
    hijo.on('exit', (codigo, senal) => {
      if (apagando) process.exit(0);
      if (codigo === 0) process.exit(0);
      if (codigo === CODIGO_FATAL) process.exit(1);
      if (Date.now() - inicio > 60000) espera = 1000; // vivió un buen rato: reinicio rápido
      reinicios += 1;
      console.error(`⚠️ El servidor se detuvo (código ${codigo}${senal ? `, señal ${senal}` : ''}). Reinicio #${reinicios} en ${Math.round(espera / 1000)} s…`);
      setTimeout(lanzar, espera);
      espera = Math.min(espera * 2, 30000);
    });
  }

  const apagar = () => {
    if (apagando) return;
    apagando = true;
    if (hijo) { try { hijo.kill('SIGTERM'); } catch (_) { /* ya terminó */ } }
    setTimeout(() => process.exit(0), 6000).unref();
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
  process.on('SIGHUP', () => {}); // cerrar la terminal SSH no debe matar el servidor
  lanzar();
}

// ============================================================
//  Servidor
// ============================================================
async function servidor() {
  require('./src/lib/log').instalar();
  const config = require('./src/config');
  const { emitir } = require('./src/lib/eventos');

  // ---- Red de seguridad global: un error suelto NO tumba el servidor ----
  const caidas = [];
  function registrarFallo(tipo, err) {
    console.error(`⚠️ ${tipo}:`, err);
    emitir('error', { mensaje: `${tipo}: ${(err && err.message) || err}` });
    const ahora = Date.now();
    caidas.push(ahora);
    while (caidas.length && ahora - caidas[0] > 60000) caidas.shift();
    // Muchos fallos seguidos = estado dudoso: salimos y el supervisor reinicia limpio.
    if (caidas.length > 20) {
      console.error('Demasiados errores seguidos; reiniciando el proceso.');
      salir(1);
    }
  }
  process.on('uncaughtException', (err) => registrarFallo('Excepción no controlada', err));
  process.on('unhandledRejection', (err) => registrarFallo('Promesa rechazada sin manejar', err));
  process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w.message); });

  let app;
  let http = null;
  const Telegram = require('./src/services/telegram');

  function salir(codigo) {
    try { if (app && app.locals.sessionStore) app.locals.sessionStore.flush(true); } catch (_) { /* ignorar */ }
    try { Telegram.detener(); } catch (_) { /* ignorar */ }
    setTimeout(() => process.exit(codigo), 200).unref();
    if (http) { try { http.close(() => process.exit(codigo)); } catch (_) { process.exit(codigo); } }
    else process.exit(codigo);
  }
  process.on('SIGINT', () => salir(0));
  process.on('SIGTERM', () => salir(0));
  process.on('SIGHUP', () => {});

  // ---- Datos listos ----
  try {
    await require('./src/lib/bootstrap').preparar();
  } catch (err) {
    console.error('❌ No se pudieron preparar los datos:', err);
    process.exit(CODIGO_FATAL);
  }

  app = require('./src/app').crearApp();

  function escuchar(puerto, permitirRespaldo) {
    const srv = app.listen(puerto);
    srv.on('listening', () => {
      http = srv;
      srv.keepAliveTimeout = 65000;
      srv.headersTimeout = 70000;
      srv.requestTimeout = 60000;
      console.log(`✅ Tienda disponible en http://localhost:${puerto}`);
      console.log(`   Panel de administración en http://localhost:${puerto}/admin`);
      iniciarServicios();
    });
    srv.on('error', (err) => {
      if (err.code === 'EACCES' && permitirRespaldo) {
        console.warn(`⚠️ Sin permiso para usar el puerto ${puerto}. Usando el 3000 (para el 80 ejecuta con sudo o define PORT).`);
        return escuchar(3000, false);
      }
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${puerto} ya está ocupado (¿hay otra copia del servidor en marcha?). Ciérrala o usa otro puerto: PORT=3000 node server.js`);
        return process.exit(CODIGO_FATAL);
      }
      if (err.code === 'EACCES') {
        console.error(`❌ Sin permiso para usar el puerto ${puerto}. Usa un puerto mayor a 1024 (PORT=3000) o ejecuta con sudo.`);
        return process.exit(CODIGO_FATAL);
      }
      console.error('Error del servidor HTTP:', err);
    });
    srv.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) { /* ignorar */ } });
  }

  function iniciarServicios() {
    Telegram.iniciar().catch((e) => console.error('Telegram:', e.message));
    require('./src/services/backup').iniciar();
    const reinicio = Number(process.env.PECHATNIKY_REINICIOS) || 0;
    emitir('servidor', { reinicio: reinicio || null });
  }

  escuchar(Number(config.PORT), !process.env.PORT);
}

if (ES_HIJO || process.env.NO_SUPERVISOR === '1') {
  servidor().catch((err) => {
    console.error('❌ Fallo al iniciar:', err);
    process.exit(1);
  });
} else {
  supervisor();
}
