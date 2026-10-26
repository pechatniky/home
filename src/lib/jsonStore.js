// Чтение/запись JSON-файлов хранилища данных (без базы данных).
//
// Запись АТОМАРНАЯ: пишем во временный файл рядом и переименовываем поверх
// оригинала. Если процесс умрёт (или пропадёт свет) посреди записи, в файле
// останется либо старая версия, либо новая — но никогда не «обрубок» JSON,
// из-за которого сервер потом не мог бы стартовать.

const fs = require('fs/promises');
const path = require('path');

// readJson(ruta) — lanza error si el archivo no existe o está corrupto.
// readJson(ruta, valorPorDefecto) — si el archivo NO existe devuelve el valor
// por defecto (un archivo corrupto sigue lanzando error: es mejor enterarse
// que pisar datos reales con un valor vacío).
async function readJson(filePath, porDefecto) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT' && porDefecto !== undefined) {
      return typeof porDefecto === 'function' ? porDefecto() : JSON.parse(JSON.stringify(porDefecto));
    }
    throw err;
  }
  // Quita BOM por si el archivo se editó a mano con Notepad.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  try {
    return JSON.parse(raw);
  } catch (err) {
    const e = new Error(`El archivo ${path.basename(filePath)} está dañado (JSON inválido): ${err.message}`);
    e.code = 'JSON_CORRUPTO';
    throw e;
  }
}

let contadorTmp = 0;
async function writeJson(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${contadorTmp++}.tmp`;
  const texto = JSON.stringify(data, null, 2);
  try {
    await fs.writeFile(tmp, texto, 'utf-8');
    await fs.rename(tmp, filePath);
  } catch (err) {
    fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

// Простая последовательная "очередь" на запись, чтобы параллельные
// запросы не затирали друг друга при работе с одним файлом.
// ВАЖНО: нельзя вызывать queueWrite внутри другой задачи queueWrite —
// это дедлок (внутренняя ждёт внешнюю).
let writeQueue = Promise.resolve();
function queueWrite(task) {
  const resultado = writeQueue.then(task, task);
  // La cola nunca debe quedar en estado "rechazado" ni generar
  // unhandledRejection: el error le llega a quien hizo await del resultado.
  writeQueue = resultado.catch(() => {});
  return resultado;
}

module.exports = { readJson, writeJson, queueWrite };
