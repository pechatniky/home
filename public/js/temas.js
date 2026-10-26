// Temas de color. Se carga en el <head> (bloqueante y diminuto) para aplicar
// el tema ANTES de pintar y no hacer "parpadeo". Lo recuerda en localStorage;
// la cuenta del cliente / el admin lo guardan además en el servidor.
//
// Ids: auto (sigue al sistema), oscuro, claro, oceano, bosque, atardecer,
// lavanda, menta, cafe. El atributo data-theme usa nombres en inglés
// (ver styles.css).

(function () {
  'use strict';

  var LISTA = [
    { id: 'auto', nombre: 'Automático', attr: null, colores: ['#121018', '#F5F2FA', '#F2318C'] },
    { id: 'oscuro', nombre: 'Oscuro', attr: 'dark', colores: ['#121018', '#1D1927', '#F2318C'] },
    { id: 'claro', nombre: 'Claro', attr: 'light', colores: ['#F5F2FA', '#FFFFFF', '#F2318C'] },
    { id: 'oceano', nombre: 'Océano', attr: 'ocean', colores: ['#0A1622', '#11243A', '#1A93D8'] },
    { id: 'bosque', nombre: 'Bosque', attr: 'forest', colores: ['#0C1712', '#14261D', '#27A058'] },
    { id: 'atardecer', nombre: 'Atardecer', attr: 'sunset', colores: ['#1A0F12', '#281A1E', '#F2682F'] },
    { id: 'lavanda', nombre: 'Lavanda', attr: 'lavender', colores: ['#EFE9FB', '#FFFFFF', '#7C4DDB'] },
    { id: 'menta', nombre: 'Menta', attr: 'mint', colores: ['#E8F6F0', '#FFFFFF', '#14966A'] },
    { id: 'cafe', nombre: 'Café', attr: 'coffee', colores: ['#F6EFE6', '#FFFBF5', '#B8642A'] },
  ];
  var BARRA = { dark: '#171320', light: '#171320', ocean: '#0C1D30', forest: '#0F1F17', sunset: '#20141A', lavender: '#2A1F4A', mint: '#12372E', coffee: '#3A281C' };
  var CLAVE = 'pechatniky_tema';

  function porId(id) {
    for (var i = 0; i < LISTA.length; i++) if (LISTA[i].id === id) return LISTA[i];
    return null;
  }

  function leerLocal() {
    try { return localStorage.getItem(CLAVE); } catch (_) { return null; }
  }

  function guardarLocal(id) {
    try { localStorage.setItem(CLAVE, id); } catch (_) { /* modo privado */ }
  }

  function sistemaOscuro() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  var actual = 'auto';

  function aplicar(id, opciones) {
    var tema = porId(id) || porId('auto');
    actual = tema.id;
    var attr = tema.attr || (sistemaOscuro() ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', attr);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BARRA[attr] || '#171320');
    if (!opciones || opciones.recordar !== false) guardarLocal(tema.id);
  }

  function defectoDeLaPagina() {
    var m = document.querySelector('meta[name="tema-defecto"]');
    return m ? m.getAttribute('content') : 'auto';
  }

  // Si el sistema cambia de claro a oscuro y el tema es "auto", seguimos.
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var alCambiar = function () { if (actual === 'auto') aplicar('auto', { recordar: false }); };
    if (mq.addEventListener) mq.addEventListener('change', alCambiar);
    else if (mq.addListener) mq.addListener(alCambiar);
  }

  window.Temas = {
    lista: LISTA,
    aplicar: aplicar,
    actual: function () { return actual; },
    leerLocal: leerLocal,
    defecto: defectoDeLaPagina,
  };

  // Aplicación inmediata: lo último elegido en este dispositivo, o el
  // tema por defecto de la tienda.
  aplicar(leerLocal() || defectoDeLaPagina() || 'auto', { recordar: false });
})();
