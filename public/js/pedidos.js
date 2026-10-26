// Pagina de Pedidos (admin): lista con busqueda y filtros, avance de estado,
// edicion del contenido del pedido, historial, llamada/WhatsApp y copiado.

(() => {
  'use strict';

  const state = {
    cache: new Map(), // id → pedido (acumula lo cargado; el sondeo lo va actualizando)
    productos: [],
    tasaCup: null,
    zona: 'America/Havana',
    estadoActivo: 'todos',
    texto: '',
    fecha: '7d',
    municipio: '',
    todoCargado: false,
    editando: null, // { pedido, items: [...] }
  };

  const el = {
    lista: document.getElementById('listaPedidos'),
    estadoVacio: document.getElementById('estadoVacio'),
    conteo: document.getElementById('conteoPedidos'),
    chips: document.getElementById('chipsEstado'),
    btnSalir: document.getElementById('btnSalir'),
    toast: document.getElementById('toast'),
    buscar: document.getElementById('buscarPedido'),
    filtroFecha: document.getElementById('filtroFecha'),
    filtroMunicipio: document.getElementById('filtroMunicipio'),

    overlayEditar: document.getElementById('overlayEditar'),
    sheetEditar: document.getElementById('sheetEditar'),
    editarTitulo: document.getElementById('editarTitulo'),
    btnCerrarEditar: document.getElementById('btnCerrarEditar'),
    btnEditarCancelar: document.getElementById('btnEditarCancelar'),
    formEditar: document.getElementById('formEditar'),
    editItems: document.getElementById('editItems'),
    editAgregarSelect: document.getElementById('editAgregarSelect'),
    editNombre: document.getElementById('editNombre'),
    editTelefono: document.getElementById('editTelefono'),
    editMunicipio: document.getElementById('editMunicipio'),
    editDireccion: document.getElementById('editDireccion'),
    editNota: document.getElementById('editNota'),
    editEnvio: document.getElementById('editEnvio'),
    editEnvioAyuda: document.getElementById('editEnvioAyuda'),
    editNotaAdmin: document.getElementById('editNotaAdmin'),
    editTotales: document.getElementById('editTotales'),
    editError: document.getElementById('editError'),
    btnEditarGuardar: document.getElementById('btnEditarGuardar'),
  };

  // Debe coincidir con MUNICIPIOS_HABANA en src/config.js
  const NOMBRES_MUNICIPIO = {
    playa: 'Playa',
    plaza_de_la_revolucion: 'Plaza de la Revolución',
    centro_habana: 'Centro Habana',
    la_habana_vieja: 'La Habana Vieja',
    regla: 'Regla',
    la_habana_del_este: 'La Habana del Este',
    guanabacoa: 'Guanabacoa',
    san_miguel_del_padron: 'San Miguel del Padrón',
    diez_de_octubre: 'Diez de Octubre',
    cerro: 'Cerro',
    marianao: 'Marianao',
    la_lisa: 'La Lisa',
    boyeros: 'Boyeros',
    arroyo_naranjo: 'Arroyo Naranjo',
    cotorro: 'Cotorro',
  };

  const ESTADOS = {
    nuevo: { etiqueta: 'Nuevo', clase: 'pedido__estado--nuevo', siguiente: 'en_preparacion', accion: 'En preparación' },
    en_preparacion: { etiqueta: 'En preparación', clase: 'pedido__estado--preparacion', siguiente: 'enviado', accion: 'Enviado' },
    enviado: { etiqueta: 'Enviado', clase: 'pedido__estado--enviado', siguiente: 'completado', accion: 'Completado' },
    completado: { etiqueta: 'Completado', clase: 'pedido__estado--completado', siguiente: null, accion: null },
    cancelado: { etiqueta: 'Cancelado', clase: 'pedido__estado--cancelado', siguiente: null, accion: null },
  };
  const ACTIVOS = ['nuevo', 'en_preparacion', 'enviado'];

  // ---------- Utilidades ----------
  const apiFetch = (url, opts) => window.ComunAdmin.apiFetch(url, opts);

  function mostrarToast(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('is-visible');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
  }

  const formatearCup = (n) => (Number.isInteger(n) ? String(n) : Number(n).toFixed(2));

  function formatearUsdReferencia(cup) {
    if (!state.tasaCup) return '';
    return `$${Math.ceil(cup / state.tasaCup)} USD`;
  }

  function formatearFecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: state.zona });
  }

  function fechaLocal(isoOrDate) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: state.zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(isoOrDate));
    } catch (_) {
      return new Date(isoOrDate).toISOString().slice(0, 10);
    }
  }

  function sumarDias(fechaISO, dias) {
    const d = new Date(`${fechaISO}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  const todosLosPedidos = () => [...state.cache.values()].sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));

  function guardarEnCache(lista) {
    lista.forEach((p) => state.cache.set(p.id, p));
  }

  el.btnSalir.addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } finally { window.location.href = '/'; }
  });

  // ---------- Carga inicial ----------
  async function cargarDatos() {
    try {
      const [pedidos, ajustes, yo, productos] = await Promise.all([
        apiFetch('/api/orders'),
        apiFetch('/api/settings'),
        apiFetch('/api/me'),
        apiFetch('/api/products'),
      ]);
      guardarEnCache(pedidos);
      state.productos = productos;
      state.tasaCup = ajustes.tasaCup;
      state.zona = ajustes.horario.zona;
      if (window.Temas) window.Temas.aplicar(yo.tema);
      renderLista();
    } catch (err) {
      el.conteo.textContent = 'No se pudieron cargar los pedidos.';
      mostrarToast(err.message);
    }
  }

  // El sondeo (monitorPedidos.js) trae la lista reciente; la mezclamos con lo
  // que ya teníamos cargado (p. ej. historial completo).
  function alRecibirPedidosDelSondeo(pedidos) {
    if (state.editando) { guardarEnCache(pedidos); return; } // no repintar mientras se edita
    guardarEnCache(pedidos);
    renderLista();
  }

  // ---------- Filtros ----------
  el.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.estadoActivo = chip.dataset.estado;
    renderLista();
  });

  el.buscar.addEventListener('input', () => { state.texto = el.buscar.value.trim().toLowerCase(); renderLista(); });
  el.filtroMunicipio.addEventListener('change', () => { state.municipio = el.filtroMunicipio.value; renderLista(); });
  el.filtroFecha.addEventListener('change', async () => {
    state.fecha = el.filtroFecha.value;
    if (state.fecha === 'todo' && !state.todoCargado) {
      try {
        guardarEnCache(await apiFetch('/api/orders?dias=0'));
        state.todoCargado = true;
      } catch (err) { mostrarToast(err.message); }
    }
    renderLista();
  });

  Object.entries(NOMBRES_MUNICIPIO).forEach(([id, nombre]) => {
    el.filtroMunicipio.appendChild(new Option(nombre, id));
    el.editMunicipio.appendChild(new Option(nombre, id));
  });

  function dentroDeFecha(p) {
    if (ACTIVOS.includes(p.estado)) return true; // un pedido activo nunca se esconde
    if (state.fecha === 'todo') return true;
    const hoy = fechaLocal(new Date());
    const f = fechaLocal(p.creadoEn);
    if (state.fecha === 'hoy') return f === hoy;
    if (state.fecha === 'ayer') return f === sumarDias(hoy, -1);
    if (state.fecha === '7d') return f >= sumarDias(hoy, -6);
    if (state.fecha === '30d') return f >= sumarDias(hoy, -29);
    return true;
  }

  function coincideTexto(p) {
    if (!state.texto) return true;
    const t = state.texto.replace(/^#/, '');
    const digitos = t.replace(/\D/g, '');
    if (p.numero && String(p.numero) === t) return true;
    const c = p.cliente;
    if ((c.nombre || '').toLowerCase().includes(t)) return true;
    if ((c.direccion || '').toLowerCase().includes(t)) return true;
    if (digitos.length >= 3 && String(c.telefono || '').replace(/\D/g, '').includes(digitos)) return true;
    if (p.items.some((it) => it.nombre.toLowerCase().includes(t))) return true;
    return false;
  }

  function pedidosFiltrados() {
    return todosLosPedidos().filter((p) => {
      if (state.estadoActivo !== 'todos' && p.estado !== state.estadoActivo) return false;
      if (state.municipio && p.cliente.municipio !== state.municipio) return false;
      return dentroDeFecha(p) && coincideTexto(p);
    });
  }

  // ---------- Render ----------
  function renderLista() {
    const todos = todosLosPedidos();
    const pedidos = pedidosFiltrados();
    el.lista.innerHTML = '';

    const nuevos = todos.filter((p) => p.estado === 'nuevo').length;
    const activos = todos.filter((p) => ACTIVOS.includes(p.estado)).length;
    el.conteo.textContent = `${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}${nuevos ? ` · ${nuevos} ${nuevos === 1 ? 'nuevo' : 'nuevos'}` : ''}${activos ? ` · ${activos} activos` : ''}`;

    if (pedidos.length === 0) {
      el.estadoVacio.hidden = false;
      el.estadoVacio.querySelector('h2').textContent = todos.length === 0 ? 'Todavía no hay pedidos' : 'No hay pedidos con estos filtros';
      el.estadoVacio.querySelector('p').textContent = todos.length === 0
        ? 'En cuanto un cliente pida algo desde la tienda, aparecerá aquí.'
        : 'Prueba con otro filtro, otra fecha o borra la búsqueda.';
      return;
    }
    el.estadoVacio.hidden = true;
    pedidos.forEach((p) => el.lista.appendChild(crearTarjetaPedido(p)));
  }

  function textoPedido(p) {
    const l = [];
    l.push(`Pedido #${p.numero || '?'} — ${ESTADOS[p.estado].etiqueta}`);
    l.push(`${p.cliente.nombre} · ${p.cliente.telefono}`);
    l.push(`${NOMBRES_MUNICIPIO[p.cliente.municipio] || ''} · ${p.cliente.direccion}`);
    if (p.cliente.ubicacion) l.push(`https://www.openstreetmap.org/?mlat=${p.cliente.ubicacion.lat}&mlon=${p.cliente.ubicacion.lng}#map=17/${p.cliente.ubicacion.lat}/${p.cliente.ubicacion.lng}`);
    p.items.forEach((it) => l.push(`- ${it.cantidad}x ${it.nombre}`));
    l.push(`Total: ${formatearCup(p.totalConEnvioCup ?? p.totalCup)} CUP${p.metodoPago ? ` (${p.metodoPago.nombre})` : ''}`);
    if (p.cliente.nota) l.push(`Nota: ${p.cliente.nota}`);
    return l.join('\n');
  }

  // Ticket para cocina/reparto: ventana mínima lista para imprimir (80 mm).
  function imprimirTicket(p) {
    const e = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const filas = p.items.map((it) => `<tr><td>${e(it.cantidad)}×</td><td>${e(it.nombre)}</td><td class="r">${e(formatearCup(it.precio * it.cantidad))}</td></tr>`).join('');
    const fecha = new Date(p.creadoEn).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    const html = `<!doctype html><meta charset="utf-8"><title>Pedido #${e(p.numero || '')}</title>
<style>
 body{font:14px/1.35 monospace;width:72mm;margin:4mm auto;color:#000}
 h1{font-size:22px;margin:0 0 2px} hr{border:0;border-top:1px dashed #000;margin:6px 0}
 table{width:100%;border-collapse:collapse} td{vertical-align:top;padding:1px 0} .r{text-align:right;white-space:nowrap}
 .g{font-size:16px;font-weight:bold}
 @page{margin:0}
</style>
<h1>Pedido #${e(p.numero || '?')}</h1>
<div>${e(fecha)}${p.fueraDeHorario ? ' · FUERA DE HORARIO' : ''}</div><hr>
<div><b>${e(p.cliente.nombre)}</b><br>${e(p.cliente.telefono)}<br>${e(NOMBRES_MUNICIPIO[p.cliente.municipio] || '')}<br>${e(p.cliente.direccion)}</div>
${p.cliente.nota ? `<hr><div>Nota: ${e(p.cliente.nota)}</div>` : ''}
${p.notaAdmin ? `<div>Interno: ${e(p.notaAdmin)}</div>` : ''}<hr>
<table>${filas}</table><hr>
<table><tr><td>Subtotal</td><td class="r">${e(formatearCup(p.totalCup))}</td></tr>
<tr><td>Envío${p.envioGratis ? ' (gratis)' : ''}</td><td class="r">${e(formatearCup(p.envioCup || 0))}</td></tr>
<tr class="g"><td>TOTAL CUP</td><td class="r">${e(formatearCup(p.totalConEnvioCup ?? p.totalCup))}</td></tr></table>
${p.metodoPago ? `<div>Pago: ${e(p.metodoPago.nombre)}</div>` : ''}
<script>window.onload=function(){window.print();}<\/script>`;
    const w = window.open('', '_blank', 'width=420,height=640');
    if (!w) { mostrarToast('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  async function copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch (_) {
      const t = document.createElement('textarea');
      t.value = texto;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      try { document.execCommand('copy'); } catch (__) { /* ignorar */ }
      t.remove();
    }
    mostrarToast('Pedido copiado.');
  }

  function crearTarjetaPedido(pedido) {
    const meta = ESTADOS[pedido.estado] || ESTADOS.nuevo;

    const tarjeta = document.createElement('article');
    tarjeta.className = 'pedido';

    const cabecera = document.createElement('div');
    cabecera.className = 'pedido__cabecera';
    const nombre = document.createElement('p');
    nombre.className = 'pedido__cliente';
    if (pedido.numero) {
      const n = document.createElement('span');
      n.className = 'pedido__numero';
      n.textContent = `#${pedido.numero}`;
      nombre.appendChild(n);
    }
    nombre.appendChild(document.createTextNode(pedido.cliente.nombre));
    const estado = document.createElement('span');
    estado.className = `pedido__estado ${meta.clase}`;
    estado.textContent = meta.etiqueta;
    cabecera.append(nombre, estado);
    tarjeta.appendChild(cabecera);

    // Etiquetas: fuera de horario, editado, pago
    const etiquetas = document.createElement('div');
    etiquetas.className = 'pedido__etiquetas';
    const addEtiqueta = (txt, extra) => {
      const s = document.createElement('span');
      s.className = `pedido__etiqueta${extra ? ` ${extra}` : ''}`;
      s.textContent = txt;
      etiquetas.appendChild(s);
    };
    if (pedido.fueraDeHorario) addEtiqueta('🌙 Fuera de horario', 'pedido__etiqueta--aviso');
    if (pedido.editadoEn) addEtiqueta('✏️ Editado', 'pedido__etiqueta--editado');
    if (pedido.metodoPago) addEtiqueta(`💳 ${pedido.metodoPago.nombre}`);
    if (pedido.envioGratis) addEtiqueta('Envío gratis');
    if (etiquetas.children.length) tarjeta.appendChild(etiquetas);

    const contacto = document.createElement('p');
    contacto.className = 'pedido__contacto';
    const nombreMunicipio = pedido.cliente.municipio ? NOMBRES_MUNICIPIO[pedido.cliente.municipio] || pedido.cliente.municipio : null;
    contacto.textContent = nombreMunicipio
      ? `${pedido.cliente.telefono} · ${pedido.cliente.direccion} · ${nombreMunicipio}`
      : `${pedido.cliente.telefono} · ${pedido.cliente.direccion}`;
    if (pedido.cliente.ubicacion) {
      const { lat, lng } = pedido.cliente.ubicacion;
      const enlaceMapa = document.createElement('a');
      enlaceMapa.className = 'pedido__enlace-mapa';
      enlaceMapa.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
      enlaceMapa.target = '_blank';
      enlaceMapa.rel = 'noopener noreferrer';
      enlaceMapa.textContent = '📍 Ver ubicación en el mapa';
      contacto.append(' · ', enlaceMapa);
    }
    tarjeta.appendChild(contacto);

    if (pedido.cliente.direccionAproximada) {
      const caja = document.createElement('p');
      caja.className = 'pedido__direccion-aprox';
      const etiqueta = document.createElement('strong');
      etiqueta.textContent = '📍 Ubicación aproximada (mapa): ';
      caja.append(etiqueta, document.createTextNode(pedido.cliente.direccionAproximada));
      tarjeta.appendChild(caja);
    }

    if (pedido.fueraDeHorario && pedido.mensajeEntrega && ACTIVOS.includes(pedido.estado)) {
      const aviso = document.createElement('p');
      aviso.className = 'pedido__admin-nota';
      aviso.textContent = `🌙 ${pedido.mensajeEntrega}`;
      tarjeta.appendChild(aviso);
    }

    const fecha = document.createElement('p');
    fecha.className = 'pedido__fecha';
    fecha.textContent = formatearFecha(pedido.creadoEn);
    tarjeta.appendChild(fecha);

    const items = document.createElement('ul');
    items.className = 'pedido__items';
    pedido.items.forEach((it) => {
      const li = document.createElement('li');
      const porcionTexto = it.porcion ? ` (${formatearCup(it.porcion.valor)} ${it.porcion.unidad})` : '';
      li.textContent = `${it.cantidad}× ${it.nombre}${porcionTexto}`;
      items.appendChild(li);
    });
    tarjeta.appendChild(items);

    if (pedido.cliente.nota) {
      const nota = document.createElement('p');
      nota.className = 'pedido__nota';
      nota.textContent = `Nota: ${pedido.cliente.nota}`;
      tarjeta.appendChild(nota);
    }
    if (pedido.notaAdmin) {
      const nota = document.createElement('p');
      nota.className = 'pedido__admin-nota';
      nota.textContent = `🔒 ${pedido.notaAdmin}`;
      tarjeta.appendChild(nota);
    }

    const tieneEnvio = pedido.envioCup !== undefined && pedido.envioCup !== null;
    if (tieneEnvio) {
      const desglose = document.createElement('p');
      desglose.className = 'pedido__desglose';
      desglose.textContent = `Subtotal ${formatearCup(pedido.totalCup)} CUP + envío ${formatearCup(pedido.envioCup)} CUP`;
      tarjeta.appendChild(desglose);
    }

    // Enlaces rápidos
    const enlaces = document.createElement('div');
    enlaces.className = 'pedido__enlaces';
    const tel = String(pedido.cliente.telefono || '').replace(/[^\d+]/g, '');
    if (tel) {
      const a = document.createElement('a');
      a.href = `tel:${tel}`;
      a.textContent = '📞 Llamar';
      enlaces.appendChild(a);
      const digitos = tel.replace(/\D/g, '');
      if (digitos.length >= 8) {
        const w = document.createElement('a');
        w.href = `https://wa.me/${digitos}`;
        w.target = '_blank';
        w.rel = 'noopener noreferrer';
        w.textContent = '💬 WhatsApp';
        enlaces.appendChild(w);
      }
    }
    const btnCopiar = document.createElement('button');
    btnCopiar.type = 'button';
    btnCopiar.textContent = '📋 Copiar';
    btnCopiar.addEventListener('click', () => copiarTexto(textoPedido(pedido)));
    enlaces.appendChild(btnCopiar);
    const btnImprimir = document.createElement('button');
    btnImprimir.type = 'button';
    btnImprimir.textContent = '🖨 Imprimir';
    btnImprimir.addEventListener('click', () => imprimirTicket(pedido));
    enlaces.appendChild(btnImprimir);
    tarjeta.appendChild(enlaces);

    // Historial
    if (Array.isArray(pedido.historial) && pedido.historial.length > 1) {
      const det = document.createElement('details');
      det.className = 'pedido__historial';
      const sum = document.createElement('summary');
      sum.textContent = `Historial (${pedido.historial.length})`;
      const ul = document.createElement('ul');
      pedido.historial.forEach((h) => {
        const li = document.createElement('li');
        li.textContent = `${formatearFecha(h.fecha)} — ${h.texto}`;
        ul.appendChild(li);
      });
      det.append(sum, ul);
      tarjeta.appendChild(det);
    }

    const pie = document.createElement('div');
    pie.className = 'pedido__pie';

    const total = document.createElement('div');
    total.className = 'pedido__total';
    const totalAPagar = tieneEnvio ? pedido.totalConEnvioCup : pedido.totalCup;
    const totalCup = document.createElement('span');
    totalCup.className = 'pedido__total-cup';
    totalCup.textContent = `${formatearCup(totalAPagar)} CUP`;
    total.appendChild(totalCup);
    const usdRef = formatearUsdReferencia(totalAPagar);
    if (usdRef) {
      const totalUsd = document.createElement('span');
      totalUsd.className = 'pedido__total-usd';
      totalUsd.textContent = usdRef;
      total.appendChild(totalUsd);
    }
    pie.appendChild(total);

    if (meta.siguiente) {
      const btn = document.createElement('button');
      btn.className = 'btn btn--principal btn--chico';
      btn.textContent = meta.accion;
      btn.addEventListener('click', () => cambiarEstado(pedido.id, meta.siguiente, btn));
      pie.appendChild(btn);
    }

    if (ACTIVOS.includes(pedido.estado)) {
      const btnEditar = document.createElement('button');
      btnEditar.type = 'button';
      btnEditar.className = 'btn btn--fantasma btn--chico';
      btnEditar.textContent = 'Editar';
      btnEditar.addEventListener('click', () => abrirEditor(pedido));
      pie.appendChild(btnEditar);

      const btnCancelar = document.createElement('button');
      btnCancelar.type = 'button';
      btnCancelar.className = 'btn btn--peligro btn--chico';
      btnCancelar.textContent = 'Cancelar pedido';
      btnCancelar.addEventListener('click', () => cancelarPedidoAdmin(pedido.id, btnCancelar));
      pie.appendChild(btnCancelar);
    }

    tarjeta.appendChild(pie);
    return tarjeta;
  }

  async function cambiarEstado(id, estadoNuevo, boton) {
    boton.disabled = true;
    try {
      const actualizado = await apiFetch(`/api/orders/${id}/estado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: estadoNuevo }),
      });
      state.cache.set(id, actualizado);
      MonitorPedidos.marcarVisto(id, actualizado.estado);
      renderLista();
      mostrarToast('Pedido actualizado.');
    } catch (err) {
      mostrarToast(err.message);
      boton.disabled = false;
    }
  }

  async function cancelarPedidoAdmin(id, boton) {
    if (!window.confirm('¿Seguro que quieres cancelar este pedido? El stock de los platos se devolverá.')) return;
    boton.disabled = true;
    boton.textContent = 'Cancelando…';
    try {
      const actualizado = await apiFetch(`/api/orders/${id}/cancelar`, { method: 'POST' });
      state.cache.set(id, actualizado);
      MonitorPedidos.marcarVisto(id, actualizado.estado);
      renderLista();
      mostrarToast('Pedido cancelado.');
    } catch (err) {
      mostrarToast(err.message);
      boton.disabled = false;
      boton.textContent = 'Cancelar pedido';
    }
  }

  // ---------- Editor de pedido ----------
  function abrirEditor(pedido) {
    state.editando = {
      pedido,
      items: pedido.items.map((it) => ({ productoId: it.productoId, nombre: it.nombre, precio: it.precio, cantidad: it.cantidad })),
    };
    el.editarTitulo.textContent = `Editar pedido${pedido.numero ? ` #${pedido.numero}` : ''}`;
    el.editNombre.value = pedido.cliente.nombre || '';
    el.editTelefono.value = pedido.cliente.telefono || '';
    el.editMunicipio.value = pedido.cliente.municipio || '';
    el.editDireccion.value = pedido.cliente.direccion || '';
    el.editNota.value = pedido.cliente.nota || '';
    el.editEnvio.value = pedido.envioCup ?? 0;
    el.editEnvio.dataset.original = String(pedido.envioCup ?? 0);
    el.editNotaAdmin.value = pedido.notaAdmin || '';
    el.editEnvioAyuda.textContent = pedido.envioManual
      ? 'El envío se fijó a mano en este pedido.'
      : 'Si cambias platos o municipio, el envío se recalcula solo (a menos que lo escribas tú).';
    el.editError.hidden = true;

    // Select para agregar platos
    el.editAgregarSelect.innerHTML = '<option value="">+ Agregar un plato…</option>';
    state.productos.filter((p) => p.disponible).forEach((p) => {
      el.editAgregarSelect.appendChild(new Option(`${p.nombre} — ${formatearCup(p.precio)} CUP`, p.id));
    });

    renderEditorItems();
    el.overlayEditar.hidden = false;
    el.sheetEditar.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetEditar.classList.add('is-abierto'));
  }

  function cerrarEditor() {
    el.sheetEditar.classList.remove('is-abierto');
    el.sheetEditar.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayEditar.hidden = true; }, 200);
    state.editando = null;
    renderLista();
  }

  el.btnCerrarEditar.addEventListener('click', cerrarEditor);
  el.btnEditarCancelar.addEventListener('click', cerrarEditor);
  el.overlayEditar.addEventListener('click', cerrarEditor);

  function renderEditorItems() {
    const ed = state.editando;
    el.editItems.innerHTML = '';
    ed.items.forEach((it, idx) => {
      const fila = document.createElement('div');
      fila.className = 'edit-item';

      const nombre = document.createElement('span');
      nombre.className = 'edit-item__nombre';
      nombre.textContent = it.nombre;
      const quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'edit-item__quitar';
      quitar.textContent = 'Quitar';
      quitar.addEventListener('click', () => { ed.items.splice(idx, 1); renderEditorItems(); });

      const control = document.createElement('div');
      control.className = 'edit-item__fila';
      const stepper = document.createElement('div');
      stepper.className = 'stepper';
      const menos = document.createElement('button');
      menos.type = 'button'; menos.className = 'stepper__btn'; menos.textContent = '−';
      menos.addEventListener('click', () => { if (it.cantidad > 1) { it.cantidad -= 1; renderEditorItems(); } });
      const valor = document.createElement('span');
      valor.className = 'stepper__valor';
      valor.textContent = it.cantidad;
      const mas = document.createElement('button');
      mas.type = 'button'; mas.className = 'stepper__btn'; mas.textContent = '+';
      mas.addEventListener('click', () => { it.cantidad += 1; renderEditorItems(); });
      stepper.append(menos, valor, mas);

      const precioWrap = document.createElement('label');
      precioWrap.className = 'edit-item__precio';
      precioWrap.append('Precio');
      const precio = document.createElement('input');
      precio.type = 'number'; precio.min = '0'; precio.step = '1'; precio.value = it.precio;
      precio.addEventListener('input', () => { it.precio = Number(precio.value) || 0; actualizarTotalesEditor(); });
      precioWrap.append(precio, 'CUP');

      control.append(stepper, precioWrap);
      fila.append(nombre, quitar, control);
      el.editItems.appendChild(fila);
    });
    actualizarTotalesEditor();
  }

  function actualizarTotalesEditor() {
    const ed = state.editando;
    if (!ed) return;
    const subtotal = ed.items.reduce((s, it) => s + it.precio * it.cantidad, 0);
    const envio = Number(el.editEnvio.value) || 0;
    el.editTotales.innerHTML = '';
    [['Subtotal', `${formatearCup(subtotal)} CUP`], ['Envío', `${formatearCup(envio)} CUP`], ['Total', `${formatearCup(subtotal + envio)} CUP`]].forEach(([a, b], i) => {
      const f = document.createElement('div');
      f.className = `fila${i === 2 ? ' fila--total' : ''}`;
      const x = document.createElement('span'); x.textContent = a;
      const y = document.createElement('span'); y.textContent = b;
      f.append(x, y);
      el.editTotales.appendChild(f);
    });
  }
  el.editEnvio.addEventListener('input', actualizarTotalesEditor);

  el.editAgregarSelect.addEventListener('change', () => {
    const id = el.editAgregarSelect.value;
    if (!id || !state.editando) return;
    const prod = state.productos.find((p) => p.id === id);
    const existente = state.editando.items.find((it) => it.productoId === id);
    if (existente) existente.cantidad += 1;
    else if (prod) state.editando.items.push({ productoId: prod.id, nombre: prod.nombre, precio: prod.precio, cantidad: 1 });
    el.editAgregarSelect.value = '';
    renderEditorItems();
  });

  el.formEditar.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ed = state.editando;
    if (!ed) return;
    el.editError.hidden = true;
    if (ed.items.length === 0) {
      el.editError.textContent = 'El pedido debe tener al menos un plato. Si quieres anularlo, usa "Cancelar pedido".';
      el.editError.hidden = false;
      return;
    }
    const cuerpo = {
      items: ed.items.map((it) => ({ productoId: it.productoId, cantidad: it.cantidad, precio: it.precio })),
      cliente: {
        nombre: el.editNombre.value,
        telefono: el.editTelefono.value,
        municipio: el.editMunicipio.value,
        direccion: el.editDireccion.value,
        nota: el.editNota.value,
      },
      notaAdmin: el.editNotaAdmin.value,
    };
    if (el.editEnvio.value !== el.editEnvio.dataset.original) cuerpo.envioCup = el.editEnvio.value;

    el.btnEditarGuardar.disabled = true;
    el.btnEditarGuardar.textContent = 'Guardando…';
    try {
      const actualizado = await apiFetch(`/api/orders/${ed.pedido.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      });
      state.cache.set(actualizado.id, actualizado);
      MonitorPedidos.marcarVisto(actualizado.id, actualizado.estado);
      // El stock pudo cambiar: refrescamos los platos en segundo plano
      apiFetch('/api/products').then((p) => { state.productos = p; }).catch(() => {});
      mostrarToast('Pedido actualizado.');
      cerrarEditor();
    } catch (err) {
      el.editError.textContent = err.message;
      el.editError.hidden = false;
    } finally {
      el.btnEditarGuardar.disabled = false;
      el.btnEditarGuardar.textContent = 'Guardar cambios';
    }
  });

  // ---------- Inicio ----------
  cargarDatos();
  MonitorPedidos.iniciar({ onPedidos: alRecibirPedidosDelSondeo });
})();
