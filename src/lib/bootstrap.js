// Подготовка данных при старте: создаёт недостающие файлы, лечит повреждённый
// JSON (из последней резервной копии), досчитывает номера старых заказов.
// Цель — сервер НИКОГДА не падает при старте из-за состояния data/.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
  DATA_DIR, BACKUPS_DIR, UPLOADS_DIR, PRODUCTS_FILE, CATEGORIES_FILE, SETTINGS_FILE,
  USERS_FILE, ORDERS_FILE, CLIENTES_FILE, SECRET_FILE,
} = require('../config');
const { readJson, writeJson } = require('./jsonStore');

const POR_DEFECTO = new Map([
  [PRODUCTS_FILE, () => []],
  [CATEGORIES_FILE, () => [
    { id: 'desayunos', nombre: 'Desayunos' },
    { id: 'almuerzos', nombre: 'Almuerzos' },
    { id: 'postres', nombre: 'Postres' },
    { id: 'bebidas', nombre: 'Bebidas' },
  ]],
  [SETTINGS_FILE, () => ({})],
  [USERS_FILE, () => [{ id: 'admin', usuario: 'admin', password: 'cafeteria2026', tema: 'oscuro' }]],
  [ORDERS_FILE, () => []],
  [CLIENTES_FILE, () => []],
]);

async function ultimaCopia(nombreArchivo) {
  try {
    const nombres = (await fsp.readdir(BACKUPS_DIR)).filter((n) => n.startsWith('backup-')).sort().reverse();
    for (const n of nombres) {
      const f = path.join(BACKUPS_DIR, n, 'data', nombreArchivo);
      try { JSON.parse(await fsp.readFile(f, 'utf-8')); return f; } catch (_) { /* siguiente */ }
    }
  } catch (_) { /* sin copias */ }
  return null;
}

async function prepararArchivo(ruta, crearPorDefecto) {
  const nombre = path.basename(ruta);
  try {
    await readJson(ruta);
    return;
  } catch (err) {
    if (err.code === 'ENOENT') {
      await writeJson(ruta, crearPorDefecto());
      console.log(`📄 Creado ${nombre} (no existía).`);
      return;
    }
    if (err.code !== 'JSON_CORRUPTO') throw err;
  }
  // Archivo dañado: se aparta (no se borra) y se restaura
  const apartado = `${ruta}.corrupto-${Date.now()}`;
  await fsp.rename(ruta, apartado);
  const copia = await ultimaCopia(nombre);
  if (copia) {
    await fsp.copyFile(copia, ruta);
    console.error(`⚠️ ${nombre} estaba dañado. Restaurado desde la última copia (${path.basename(path.dirname(path.dirname(copia)))}). El original quedó en ${path.basename(apartado)}.`);
  } else {
    await writeJson(ruta, crearPorDefecto());
    console.error(`⚠️ ${nombre} estaba dañado y no hay copias. Se creó uno vacío. El original quedó en ${path.basename(apartado)}.`);
  }
}

async function preparar() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  for (const [ruta, def] of POR_DEFECTO) await prepararArchivo(ruta, def);

  // Pedidos antiguos: asignar número, historial y método de pago
  const pedidos = await readJson(ORDERS_FILE, []);
  let cambio = false;
  const sinNumero = pedidos.filter((p) => !p.numero).sort((a, b) => new Date(a.creadoEn) - new Date(b.creadoEn));
  if (sinNumero.length) {
    let n = pedidos.reduce((m, p) => Math.max(m, Number(p.numero) || 0), 0);
    sinNumero.forEach((p) => { p.numero = ++n; });
    cambio = true;
  }
  pedidos.forEach((p) => {
    if (!Array.isArray(p.historial)) {
      p.historial = [{ fecha: p.creadoEn, tipo: 'creado', texto: 'Pedido recibido' }];
      cambio = true;
    }
  });
  if (cambio) {
    await writeJson(ORDERS_FILE, pedidos);
    console.log(`🔢 Numerados ${sinNumero.length} pedidos antiguos.`);
  }
}

// Secreto de sesión: variable de entorno, o archivo persistente generado una vez.
function obtenerSecreto() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const s = fs.readFileSync(SECRET_FILE, 'utf-8').trim();
    if (s.length >= 16) return s;
  } catch (_) { /* no existe todavía */ }
  const nuevo = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(SECRET_FILE, nuevo, { mode: 0o600 }); } catch (err) { console.error('No se pudo guardar secret.txt:', err.message); }
  return nuevo;
}

module.exports = { preparar, obtenerSecreto };
