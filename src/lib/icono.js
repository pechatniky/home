// Icono personalizado del sitio (favicon, icono de la app instalada, vista
// previa en redes). El admin sube UNA imagen en Ajustes y aquí se generan
// todos los tamaños. Se guardan en public/uploads/icono/ (entra en las
// copias de seguridad cuando se incluyen las fotos).

const path = require('path');
const fs = require('fs/promises');
const { Jimp } = require('jimp');
const { UPLOADS_ROOT } = require('../config');
const { leerRotacionExif } = require('./exif');

const DIR = path.join(UPLOADS_ROOT, 'icono');

// nombre público (en /icons/ o raíz) → archivo en disco
const ARCHIVOS = {
  'icon-192.png': 'icon-192.png',
  'icon-512.png': 'icon-512.png',
  'icon-maskable-512.png': 'icon-maskable-512.png',
  'apple-touch-icon.png': 'apple-touch-icon.png',
  'favicon-32.png': 'favicon-32.png',
};

async function generar(buffer) {
  const origen = await Jimp.read(buffer);
  const grados = leerRotacionExif(buffer);
  if (grados) origen.rotate(grados);
  if (origen.width < 64 || origen.height < 64) throw new Error('La imagen es demasiado pequeña (mínimo 64×64 px).');

  const cuadrada = (lado) => origen.clone().cover({ w: lado, h: lado });
  await fs.mkdir(DIR, { recursive: true });

  const salidas = {
    'icon-512.png': await cuadrada(512).getBuffer('image/png'),
    'icon-192.png': await cuadrada(192).getBuffer('image/png'),
    'apple-touch-icon.png': await cuadrada(180).getBuffer('image/png'),
    'favicon-32.png': await cuadrada(48).getBuffer('image/png'),
  };

  // Versión "maskable": el icono ocupa ~70% centrado sobre un fondo sólido
  // (Android recorta los bordes en círculo/cuadrado redondeado).
  const color = origen.getPixelColor(0, 0);
  const opaco = (color & 0xff) === 0xff ? color : 0xffffffff;
  const lienzo = new Jimp({ width: 512, height: 512, color: opaco });
  lienzo.composite(cuadrada(360), 76, 76);
  salidas['icon-maskable-512.png'] = await lienzo.getBuffer('image/png');

  await Promise.all(Object.entries(salidas).map(([n, b]) => fs.writeFile(path.join(DIR, n), b)));
  return `v${Date.now().toString(36)}`;
}

async function quitar() {
  await fs.rm(DIR, { recursive: true, force: true });
}

// Ruta absoluta de un icono personalizado, o null si no hay.
function rutaDe(nombre) {
  return ARCHIVOS[nombre] ? path.join(DIR, ARCHIVOS[nombre]) : null;
}

// Etiquetas <link> para el <head>.
function etiquetas(tienda) {
  const v = tienda && tienda.icono ? `?${encodeURIComponent(tienda.icono)}` : '';
  if (!v) {
    return [
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
      '<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />',
    ].join('\n');
  }
  return [
    `<link rel="icon" type="image/png" sizes="48x48" href="/favicon-32.png${v}" />`,
    `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png${v}" />`,
  ].join('\n');
}

function sufijo(tienda) {
  return tienda && tienda.icono ? `?${encodeURIComponent(tienda.icono)}` : '';
}

module.exports = { generar, quitar, rutaDe, etiquetas, sufijo, DIR };
