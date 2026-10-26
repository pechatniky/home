// Modulo compartido para las paginas de administracion: sondea /api/orders
// cada 15s para:
//   1. Actualizar la insignia de "Pedidos nuevos" en el boton de la barra
//      superior (si la pagina tiene un elemento #pedidosBadge) y el titulo
//      de la pestaña "(2) Pedidos".
//   2. Mostrar una ALERTA PERSISTENTE (ver alertas.js — no se cierra sola)
//      cuando aparece un pedido nuevo, o cuando cambia el estado de uno que
//      ya conociamos (por ejemplo, si el cliente cancela el suyo).
//   3. Sonar un aviso cuando llega un pedido nuevo (se puede apagar en
//      Ajustes → Panel). El navegador solo permite sonido después de que el
//      usuario toque la pantalla una vez en la página.
//
// La primera consulta solo "memoriza" el estado de todo lo que ya existia,
// sin avisar de nada — las alertas son solo para lo que cambia DESPUES de
// cargar la pagina.
//
// pedidos.js puede pasar un callback `onPedidos` para reusar el mismo
// sondeo y refrescar su lista. También debe llamar a
// `MonitorPedidos.marcarVisto(id, estadoNuevo)` justo despues de cambiar el
// estado de un pedido ella misma, para no generarse una alerta a si misma.

window.MonitorPedidos = (function () {
  'use strict';

  const INTERVALO = 15000; // 15s

  const ETIQUETAS_ESTADO = {
    nuevo: 'Nuevo',
    en_preparacion: 'En preparación',
    enviado: 'Enviado',
    completado: 'Completado',
    cancelado: 'Cancelado',
  };

  let estadosConocidos = null; // null = todavía no hicimos el primer sondeo
  let iniciado = false;
  let onPedidosCb = null;
  let sonidoActivo = true;
  let audioCtx = null;
  const tituloOriginal = document.title;

  // ---- Sonido (Web Audio, sin archivos) ----
  function prepararAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* sin audio */ }
  }
  ['click', 'touchstart', 'keydown'].forEach((ev) => document.addEventListener(ev, prepararAudio, { once: false, passive: true }));

  function sonar() {
    if (!sonidoActivo || !audioCtx || audioCtx.state !== 'running') return;
    try {
      const t0 = audioCtx.currentTime;
      [[880, 0], [1175, 0.18], [880, 0.36]].forEach(([freq, delay]) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.16);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + delay);
        osc.stop(t0 + delay + 0.18);
      });
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (_) { /* ignorar */ }
  }

  async function apiFetch(url) {
    const res = await fetch(url);
    if (res.status === 401) {
      window.location.href = '/?acceso=1';
      throw new Error('Sesión expirada.');
    }
    if (!res.ok) throw new Error('No se pudieron consultar los pedidos.');
    return res.json();
  }

  function actualizarBadge(pedidos) {
    const nuevos = pedidos.filter((p) => p.estado === 'nuevo').length;
    const badge = document.getElementById('pedidosBadge');
    if (badge) {
      badge.textContent = nuevos > 9 ? '9+' : String(nuevos);
      badge.hidden = nuevos === 0;
    }
    if (window.AvisoTitulo) {
      window.AvisoTitulo.establecer(nuevos, nuevos === 1 ? '¡Nuevo pedido!' : `${nuevos} pedidos nuevos`);
    } else {
      document.title = nuevos > 0 ? `(${nuevos}) ${tituloOriginal}` : tituloOriginal;
    }
  }

  function alertar(mensaje, tipo) {
    if (window.Alertas) window.Alertas.mostrar(mensaje, tipo);
  }

  const num = (p) => (p.numero ? `#${p.numero} ` : '');

  async function revisar() {
    let pedidos;
    try {
      pedidos = await apiFetch('/api/orders');
      if (window.ComunAdmin) window.ComunAdmin.reportarRed(true);
    } catch (_) {
      if (window.ComunAdmin) window.ComunAdmin.reportarRed(false);
      return; // sondeo silencioso: si falla, no interrumpimos la página
    }

    actualizarBadge(pedidos);
    if (onPedidosCb) onPedidosCb(pedidos);

    if (estadosConocidos === null) {
      // Primera carga: memorizamos sin avisar de pedidos que ya existían.
      estadosConocidos = new Map(pedidos.map((p) => [p.id, p.estado]));
      return;
    }

    let hayNuevo = false;
    pedidos.forEach((p) => {
      const anterior = estadosConocidos.get(p.id);
      if (anterior === undefined) {
        hayNuevo = true;
        alertar(`¡Nuevo pedido ${num(p)}de ${p.cliente.nombre}! Total: ${p.totalConEnvioCup ?? p.totalCup} CUP.${p.fueraDeHorario ? ' (fuera de horario)' : ''}`, 'nuevo');
      } else if (anterior !== p.estado) {
        const etiqueta = ETIQUETAS_ESTADO[p.estado] || p.estado;
        alertar(`El pedido ${num(p)}de ${p.cliente.nombre} ahora está: ${etiqueta}.`, p.estado === 'cancelado' ? 'cancelado' : 'cambio');
        if (p.estado === 'cancelado') sonar();
      }
      estadosConocidos.set(p.id, p.estado);
    });
    if (hayNuevo) sonar();
  }

  // Para que una acción hecha en esta misma página (botón de estado,
  // cancelar) no se dispare a sí misma como alerta en el próximo sondeo.
  function marcarVisto(id, estado) {
    if (estadosConocidos) estadosConocidos.set(id, estado);
  }

  async function cargarPreferenciaSonido() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const a = await res.json();
        sonidoActivo = a.admin ? a.admin.sonidoPedidoNuevo !== false : true;
      }
    } catch (_) { /* por defecto: con sonido */ }
  }

  function iniciar(opciones) {
    if (iniciado) return; // por si algo llama iniciar() dos veces
    iniciado = true;
    onPedidosCb = (opciones && opciones.onPedidos) || null;
    cargarPreferenciaSonido();
    revisar();
    setInterval(() => { if (!document.hidden) revisar(); }, INTERVALO);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }

  function setSonido(valor) { sonidoActivo = Boolean(valor); }

  return { iniciar, marcarVisto, setSonido };
})();
