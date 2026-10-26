// Конфигурация приложения: пути к файлам, константы. Собрано в одном месте,
// чтобы остальные модули не собирали пути к data/ и public/ вручную.

const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const VIEWS_DIR = path.join(ROOT_DIR, 'views');

module.exports = {
  PORT: process.env.PORT || 80,

  // Секрет сессии: из переменной окружения, иначе генерируется один раз и
  // сохраняется в data/secret.txt (см. server.js) — так он уникален для
  // каждой установки и не меняется между перезапусками.
  SESSION_SECRET: process.env.SESSION_SECRET || null,

  ROOT_DIR,
  DATA_DIR,
  PUBLIC_DIR,
  VIEWS_DIR,

  PRODUCTS_FILE: path.join(DATA_DIR, 'products.json'),
  CATEGORIES_FILE: path.join(DATA_DIR, 'categories.json'),
  SETTINGS_FILE: path.join(DATA_DIR, 'settings.json'),
  USERS_FILE: path.join(DATA_DIR, 'users.json'),
  ORDERS_FILE: path.join(DATA_DIR, 'orders.json'),
  CLIENTES_FILE: path.join(DATA_DIR, 'clientes.json'),
  SESSIONS_FILE: path.join(DATA_DIR, 'sessions.json'),
  SECRET_FILE: path.join(DATA_DIR, 'secret.txt'),
  BACKUPS_DIR: path.join(ROOT_DIR, 'backups'),
  UPLOADS_ROOT: path.join(PUBLIC_DIR, 'uploads'),

  // Temas de color disponibles (id guardado → el atributo data-theme se arma
  // en el navegador, ver public/js/temas.js; 'auto' sigue al sistema).
  TEMAS: ['auto', 'oscuro', 'claro', 'oceano', 'bosque', 'atardecer', 'lavanda', 'menta', 'cafe'],

  // Папка для загруженных изображений блюд (отдаётся статически из /public)
  UPLOADS_DIR: path.join(PUBLIC_DIR, 'uploads', 'productos'),

  // Parámetros de compresión de imágenes (ver src/lib/imagenes.js)
  IMAGEN_LADO_MAXIMO: 800, // px, se ajusta manteniendo la proporción
  IMAGEN_CALIDAD_JPEG: 60, // agresivo a propósito: clientes con internet lento
  TIPOS_IMAGEN_PERMITIDOS: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],

  // Estados posibles de un pedido. "nuevo" es el único que se asigna solo
  // (al crear el pedido). Los tres siguientes los fija el administrador con
  // los botones de la página de Pedidos, en orden. "cancelado" es aparte y
  // tiene dos caminos: el cliente lo puede poner solo mientras el pedido
  // sigue en "nuevo" (ver ESTADO_CANCELABLE_DESDE — una vez que el admin
  // empieza a prepararlo, ya no se puede cancelar desde la tienda); el
  // administrador, en cambio, puede cancelar un pedido en cualquier estado
  // (POST /api/orders/:id/cancelar), incluso ya en camino o completado.
  ESTADOS_PEDIDO: ['nuevo', 'en_preparacion', 'enviado', 'completado', 'cancelado'],
  ESTADOS_PEDIDO_EDITABLES: ['en_preparacion', 'enviado', 'completado'],
  ESTADO_CANCELABLE_DESDE: 'nuevo',

  // El negocio solo entrega en La Habana, Cuba — el selector de ubicación en
  // el mapa (tienda.js) restringe el arrastre/zoom a este rectángulo, y el
  // servidor vuelve a chequear las mismas coordenadas al recibir el pedido
  // (nunca confía en lo que mande el navegador sin revisar).
  HABANA_BOUNDS: { latMin: 22.93, latMax: 23.20, lngMin: -82.55, lngMax: -82.20 },

  // Los 15 municipios de La Habana — el negocio reparte solo dentro de la
  // ciudad, así que el selector de "provincia" en realidad nunca tuvo sentido
  // (todos los pedidos son dentro de La Habana); lo que el cliente elige es
  // el municipio, que es lo que de verdad determina la zona y el costo de
  // envío. El admin define un costo de envío en CUP para cada uno desde
  // Ajustes → Envío por municipio.
  MUNICIPIOS_HABANA: [
    { id: 'playa', nombre: 'Playa' },
    { id: 'plaza_de_la_revolucion', nombre: 'Plaza de la Revolución' },
    { id: 'centro_habana', nombre: 'Centro Habana' },
    { id: 'la_habana_vieja', nombre: 'La Habana Vieja' },
    { id: 'regla', nombre: 'Regla' },
    { id: 'la_habana_del_este', nombre: 'La Habana del Este' },
    { id: 'guanabacoa', nombre: 'Guanabacoa' },
    { id: 'san_miguel_del_padron', nombre: 'San Miguel del Padrón' },
    { id: 'diez_de_octubre', nombre: 'Diez de Octubre' },
    { id: 'cerro', nombre: 'Cerro' },
    { id: 'marianao', nombre: 'Marianao' },
    { id: 'la_lisa', nombre: 'La Lisa' },
    { id: 'boyeros', nombre: 'Boyeros' },
    { id: 'arroyo_naranjo', nombre: 'Arroyo Naranjo' },
    { id: 'cotorro', nombre: 'Cotorro' },
  ],
};
