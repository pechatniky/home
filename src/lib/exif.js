// Lectura mínima de metadatos EXIF de un JPEG, sin dependencias externas.

// Lee el tag EXIF "Orientation" de un JPEG y devuelve cuántos grados hay que
// rotar la imagen para que quede derecha. Muchos celulares guardan la foto
// "acostada" y solo marcan la orientación correcta en este metadato, en vez
// de rotar los píxeles.
function leerRotacionExif(buffer) {
  try {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 0; // no es JPEG
    let offset = 2;
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xff) break;
      const marcador = buffer[offset + 1];
      if (marcador === 0xd8 || marcador === 0xd9) { offset += 2; continue; }
      const largoSegmento = buffer.readUInt16BE(offset + 2);
      if (marcador === 0xe1) { // segmento APP1 (donde vive EXIF)
        const inicioExif = offset + 4;
        if (buffer.toString('ascii', inicioExif, inicioExif + 4) === 'Exif') {
          const tiffOffset = inicioExif + 6;
          const esLittleEndian = buffer.toString('ascii', tiffOffset, tiffOffset + 2) === 'II';
          const leerUInt16 = esLittleEndian ? buffer.readUInt16LE.bind(buffer) : buffer.readUInt16BE.bind(buffer);
          const leerUInt32 = esLittleEndian ? buffer.readUInt32LE.bind(buffer) : buffer.readUInt32BE.bind(buffer);
          const offsetIFD0 = tiffOffset + leerUInt32(tiffOffset + 4);
          const cantidadEntradas = leerUInt16(offsetIFD0);
          for (let i = 0; i < cantidadEntradas; i++) {
            const entradaOffset = offsetIFD0 + 2 + i * 12;
            const tag = leerUInt16(entradaOffset);
            if (tag === 0x0112) { // tag "Orientation"
              const valor = leerUInt16(entradaOffset + 8);
              if (valor === 3) return 180;
              if (valor === 6) return 90;
              if (valor === 8) return 270;
              return 0;
            }
          }
        }
        return 0;
      }
      offset += 2 + largoSegmento;
    }
  } catch {
    // Si el EXIF viene mal formado simplemente no rotamos — mejor una foto
    // torcida que romper la subida.
  }
  return 0;
}

module.exports = { leerRotacionExif };
