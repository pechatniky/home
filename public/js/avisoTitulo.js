// Aviso en la pestaña del navegador: mientras haya notificaciones sin
// atender, el título PARPADEA entre "(2) Título" y "🔔 ¡Nuevo pedido!", y el
// icono de la pestaña muestra un globito rojo con el número. Así se nota
// aunque la pestaña esté en segundo plano.
//
// Uso: AvisoTitulo.establecer(cantidad, mensaje)   (cantidad 0 = apagar)

window.AvisoTitulo = (function () {
  'use strict';

  const INTERVALO = 1000;
  let base = null;          // título original de la página
  let timer = null;
  let cantidad = 0;
  let mensaje = '';
  let fase = false;
  let iconoOriginal = null; // { href, type }
  const cacheBadge = {};

  function enlaceIcono() {
    return document.querySelector('link[rel~="icon"]');
  }

  function dibujarBadge(n) {
    const link = enlaceIcono();
    if (!link) return;
    if (!iconoOriginal) iconoOriginal = { href: link.href, type: link.type || '' };
    const clave = `${iconoOriginal.href}|${n}`;
    if (cacheBadge[clave]) { aplicarIcono(link, cacheBadge[clave], 'image/png'); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0, 64, 64);
        g.fillStyle = '#E5252A';
        g.beginPath(); g.arc(46, 18, 18, 0, Math.PI * 2); g.fill();
        g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
        g.fillStyle = '#fff';
        g.font = 'bold 24px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(n > 9 ? '9+' : String(n), 46, 19);
        cacheBadge[clave] = c.toDataURL('image/png');
        if (cantidad === n) aplicarIcono(link, cacheBadge[clave], 'image/png');
      } catch (_) { /* canvas no disponible: sin globito */ }
    };
    img.src = iconoOriginal.href;
  }

  function aplicarIcono(link, href, type) {
    link.type = type;
    link.href = href;
  }

  function restaurarIcono() {
    const link = enlaceIcono();
    if (link && iconoOriginal) {
      link.type = iconoOriginal.type;
      link.href = iconoOriginal.href;
    }
  }

  function pintar() {
    if (cantidad <= 0) return;
    fase = !fase;
    document.title = fase ? `🔔 ${mensaje}` : `(${cantidad}) ${base}`;
  }

  function establecer(n, texto) {
    if (base === null) base = document.title;
    n = Math.max(0, Number(n) || 0);
    const cambio = n !== cantidad;
    cantidad = n;
    mensaje = texto || (n === 1 ? '¡Tienes un aviso!' : `${n} avisos nuevos`);
    if (n === 0) {
      clearInterval(timer);
      timer = null;
      fase = false;
      document.title = base;
      restaurarIcono();
      return;
    }
    if (!timer) {
      fase = false;
      pintar();
      timer = setInterval(pintar, INTERVALO);
    }
    if (cambio) dibujarBadge(n);
  }

  return { establecer };
})();
