// Шина событий: любой модуль говорит «случилось X», а подписчики (Telegram)
// решают, что с этим делать. Ошибки подписчиков никогда не пробрасываются
// наружу — уведомление не должно ломать основной запрос.

const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(50);

function emitir(tipo, datos = {}) {
  try {
    setImmediate(() => {
      try { bus.emit('evento', tipo, datos); } catch (err) { console.error('Error en suscriptor de eventos:', err.message); }
    });
  } catch (err) {
    console.error('No se pudo emitir el evento', tipo, err.message);
  }
}

function suscribir(fn) {
  bus.on('evento', fn);
}

module.exports = { emitir, suscribir };
