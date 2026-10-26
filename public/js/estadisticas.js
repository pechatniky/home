// Página de estadísticas del panel: KPIs y gráficos hechos con HTML/CSS/SVG
// (sin librerías). Datos: GET /api/stats?periodo=hoy|ayer|7d|30d|todo

(() => {
  'use strict';

  const cont = document.getElementById('stats');
  const rango = document.getElementById('rangoStats');
  const chips = document.getElementById('chipsPeriodo');
  const toast = document.getElementById('toast');
  let periodo = 'hoy';
  try { periodo = localStorage.getItem('pechatniky_stats_periodo') || '7d'; } catch (_) { periodo = '7d'; }
  let pedido = 0; // evita que una respuesta lenta pise a otra más nueva

  const fmt = (n) => Number(n || 0).toLocaleString('es', { maximumFractionDigits: 2 });
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ETQ = { nuevo: 'Nuevos', en_preparacion: 'En preparación', enviado: 'Enviados', completado: 'Completados', cancelado: 'Cancelados' };

  function nombreMunicipio(id) {
    if (id === 'otro') return 'Otro';
    return id.split('_').map((w, i) => (['de', 'del', 'la', 'las', 'el'].includes(w) && i > 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }

  function fechaCorta(f) {
    const [, m, d] = f.split('-');
    return `${d}/${m}`;
  }

  function kpi(valor, etiqueta, sub) {
    return `<div class="kpi"><div class="kpi__valor">${valor}</div><div class="kpi__etq">${esc(etiqueta)}</div>${sub ? `<div class="kpi__sub">${sub}</div>` : ''}</div>`;
  }

  // Barras horizontales: lista [{etq, valor, extra}]
  function barrasH(filas, unidad) {
    if (!filas.length) return '<p class="cat-vacio">Sin datos en este periodo.</p>';
    const max = Math.max(...filas.map((f) => f.valor), 1);
    return '<div class="barras-h">' + filas.map((f) => `
      <div class="barra-h">
        <div class="barra-h__top"><span class="barra-h__etq">${esc(f.etq)}</span><span class="barra-h__val">${fmt(f.valor)}${unidad ? ' ' + unidad : ''}${f.extra ? ` <small>${esc(f.extra)}</small>` : ''}</span></div>
        <div class="barra-h__pista"><div class="barra-h__relleno" style="width:${Math.max(2, (f.valor / max) * 100)}%"></div></div>
      </div>`).join('') + '</div>';
  }

  // Columnas verticales con SVG: [{etq, valor}]
  function columnas(datos, { etiquetaCada = 1, titulo }) {
    const max = Math.max(...datos.map((d) => d.valor), 1);
    const W = 320, H = 130, base = 112, alto = 100;
    const n = datos.length;
    const paso = W / n;
    const ancho = Math.max(2, Math.min(24, paso * 0.68));
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="${esc(titulo)}" preserveAspectRatio="none">`;
    svg += `<line x1="0" y1="${base}" x2="${W}" y2="${base}" class="grafico__eje"/>`;
    datos.forEach((d, i) => {
      const h = d.valor > 0 ? Math.max(2, (d.valor / max) * alto) : 0;
      const x = i * paso + (paso - ancho) / 2;
      svg += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${ancho.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="grafico__col"><title>${esc(d.etq)}: ${fmt(d.valor)}</title></rect>`;
      if (i % etiquetaCada === 0) svg += `<text x="${(x + ancho / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="grafico__txt">${esc(d.etq)}</text>`;
    });
    svg += '</svg>';
    return svg;
  }

  function seccion(titulo, html) {
    return `<section class="stat-card"><h2>${esc(titulo)}</h2>${html}</section>`;
  }

  function render(s) {
    rango.textContent = s.desde === s.hasta ? fechaCorta(s.hasta) : `${fechaCorta(s.desde)} – ${fechaCorta(s.hasta)}`;

    if (!s.pedidos && !s.cancelados) {
      cont.innerHTML = seccion('Sin pedidos', '<p class="cat-vacio">Todavía no hay pedidos en este periodo. Cuando lleguen, aquí verás ventas, platos más pedidos y horas fuertes.</p>');
      return;
    }

    let h = '<div class="kpis">';
    h += kpi(fmt(s.pedidos), 'Pedidos', s.cancelados ? `${s.cancelados} cancelados` : '');
    h += kpi(fmt(s.ingresos) + ' <small>CUP</small>', 'Ventas', `${fmt(s.ingresosPlatos)} platos + ${fmt(s.ingresosEnvio)} envío`);
    h += kpi(fmt(s.ticketPromedio) + ' <small>CUP</small>', 'Ticket promedio');
    h += kpi(fmt(s.clientesActivos), 'Clientes activos', `${s.clientesNuevos} nuevos · ${s.clientesRecurrentes} recurrentes`);
    h += '</div>';

    if (s.porDia.length > 1) {
      const cada = Math.ceil(s.porDia.length / 7);
      h += seccion('Ventas por día (CUP)', columnas(s.porDia.map((d) => ({ etq: fechaCorta(d.fecha), valor: d.ingresos })), { etiquetaCada: cada, titulo: 'Ventas por día' }));
      h += seccion('Pedidos por día', columnas(s.porDia.map((d) => ({ etq: fechaCorta(d.fecha), valor: d.pedidos })), { etiquetaCada: cada, titulo: 'Pedidos por día' }));
    }

    h += seccion('Platos más pedidos', barrasH(s.topPlatos.map((p) => ({ etq: p.nombre, valor: p.cantidad, extra: `${fmt(p.ingresos)} CUP` })), 'uds'));
    h += seccion('Horas con más pedidos', columnas(s.porHora.map((x) => ({ etq: String(x.hora), valor: x.pedidos })), { etiquetaCada: 3, titulo: 'Pedidos por hora' }));
    h += seccion('Por municipio', barrasH(s.porMunicipio.map((m) => ({ etq: nombreMunicipio(m.municipio), valor: m.pedidos, extra: `${fmt(m.ingresos)} CUP` })), 'ped.'));
    h += seccion('Método de pago', barrasH(s.porPago.map((m) => ({ etq: m.nombre, valor: m.pedidos, extra: `${fmt(m.ingresos)} CUP` })), 'ped.'));

    const estados = Object.keys(s.porEstado).map((k) => ({ etq: ETQ[k] || k, valor: s.porEstado[k] }));
    h += seccion('Estado de los pedidos', barrasH(estados, ''));
    if (s.fueraDeHorario) h += `<p class="stats-nota">🌙 ${s.fueraDeHorario} ${s.fueraDeHorario === 1 ? 'pedido llegó' : 'pedidos llegaron'} fuera de horario.</p>`;
    cont.innerHTML = h;
  }

  async function cargar() {
    const mio = ++pedido;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c.dataset.p === periodo));
    try {
      const s = await window.ComunAdmin.apiFetch(`/api/stats?periodo=${encodeURIComponent(periodo)}`);
      if (mio !== pedido) return;
      render(s);
    } catch (err) {
      if (mio !== pedido) return;
      cont.innerHTML = `<p class="form__error">${esc(err.message)}</p><button class="btn btn--fantasma" id="btnReintentarStats">Reintentar</button>`;
      document.getElementById('btnReintentarStats').addEventListener('click', cargar);
    }
  }

  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    periodo = b.dataset.p;
    try { localStorage.setItem('pechatniky_stats_periodo', periodo); } catch (_) { /* privado */ }
    cargar();
  });

  fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((yo) => { if (yo && window.Temas) window.Temas.aplicar(yo.tema || 'auto'); }).catch(() => {});
  cargar();
  window.MonitorPedidos.iniciar();
  setInterval(() => { if (!document.hidden) cargar(); }, 60000);
})();
