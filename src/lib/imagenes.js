// Subida y procesamiento de imágenes de platos: multer (recepción) + jimp
// (redimensión y recompresión) — jimp es 100% JS, sin binarios nativos.

const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const { Jimp } = require('jimp');
const { leerRotacionExif } = require('./exif');
const {
  UPLOADS_DIR,
  PUBLIC_DIR,
  IMAGEN_LADO_MAXIMO,
  IMAGEN_CALIDAD_JPEG,
  TIPOS_IMAGEN_PERMITIDOS,
} = require('../config');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB antes de comprimir
  fileFilter: (req, file, cb) => {
    if (!TIPOS_IMAGEN_PERMITIDOS.includes(file.mimetype)) {
      return cb(new Error('Formato no permitido. Usa una imagen JPG, PNG, WEBP o GIF.'));
    }
    cb(null, true);
  },
});

// Recomprime la imagen y la guarda como .jpg en UPLOADS_DIR con el nombre dado.
async function procesarYGuardarImagen(buffer, nombreArchivo) {
  const imagen = await Jimp.read(buffer);

  // Corrige la rotación si el celular guardó la foto con orientación EXIF
  // en vez de rotar los píxeles (caso muy común en fotos de celular).
  const grados = leerRotacionExif(buffer);
  if (grados) imagen.rotate(grados);

  // Reduce el tamaño solo si la foto es más grande que el máximo permitido
  // (nunca agranda una imagen más chica).
  if (imagen.width > IMAGEN_LADO_MAXIMO || imagen.height > IMAGEN_LADO_MAXIMO) {
    imagen.scaleToFit({ w: IMAGEN_LADO_MAXIMO, h: IMAGEN_LADO_MAXIMO });
  }

  const salida = await imagen.getBuffer('image/jpeg', { quality: IMAGEN_CALIDAD_JPEG });
  await fs.writeFile(path.join(UPLOADS_DIR, nombreArchivo), salida);
}

// Elimina un archivo de imagen subido, si existe y pertenece a /uploads/productos/.
// Silencioso: no hay problema si el archivo ya no está.
async function eliminarImagenSubida(rutaPublica) {
  if (!rutaPublica || !rutaPublica.startsWith('/uploads/productos/')) return;
  const rutaAbsoluta = path.join(PUBLIC_DIR, rutaPublica);
  try {
    await fs.unlink(rutaAbsoluta);
  } catch (_) {
    // Файла уже может не быть — не критично
  }
}

module.exports = { upload, procesarYGuardarImagen, eliminarImagenSubida };
