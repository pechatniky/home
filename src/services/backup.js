// Резервные копии: копирует data/*.json (и по желанию загруженные фото) в
// backups/<дата-время>/. Запускается по расписанию (частота — в настройках
// админа), вручную из панели или из Telegram. Старые копии удаляются сверх
// лимита "conservar". Любую копию можно скачать одним ZIP-файлом.

const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { queueWrite } = require('../lib/jsonStore');
const { DATA_DIR, BACKUPS_DIR, UPLOADS_ROOT } = require('../config');
const Ajustes = require('../lib/ajustes');
const { emitir } = require('../lib/eventos');

const NOMBRE_RE = /^backup-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d+)?$/;
const EXCLUIDOS = new Set(['sessions.json', 'secret.txt']); // sesiones no se respaldan; el secreto tampoco

let enCurso = false;

function nombreNuevo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function tamanoDir(dir) {
  let total = 0;
  let entradas = [];
  try { entradas = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return 0; }
  for (const e of entradas) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) total += await tamanoDir(ruta);
    else { try { total += (await fs.stat(ruta)).size; } catch (_) { /* ignorar */ } }
  }
  return total;
}

async function listar() {
  let nombres = [];
  try { nombres = await fs.readdir(BACKUPS_DIR); } catch (_) { return []; }
  const out = [];
  for (const nombre of nombres.filter((n) => NOMBRE_RE.test(n))) {
    const dir = path.join(BACKUPS_DIR, nombre);
    let info = {};
    try { info = JSON.parse(await fs.readFile(path.join(dir, 'info.json'), 'utf-8')); } catch (_) { /* sin info */ }
    let stat;
    try { stat = await fs.stat(dir); } catch (_) { continue; }
    out.push({
      nombre,
      creadoEn: info.creadoEn || stat.mtime.toISOString(),
      manual: Boolean(info.manual),
      imagenes: Boolean(info.imagenes),
      tamano: await tamanoDir(dir),
    });
  }
  out.sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  return out;
}

async function crear({ manual = false } = {}) {
  if (enCurso) throw new Error('Ya hay una copia de seguridad en curso.');
  enCurso = true;
  try {
    const ajustes = await Ajustes.obtener();
    const incluirImagenes = ajustes.backup.incluirImagenes;
    let nombre = nombreNuevo();
    await fs.mkdir(BACKUPS_DIR, { recursive: true });
    // Dos copias en el mismo segundo → sufijo
    for (let i = 2; ; i++) {
      try { await fs.access(path.join(BACKUPS_DIR, nombre)); nombre = `${nombreNuevo()}-${i}`; } catch (_) { break; }
    }
    const destino = path.join(BACKUPS_DIR, nombre);
    const destData = path.join(destino, 'data');
    await fs.mkdir(destData, { recursive: true });

    // Datos: dentro de la cola de escritura para una foto consistente.
    const archivos = [];
    await queueWrite(async () => {
      const lista = await fs.readdir(DATA_DIR);
      for (const f of lista) {
        if (!f.endsWith('.json') || EXCLUIDOS.has(f)) continue;
        await fs.copyFile(path.join(DATA_DIR, f), path.join(destData, f));
        archivos.push(f);
      }
    });

    if (incluirImagenes) {
      try { await fs.cp(UPLOADS_ROOT, path.join(destino, 'uploads'), { recursive: true }); } catch (_) { /* sin imágenes */ }
    }

    await fs.writeFile(path.join(destino, 'info.json'), JSON.stringify({
      creadoEn: new Date().toISOString(), manual, imagenes: incluirImagenes, archivos,
    }, null, 2));

    await podar(ajustes.backup.conservar);
    const tamano = await tamanoDir(destino);
    emitir('backup', { ok: true, nombre, tamano, manual });
    return { nombre, tamano };
  } catch (err) {
    emitir('backup', { ok: false, error: err.message, manual });
    throw err;
  } finally {
    enCurso = false;
  }
}

async function podar(conservar) {
  const todas = await listar();
  const sobran = todas.slice(Math.max(1, conservar));
  for (const b of sobran) {
    await fs.rm(path.join(BACKUPS_DIR, b.nombre), { recursive: true, force: true }).catch(() => {});
  }
}

async function eliminar(nombre) {
  if (!NOMBRE_RE.test(nombre)) throw new Error('Nombre de copia inválido.');
  await fs.rm(path.join(BACKUPS_DIR, nombre), { recursive: true, force: true });
}

// ---------- ZIP (sin dependencias): deflate por archivo ----------
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function listarArchivos(dir, base = '') {
  const out = [];
  const entradas = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entradas) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listarArchivos(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function escribirZip(nombre, res) {
  if (!NOMBRE_RE.test(nombre)) throw new Error('Nombre de copia inválido.');
  const dir = path.join(BACKUPS_DIR, nombre);
  const archivos = await listarArchivos(dir);
  return escribirZipEntradas(archivos.map((rel) => ({ ruta: `${nombre}/${rel}`, archivo: path.join(dir, rel) })), res);
}

// Núcleo del ZIP: entradas = [{ ruta, archivo } | { ruta, datos }]
async function escribirZipEntradas(entradas, res) {
  const central = [];
  let offset = 0;
  const escribir = (buf) => new Promise((ok) => { offset += buf.length; if (res.write(buf)) ok(); else res.once('drain', ok); });

  const ahora = new Date();
  const dosHora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const dosFecha = ((ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  for (const entrada of entradas) {
    const datos = entrada.datos || await fs.readFile(entrada.archivo);
    const comprimido = zlib.deflateRawSync(datos);
    const usarDeflate = comprimido.length < datos.length;
    const cuerpo = usarDeflate ? comprimido : datos;
    const nombreBuf = Buffer.from(entrada.ruta, 'utf-8');
    const crc = crc32(datos);

    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0800, 6); // UTF-8
    h.writeUInt16LE(usarDeflate ? 8 : 0, 8);
    h.writeUInt16LE(dosHora, 10);
    h.writeUInt16LE(dosFecha, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(cuerpo.length, 18);
    h.writeUInt32LE(datos.length, 22);
    h.writeUInt16LE(nombreBuf.length, 26);
    h.writeUInt16LE(0, 28);
    const posLocal = offset;
    await escribir(Buffer.concat([h, nombreBuf]));
    await escribir(cuerpo);
    central.push({ nombreBuf, crc, comp: cuerpo.length, orig: datos.length, metodo: usarDeflate ? 8 : 0, pos: posLocal });
  }

  const inicioCentral = offset;
  let tamCentral = 0;
  for (const c of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(0x0800, 8);
    h.writeUInt16LE(c.metodo, 10);
    h.writeUInt16LE(dosHora, 12);
    h.writeUInt16LE(dosFecha, 14);
    h.writeUInt32LE(c.crc, 16);
    h.writeUInt32LE(c.comp, 20);
    h.writeUInt32LE(c.orig, 24);
    h.writeUInt16LE(c.nombreBuf.length, 28);
    h.writeUInt32LE(c.pos, 42);
    const buf = Buffer.concat([h, c.nombreBuf]);
    tamCentral += buf.length;
    await escribir(buf);
  }
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(central.length, 8);
  fin.writeUInt16LE(central.length, 10);
  fin.writeUInt32LE(tamCentral, 12);
  fin.writeUInt32LE(inicioCentral, 16);
  await escribir(fin);
  res.end();
}

// ---------- Copia por Telegram ----------
// ZIP en memoria SOLO con los datos (pedidos, clientes, platos, ajustes): las
// fotos no se mandan (Telegram admite hasta 50 MB por archivo).
async function zipDatosEnMemoria() {
  const { Writable } = require('stream');
  const trozos = [];
  const salida = new Writable({ write(chunk, enc, cb) { trozos.push(Buffer.from(chunk)); cb(); } });
  const entradas = [];
  const fecha = nombreNuevo().replace('backup-', '');
  await queueWrite(async () => {
    const lista = await fs.readdir(DATA_DIR);
    for (const f of lista) {
      if (!f.endsWith('.json') || EXCLUIDOS.has(f)) continue;
      entradas.push({ ruta: `datos-${fecha}/${f}`, datos: await fs.readFile(path.join(DATA_DIR, f)) });
    }
  });
  await escribirZipEntradas(entradas, salida);
  await new Promise((r) => { if (salida.writableFinished) r(); else salida.once('finish', r); });
  return { buffer: Buffer.concat(trozos), nombre: `copia-${fecha}.zip`, archivos: entradas.length };
}

let enviandoTg = false;
let fallosTgDesde = 0; // para no reintentar cada 5 min si algo falla

// Manda el ZIP a los chats vinculados (o solo a `chats`). Devuelve cuántos recibieron.
async function enviarATelegram({ chats, manual = false } = {}) {
  if (enviandoTg) throw new Error('Ya se está enviando una copia a Telegram.');
  enviandoTg = true;
  try {
    const Telegram = require('./telegram');
    const a = await Ajustes.obtener();
    const destinos = chats || a.telegram.chatIds;
    if (!a.telegram.token) throw new Error('Primero guarda el token del bot de Telegram.');
    if (!destinos.length) throw new Error('Todavía no hay ningún chat vinculado a Telegram.');
    const z = await zipDatosEnMemoria();
    if (z.buffer.length > 49 * 1024 * 1024) throw new Error('La copia pesa más de 49 MB y Telegram no la admite.');
    const caption = `💾 Copia de seguridad${manual ? '' : ' automática'}\n${new Date().toLocaleString('es')}\n${(z.buffer.length / 1024).toFixed(0)} KB · ${z.archivos} archivos`;
    const enviados = await Telegram.enviarDocumento(destinos, z.buffer, z.nombre, caption);
    if (!enviados) throw new Error('Telegram no aceptó el archivo. Revisa que el bot esté conectado.');
    await Ajustes.actualizar((x) => { x.backup.telegramUltimo = new Date().toISOString(); return x; });
    fallosTgDesde = 0;
    return { enviados, tamano: z.buffer.length };
  } finally {
    enviandoTg = false;
  }
}

async function revisarTelegram(a) {
  const b = a.backup;
  if (!b.telegramActivo || !a.telegram.token || !a.telegram.chatIds.length || enviandoTg) return;
  if (fallosTgDesde && Date.now() - fallosTgDesde < 3600 * 1000) return; // tras un fallo, esperamos 1 h
  const ultimo = b.telegramUltimo ? new Date(b.telegramUltimo).getTime() : 0;
  if (Date.now() - ultimo < b.telegramCadaHoras * 3600 * 1000) return;
  try {
    await enviarATelegram({ manual: false });
    console.log('📤 Copia de seguridad enviada por Telegram.');
  } catch (err) {
    fallosTgDesde = Date.now();
    console.error('No se pudo enviar la copia por Telegram:', err.message);
  }
}

// ---------- Планировщик ----------
let temporizador = null;

async function revisar() {
  try {
    const ajustes = await Ajustes.obtener();
    await revisarTelegram(ajustes);
    if (!ajustes.backup.activo || enCurso) return;
    const todas = await listar();
    const ultima = todas[0] ? new Date(todas[0].creadoEn).getTime() : 0;
    const cadaMs = ajustes.backup.frecuenciaHoras * 3600 * 1000;
    if (Date.now() - ultima >= cadaMs) {
      await crear({ manual: false });
      console.log('💾 Copia de seguridad automática creada.');
    }
  } catch (err) {
    console.error('Fallo en la copia automática:', err.message);
  }
}

function iniciar() {
  if (temporizador) return;
  setTimeout(revisar, 20 * 1000).unref();
  temporizador = setInterval(revisar, 5 * 60 * 1000);
  temporizador.unref();
}

module.exports = { crear, listar, eliminar, escribirZip, enviarATelegram, zipDatosEnMemoria, iniciar, NOMBRE_RE, enCurso: () => enCurso };
