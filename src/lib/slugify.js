// Транслитерация текста в id-совместимую строку (для id категорий).

function slugify(texto) {
  const mapaAcentos = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u' };
  return String(texto)
    .toLowerCase()
    .trim()
    .replace(/[áéíóúñü]/g, (c) => mapaAcentos[c] || c)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { slugify };
