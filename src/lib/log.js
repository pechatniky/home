// Логирование в консоль И в файл logs/server.log (с ротацией по размеру).
// Без pm2 это единственный след, по которому можно понять, что произошло
// ночью. Любая ошибка записи лога подавляется — лог не должен ронять сервер.

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'server.log');
const MAX_BYTES = 2 * 1024 * 1024;

let listo = false;
let tamano = 0;

function preparar() {
  if (listo) return;
  listo = true;
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    try { tamano = fs.statSync(LOG_FILE).size; } catch (_) { tamano = 0; }
  } catch (_) { /* sin logs en archivo */ }
}

function aTexto(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    })
    .join(' ');
}

function escribir(nivel, args) {
  preparar();
  const linea = `${new Date().toISOString()} [${nivel}] ${aTexto(args)}\n`;
  try {
    if (tamano > MAX_BYTES) {
      try { fs.renameSync(LOG_FILE, `${LOG_FILE}.1`); } catch (_) { /* ya no existe */ }
      tamano = 0;
    }
    fs.appendFileSync(LOG_FILE, linea);
    tamano += Buffer.byteLength(linea);
  } catch (_) { /* ignorar */ }
}

// Дублирует console.* в файл. Вызывается один раз при старте.
function instalar() {
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  console.log = (...a) => { orig.log(...a); escribir('INFO', a); };
  console.info = (...a) => { orig.info(...a); escribir('INFO', a); };
  console.warn = (...a) => { orig.warn(...a); escribir('WARN', a); };
  console.error = (...a) => { orig.error(...a); escribir('ERROR', a); };
}

module.exports = { instalar, LOGS_DIR, LOG_FILE };
