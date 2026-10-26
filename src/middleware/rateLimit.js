// Лимитер запросов в памяти (без зависимостей). Защищает от случайных
// «залипших» клиентов и перебора пароля. Ключ по умолчанию — IP.

function crearLimitador({ ventanaMs, max, mensaje, clave }) {
  const hits = new Map(); // clave -> { n, reinicio }

  const limpiador = setInterval(() => {
    const ahora = Date.now();
    for (const [k, v] of hits) if (v.reinicio <= ahora) hits.delete(k);
  }, 60 * 1000);
  limpiador.unref();

  return function limitador(req, res, next) {
    const k = (clave ? clave(req) : req.ip) || 'anon';
    const ahora = Date.now();
    let reg = hits.get(k);
    if (!reg || reg.reinicio <= ahora) {
      reg = { n: 0, reinicio: ahora + ventanaMs };
      hits.set(k, reg);
    }
    reg.n += 1;
    if (reg.n > max) {
      const segundos = Math.max(1, Math.ceil((reg.reinicio - ahora) / 1000));
      res.set('Retry-After', String(segundos));
      const espera = segundos >= 90 ? `${Math.ceil(segundos / 60)} min` : `${segundos} s`;
      return res.status(429).json({ error: `${mensaje || 'Demasiadas solicitudes.'} Espera ${espera} e intenta de nuevo.` });
    }
    next();
  };
}

module.exports = { crearLimitador };
