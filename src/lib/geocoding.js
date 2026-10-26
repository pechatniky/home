// Traduce coordenadas (lat, lng) a una dirección aproximada en texto, usando
// el servicio gratuito de geocodificación inversa de Nominatim (OpenStreetMap)
// — igual que las tiles del mapa, no requiere clave de API.
//
// Se llama UNA sola vez, al crear el pedido (ver src/routes/publico.js), y el
// resultado se guarda en el propio pedido — así el panel de administración
// no depende de este servicio para mostrar la dirección después, y no se
// hacen pedidos repetidos a Nominatim por cada vez que el admin abre la
// página de Pedidos (su política de uso pide justamente eso: no abusar).
//
// Si el servicio no responde, tarda demasiado, o la red no lo permite, esto
// nunca debe romper ni demorar demasiado la creación del pedido: se resuelve
// con null y el admin simplemente no ve la cajita de dirección aproximada
// (le queda igual el enlace al mapa con las coordenadas exactas).

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 4000;

async function direccionAproximada(lat, lng) {
  const controlador = new AbortController();
  const timeoutId = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      signal: controlador.signal,
      headers: {
        // Nominatim exige identificar la app en el User-Agent (su política
        // de uso prohíbe pedidos anónimos/genéricos).
        'User-Agent': 'PechatnikyCafeteria/1.0 (selector de ubicacion de pedidos)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;

    const datos = await res.json();
    return (datos && typeof datos.display_name === 'string') ? datos.display_name : null;
  } catch (_) {
    // Timeout, sin red, respuesta rara, etc. — no es crítico, ver comentario arriba.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { direccionAproximada };
