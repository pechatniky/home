// Generador de cartel con código QR de la tienda. Todo se dibuja en un
// <canvas> (sin servidor, sin librerías de imágenes): el admin elige diseño,
// textos y formato, y descarga un PNG listo para imprimir o compartir.

(() => {
  'use strict';

  const W = 1080;
  const cv = document.getElementById('qrCanvas');
  const ctx = cv.getContext('2d');
  const el = {
    disenos: document.getElementById('qrDisenos'),
    url: document.getElementById('qrUrl'),
    titulo: document.getElementById('qrTitulo'),
    frase: document.getElementById('qrFrase'),
    formato: document.getElementById('qrFormato'),
    logo: document.getElementById('qrLogo'),
    contacto: document.getElementById('qrContacto'),
    mostrarUrl: document.getElementById('qrMostrarUrl'),
    descargar: document.getElementById('qrDescargar'),
    compartir: document.getElementById('qrCompartir'),
    copiar: document.getElementById('qrCopiar'),
    toast: document.getElementById('toast'),
  };

  const FUENTE = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
  const CLAVE = 'pechatniky_qr';

  // ---------- Diseños ----------
  // fondo(g, w, h): dibuja el fondo. tarjeta: color del panel del QR.
  // qr: color de los módulos. texto/acento: colores de los textos.
  function circulos(g, w, h, colores, n, semilla) {
    let s = semilla;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < n; i++) {
      g.globalAlpha = 0.08 + rnd() * 0.16;
      g.fillStyle = colores[Math.floor(rnd() * colores.length)];
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 30 + rnd() * 170, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }
  function degradado(g, w, h, c1, c2, angulo) {
    const a = angulo === undefined ? 0.9 : angulo;
    const gr = g.createLinearGradient(0, 0, w * a, h);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  function puntos(g, w, h, color) {
    g.fillStyle = color;
    for (let y = 30; y < h; y += 54) for (let x = ((y / 54) % 2) * 27 + 30; x < w; x += 54) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  }
  function rayas(g, w, h, color) {
    g.save();
    g.strokeStyle = color; g.lineWidth = 26;
    for (let x = -h; x < w + h; x += 90) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
    g.restore();
  }

  const DISENOS = [
    { id: 'neon', nombre: 'Neón', muestra: ['#2A1250', '#F2318C'], tarjeta: '#FFFFFF', qr: '#2A1250', texto: '#FFFFFF', acento: '#FFD0E8',
      fondo: (g, w, h) => { degradado(g, w, h, '#1B1033', '#8E1B6B'); circulos(g, w, h, ['#F2318C', '#7C4DDB', '#FFB347'], 14, 11); } },
    { id: 'atardecer', nombre: 'Atardecer', muestra: ['#FF8A3D', '#E8336D'], tarjeta: '#FFFFFF', qr: '#B3224F', texto: '#FFFFFF', acento: '#FFE7D1',
      fondo: (g, w, h) => { degradado(g, w, h, '#FF9A3D', '#D6286B'); circulos(g, w, h, ['#FFFFFF', '#FFD166'], 12, 7); } },
    { id: 'oceano', nombre: 'Océano', muestra: ['#0A3D62', '#1ABC9C'], tarjeta: '#FFFFFF', qr: '#0A3D62', texto: '#FFFFFF', acento: '#CFF5EE',
      fondo: (g, w, h) => { degradado(g, w, h, '#0A3D62', '#16A596'); circulos(g, w, h, ['#FFFFFF', '#7FE0D2'], 13, 23); } },
    { id: 'bosque', nombre: 'Bosque', muestra: ['#14532D', '#84CC16'], tarjeta: '#FFFFFF', qr: '#14532D', texto: '#FFFFFF', acento: '#E1F7C0',
      fondo: (g, w, h) => { degradado(g, w, h, '#0F3D22', '#3E8E2C'); circulos(g, w, h, ['#BEF264', '#FFFFFF'], 13, 5); } },
    { id: 'cafe', nombre: 'Café', muestra: ['#F6EFE6', '#B8642A'], tarjeta: '#FFFFFF', qr: '#4A2A14', texto: '#4A2A14', acento: '#B8642A',
      fondo: (g, w, h) => { g.fillStyle = '#F6EFE6'; g.fillRect(0, 0, w, h); puntos(g, w, h, 'rgba(184,100,42,0.18)'); } },
    { id: 'minimal', nombre: 'Minimal', muestra: ['#FFFFFF', '#111111'], tarjeta: '#FFFFFF', qr: '#111111', texto: '#111111', acento: '#6B6B6B', borde: '#E3E3E3',
      fondo: (g, w, h) => { g.fillStyle = '#F4F4F6'; g.fillRect(0, 0, w, h); } },
    { id: 'oro', nombre: 'Elegante', muestra: ['#0E0E10', '#D4AF37'], tarjeta: '#FFFFFF', qr: '#0E0E10', texto: '#F5E7B0', acento: '#D4AF37', marco: '#D4AF37',
      fondo: (g, w, h) => { degradado(g, w, h, '#0E0E10', '#26211A'); } },
    { id: 'rayas', nombre: 'Rayas', muestra: ['#7C4DDB', '#FFC107'], tarjeta: '#FFFFFF', qr: '#4527A0', texto: '#FFFFFF', acento: '#FFE082',
      fondo: (g, w, h) => { g.fillStyle = '#6A3FCB'; g.fillRect(0, 0, w, h); rayas(g, w, h, 'rgba(255,255,255,0.07)'); } },
  ];

  const estado = {
    diseno: 'neon', formato: 1350, logo: true, contacto: true, mostrarUrl: true,
    titulo: '', frase: '¡Pide tu comida aquí!', url: location.origin + '/',
    tienda: { nombre: '', emoji: '🍲', icono: '' }, contactos: {},
  };
  let imagenLogo = null;

  // ---------- Dibujo ----------
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function ajustarTexto(g, texto, maxAncho, tamano, peso) {
    let t = tamano;
    g.font = `${peso} ${t}px ${FUENTE}`;
    while (g.measureText(texto).width > maxAncho && t > 22) { t -= 2; g.font = `${peso} ${t}px ${FUENTE}`; }
    return t;
  }

  function dibujarQR(g, datos, x, y, lado, color, conLogo) {
    const qr = window.qrcode(0, 'H');
    qr.addData(datos);
    qr.make();
    const n = qr.getModuleCount();
    const m = lado / n;
    g.fillStyle = color;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        // Módulos ligeramente redondeados; los 3 "ojos" se quedan cuadrados para leer bien
        const px = x + c * m, py = y + r * m;
        const ojo = (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
        if (ojo) g.fillRect(px - 0.4, py - 0.4, m + 0.8, m + 0.8);
        else { rr(g, px + m * 0.06, py + m * 0.06, m * 0.88, m * 0.88, m * 0.28); g.fill(); }
      }
    }
    if (conLogo) {
      const l = lado * 0.2;
      const cx = x + lado / 2, cy = y + lado / 2;
      g.fillStyle = '#FFFFFF';
      rr(g, cx - l / 2 - 10, cy - l / 2 - 10, l + 20, l + 20, 24); g.fill();
      if (imagenLogo) {
        g.save(); rr(g, cx - l / 2, cy - l / 2, l, l, 18); g.clip();
        g.drawImage(imagenLogo, cx - l / 2, cy - l / 2, l, l); g.restore();
      } else {
        g.font = `${l * 0.82}px ${FUENTE}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = '#000'; g.fillText(estado.tienda.emoji || '🍲', cx, cy + l * 0.04);
      }
    }
  }

  function dibujar() {
    const H = estado.formato;
    cv.width = W; cv.height = H;
    const d = DISENOS.find((x) => x.id === estado.diseno) || DISENOS[0];
    const g = ctx;
    g.clearRect(0, 0, W, H);
    d.fondo(g, W, H);
    if (d.marco) { g.strokeStyle = d.marco; g.lineWidth = 6; rr(g, 36, 36, W - 72, H - 72, 28); g.stroke(); }

    const compacto = H <= 1080;
    const qrLado = compacto ? 420 : 600;
    const pad = 44;
    const tarjetaLado = qrLado + pad * 2;
    const titulo = estado.titulo || estado.tienda.nombre || 'Mi tienda';
    const frase = estado.frase;
    const tel = estado.contacto ? (estado.contactos.whatsapp || estado.contactos.telefono || '') : '';
    const urlTxt = estado.mostrarUrl ? estado.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';

    // Altura total del bloque para centrarlo verticalmente
    const hCab = compacto ? 172 : 210;      // emoji/logo + título
    const hFrase = frase ? (compacto ? 70 : 118) : 30;
    const hPie = (tel ? 70 : 0) + (urlTxt ? 64 : 0) + 56; // "escanea" + contacto + url
    const gap = compacto ? 26 : 40;
    const total = hCab + hFrase + tarjetaLado + hPie + gap * 2;
    let y = Math.max(60, (H - total) / 2);

    g.textAlign = 'center'; g.textBaseline = 'alphabetic';

    // Cabecera: logo circular o emoji
    const r = compacto ? 46 : 62;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.arc(W / 2, y + r, r, 0, Math.PI * 2); g.fill();
    if (imagenLogo) {
      g.save(); g.beginPath(); g.arc(W / 2, y + r, r - 6, 0, Math.PI * 2); g.clip();
      g.drawImage(imagenLogo, W / 2 - r + 6, y + 6, (r - 6) * 2, (r - 6) * 2); g.restore();
    } else {
      g.font = `${r * 1.1}px ${FUENTE}`; g.textBaseline = 'middle'; g.fillStyle = '#000';
      g.fillText(estado.tienda.emoji || '🍲', W / 2, y + r + r * 0.06);
    }
    g.textBaseline = 'alphabetic';
    const ty = y + r * 2 + (compacto ? 60 : 84);
    const tam = ajustarTexto(g, titulo, W - 140, compacto ? 68 : 84, 800);
    g.fillStyle = d.texto; g.fillText(titulo, W / 2, ty);
    y += hCab;

    // Frase
    if (frase) {
      const tf = ajustarTexto(g, frase, W - 160, compacto ? 40 : 48, 600);
      g.font = `600 ${tf}px ${FUENTE}`; g.fillStyle = d.acento; g.fillText(frase, W / 2, y + (compacto ? 38 : 62));
    }
    y += hFrase + gap * 0.4;

    // Tarjeta con el QR
    const tx = (W - tarjetaLado) / 2;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.30)'; g.shadowBlur = 40; g.shadowOffsetY = 14;
    g.fillStyle = d.tarjeta; rr(g, tx, y, tarjetaLado, tarjetaLado, 44); g.fill();
    g.restore();
    if (d.borde) { g.strokeStyle = d.borde; g.lineWidth = 3; rr(g, tx, y, tarjetaLado, tarjetaLado, 44); g.stroke(); }
    dibujarQR(g, estado.url, tx + pad, y + pad, qrLado, d.qr, estado.logo);
    y += tarjetaLado + gap + 18;

    // Pie
    g.fillStyle = d.texto;
    g.font = `700 ${compacto ? 34 : 40}px ${FUENTE}`;
    g.fillText('Escanea con la cámara de tu móvil', W / 2, y + 12);
    y += 56;
    if (tel) { g.font = `600 ${compacto ? 32 : 38}px ${FUENTE}`; g.fillStyle = d.acento; g.fillText(`📞 ${tel}`, W / 2, y + 12); y += 70; }
    if (urlTxt) {
      const tu = ajustarTexto(g, urlTxt, W - 160, compacto ? 30 : 34, 500);
      g.font = `500 ${tu}px ${FUENTE}`; g.fillStyle = d.acento; g.globalAlpha = 0.9; g.fillText(urlTxt, W / 2, y + 12); g.globalAlpha = 1;
    }
  }

  // ---------- Interfaz ----------
  function mostrarToast(t) {
    el.toast.textContent = t;
    el.toast.classList.add('is-visible');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
  }

  function renderDisenos() {
    el.disenos.innerHTML = '';
    DISENOS.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `qr-diseno${d.id === estado.diseno ? ' is-activo' : ''}`;
      b.setAttribute('aria-label', `Diseño ${d.nombre}`);
      const m = document.createElement('span');
      m.className = 'qr-diseno__muestra';
      m.style.background = `linear-gradient(135deg, ${d.muestra[0]}, ${d.muestra[1]})`;
      const n = document.createElement('span');
      n.textContent = d.nombre;
      b.append(m, n);
      b.addEventListener('click', () => { estado.diseno = d.id; guardar(); renderDisenos(); dibujar(); });
      el.disenos.appendChild(b);
    });
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify({ diseno: estado.diseno, formato: estado.formato, logo: estado.logo, contacto: estado.contacto, mostrarUrl: estado.mostrarUrl, titulo: estado.titulo, frase: estado.frase }));
    } catch (_) { /* modo privado */ }
  }

  function leerGuardado() {
    try {
      const g = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (g && typeof g === 'object') Object.assign(estado, g);
    } catch (_) { /* ignorar */ }
  }

  function enlazarCampos() {
    el.url.value = estado.url;
    el.titulo.value = estado.titulo || estado.tienda.nombre;
    el.frase.value = estado.frase;
    el.formato.value = String(estado.formato);
    el.logo.checked = estado.logo;
    el.contacto.checked = estado.contacto;
    el.mostrarUrl.checked = estado.mostrarUrl;
    const cambio = () => {
      estado.url = el.url.value.trim() || location.origin + '/';
      estado.titulo = el.titulo.value.trim();
      estado.frase = el.frase.value.trim();
      estado.formato = Number(el.formato.value);
      estado.logo = el.logo.checked;
      estado.contacto = el.contacto.checked;
      estado.mostrarUrl = el.mostrarUrl.checked;
      guardar();
      dibujar();
    };
    [el.url, el.titulo, el.frase].forEach((i) => i.addEventListener('input', cambio));
    [el.formato, el.logo, el.contacto, el.mostrarUrl].forEach((i) => i.addEventListener('change', cambio));
  }

  function nombreArchivo() {
    const base = (estado.tienda.nombre || 'tienda').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `qr-${base || 'tienda'}.png`;
  }

  function aBlob() {
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }

  el.descargar.addEventListener('click', async () => {
    const blob = await aBlob();
    if (!blob) return mostrarToast('No se pudo generar la imagen.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombreArchivo();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    mostrarToast('Imagen descargada ✓');
  });

  el.copiar.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(estado.url); mostrarToast('Enlace copiado ✓'); }
    catch (_) { el.url.select(); mostrarToast('Copia el enlace manualmente.'); }
  });

  if (navigator.canShare && navigator.share) {
    el.compartir.hidden = false;
    el.compartir.addEventListener('click', async () => {
      const blob = await aBlob();
      const file = new File([blob], nombreArchivo(), { type: 'image/png' });
      try {
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: estado.tienda.nombre, text: estado.url });
        else await navigator.share({ title: estado.tienda.nombre, url: estado.url });
      } catch (_) { /* el usuario canceló */ }
    });
  }

  function cargarImagen(src) {
    return new Promise((res) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = src;
    });
  }

  async function iniciar() {
    leerGuardado();
    try {
      const [aj, yo] = await Promise.all([window.ComunAdmin.apiFetch('/api/settings'), window.ComunAdmin.apiFetch('/api/me')]);
      estado.tienda = aj.tienda;
      estado.contactos = aj.contactos;
      if (window.Temas) window.Temas.aplicar(yo.tema || 'auto');
      if (aj.tienda.icono) imagenLogo = await cargarImagen(`/icons/icon-512.png?${encodeURIComponent(aj.tienda.icono)}`);
    } catch (err) { mostrarToast(err.message); }
    renderDisenos();
    enlazarCampos();
    dibujar();
  }

  iniciar();
  window.MonitorPedidos.iniciar();
})();
