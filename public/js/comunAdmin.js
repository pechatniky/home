// Utilidades compartidas por todas las páginas del panel:
//  - banner de "sin conexión" cuando el servidor no responde
//  - registro del service worker (permite instalar el panel como app)
//  - ComunAdmin.apiFetch(): fetch con redirección al login y errores claros

window.ComunAdmin = (function () {
  'use strict';

  let banner = null;
  let fallos = 0;

  function mostrarBanner(texto) {
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:90;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:#D6293D;color:#fff;font:600 14px/1.3 system-ui,sans-serif;text-align:center';
      document.body.appendChild(banner);
    }
    banner.textContent = texto;
    banner.hidden = false;
  }

  function ocultarBanner() {
    if (banner) banner.hidden = true;
  }

  // Los módulos llaman a esto con el resultado de cada consulta periódica.
  function reportarRed(ok) {
    if (ok) {
      fallos = 0;
      ocultarBanner();
    } else {
      fallos += 1;
      if (fallos >= 2) mostrarBanner('Sin conexión con el servidor. Reintentando…');
    }
  }

  async function apiFetch(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (_) {
      throw new Error('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
    }
    if (res.status === 401) {
      window.location.href = '/?acceso=1';
      throw new Error('Sesión expirada.');
    }
    if (!res.ok) {
      let mensaje = 'Ocurrió un error inesperado.';
      try {
        const data = await res.json();
        if (data.error) mensaje = data.error;
      } catch (_) { /* sin cuerpo JSON */ }
      throw new Error(mensaje);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  window.addEventListener('offline', () => mostrarBanner('Sin conexión a internet.'));
  window.addEventListener('online', () => { reportarRed(true); });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  return { apiFetch, reportarRed };
})();
