// Логика страницы настроек: тип обмена CUP/USD и управление категориями.

(() => {
  'use strict';

  const state = {
    categorias: [],
    productos: [],
    confirmCallback: null,
  };

  // Debe coincidir con MUNICIPIOS_HABANA en src/config.js (repetido acá
  // igual que en tienda.js/pedidos.js — no hay build step que lo comparta
  // entre servidor y navegador).
  const MUNICIPIOS_HABANA = [
    { id: 'playa', nombre: 'Playa' },
    { id: 'plaza_de_la_revolucion', nombre: 'Plaza de la Revolución' },
    { id: 'centro_habana', nombre: 'Centro Habana' },
    { id: 'la_habana_vieja', nombre: 'La Habana Vieja' },
    { id: 'regla', nombre: 'Regla' },
    { id: 'la_habana_del_este', nombre: 'La Habana del Este' },
    { id: 'guanabacoa', nombre: 'Guanabacoa' },
    { id: 'san_miguel_del_padron', nombre: 'San Miguel del Padrón' },
    { id: 'diez_de_octubre', nombre: 'Diez de Octubre' },
    { id: 'cerro', nombre: 'Cerro' },
    { id: 'marianao', nombre: 'Marianao' },
    { id: 'la_lisa', nombre: 'La Lisa' },
    { id: 'boyeros', nombre: 'Boyeros' },
    { id: 'arroyo_naranjo', nombre: 'Arroyo Naranjo' },
    { id: 'cotorro', nombre: 'Cotorro' },
  ];

  const el = {
    btnSalir: document.getElementById('btnSalir'),
    pedidosBadge: document.getElementById('pedidosBadge'),

    formTasa: document.getElementById('formTasa'),
    campoTasa: document.getElementById('campoTasa'),
    tasaActualizada: document.getElementById('tasaActualizada'),
    tasaError: document.getElementById('tasaError'),
    btnGuardarTasa: document.getElementById('btnGuardarTasa'),

    formEnvios: document.getElementById('formEnvios'),
    enviosLista: document.getElementById('enviosLista'),
    enviosError: document.getElementById('enviosError'),
    btnGuardarEnvios: document.getElementById('btnGuardarEnvios'),

    catLista: document.getElementById('catLista'),
    formCategoriaNueva: document.getElementById('formCategoriaNueva'),
    campoCategoriaNueva: document.getElementById('campoCategoriaNueva'),
    categoriaError: document.getElementById('categoriaError'),

    overlayConfirm: document.getElementById('overlayConfirm'),
    confirmEliminar: document.getElementById('confirmEliminar'),
    confirmTexto: document.getElementById('confirmTexto'),
    btnConfirmCancelar: document.getElementById('btnConfirmCancelar'),
    btnConfirmEliminar: document.getElementById('btnConfirmEliminar'),

    toast: document.getElementById('toast'),
  };

  // ---------- Utilidades de red ----------
  const apiFetch = (url, options) => window.ComunAdmin.apiFetch(url, options);
  const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  function mostrarToast(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('is-visible');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
  }

  function formatearFecha(iso) {
    if (!iso) return '';
    const fecha = new Date(iso);
    return fecha.toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Cerrar sesión ----------
  el.btnSalir.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      window.location.href = '/';
    }
  });

  // ---------- Carga inicial ----------
  async function cargarDatos() {
    try {
      const [categorias, productos, ajustes, yo] = await Promise.all([
        apiFetch('/api/categories'),
        apiFetch('/api/products'),
        apiFetch('/api/settings'),
        apiFetch('/api/me'),
      ]);
      state.categorias = categorias;
      state.productos = productos;
      state.ajustes = ajustes;
      state.yo = yo;
      if (window.Temas) window.Temas.aplicar(yo.tema || 'auto');
      el.campoTasa.value = ajustes.tasaCup;
      el.tasaActualizada.textContent = `Última actualización: ${formatearFecha(ajustes.actualizadoEn)}`;
      renderListaCategorias();
      renderListaEnvios(ajustes.enviosPorMunicipio || {});
      rellenarSecciones(ajustes);
      renderHorario(ajustes.horario);
      renderPagos(ajustes.pedidos.pagos);
      renderEventos(ajustes.telegram.eventos, ajustes._eventosTelegram);
      renderTemasAdmin(yo.tema || 'auto');
      renderTemaDefecto(ajustes.apariencia.temaPorDefecto);
      renderFrecuencias(ajustes.backup.frecuenciaHoras, 'backupFrecuencia');
      renderFrecuencias(ajustes.backup.telegramCadaHoras, 'backupTgFrecuencia');
      pintarUltimoTelegram(ajustes.backup.telegramUltimo);
      pintarEstadoTienda(ajustes._estado);
      pintarIcono(ajustes.tienda.icono);
      cargarTelegram();
      cargarBackups();
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  // ---------- Formularios por sección (data-k="seccion.campo") ----------
  function valorEn(obj, ruta) {
    return ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }

  function rellenarSecciones(ajustes) {
    document.querySelectorAll('[data-k]').forEach((campo) => {
      if (campo.id === 'temaDefectoSelect' || campo.id === 'backupFrecuencia' || campo.id === 'backupTgFrecuencia') return; // se rellenan aparte
      const v = valorEn(ajustes, campo.dataset.k);
      if (campo.type === 'checkbox') campo.checked = Boolean(v);
      else if (campo.dataset.k === 'telegram.token') campo.value = v || '';
      else campo.value = v == null ? '' : v;
    });
  }

  function leerCampo(campo) {
    if (campo.type === 'checkbox') return campo.checked;
    if (campo.type === 'number') return campo.value === '' ? 0 : Number(campo.value);
    return campo.value;
  }

  function asignar(obj, ruta, valor) {
    const partes = ruta.split('.');
    let o = obj;
    partes.slice(0, -1).forEach((k) => { o = o[k] = o[k] || {}; });
    o[partes[partes.length - 1]] = valor;
  }

  function pintarEstadoTienda(estado) {
    const p = document.getElementById('estadoTiendaActual');
    if (p && estado) p.textContent = `Ahora mismo: ${estado.abierto ? '🟢 abierta' : '🔴 cerrada'} — ${estado.texto || ''}`;
  }

  // Cada <form data-seccion> envía solo su sección (actualización parcial).
  document.querySelectorAll('form[data-seccion]').forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const seccion = form.dataset.seccion;
      const errorEl = form.querySelector('.form__error');
      const boton = form.querySelector('button[type=submit]');
      if (errorEl) errorEl.hidden = true;

      const cuerpo = { [seccion]: {} };
      form.querySelectorAll('[data-k]').forEach((campo) => {
        const ruta = campo.dataset.k.split('.').slice(1).join('.');
        asignar(cuerpo[seccion], ruta, leerCampo(campo));
      });
      if (seccion === 'horario') cuerpo.horario.dias = leerHorario();
      if (seccion === 'pedidos') cuerpo.pedidos.pagos = leerPagos();
      if (seccion === 'telegram') cuerpo.telegram.eventos = leerEventos();

      const textoOrig = boton.textContent;
      boton.disabled = true;
      boton.textContent = 'Guardando…';
      try {
        const nuevo = await apiFetch('/api/settings', jsonOpts('PUT', cuerpo));
        state.ajustes = nuevo;
        rellenarSecciones(nuevo);
        if (seccion === 'horario') pintarEstadoTienda(nuevo._estado);
        if (seccion === 'pedidos') renderPagos(nuevo.pedidos.pagos);
        if (seccion === 'admin' && window.MonitorPedidos) window.MonitorPedidos.setSonido(nuevo.admin.sonidoPedidoNuevo);
        if (seccion === 'telegram') cargarTelegram();
        mostrarToast('Guardado ✓');
      } catch (err) {
        if (errorEl) { errorEl.textContent = err.message; errorEl.hidden = false; }
        mostrarToast(err.message);
      } finally {
        boton.disabled = false;
        boton.textContent = textoOrig;
      }
    });
  });

  // ---------- Icono del sitio ----------
  function pintarIcono(version) {
    const sufijo = version ? `?${encodeURIComponent(version)}` : '';
    document.getElementById('iconoPrevia').src = `/icons/icon-192.png${sufijo}`;
    document.getElementById('btnIconoQuitar').hidden = !version;
    // También actualizamos el icono de la pestaña actual
    const link = document.querySelector('link[rel="icon"]');
    if (link) {
      link.type = version ? 'image/png' : 'image/svg+xml';
      link.href = version ? `/favicon-32.png${sufijo}` : '/favicon.svg';
    }
  }

  document.getElementById('btnIconoSubir').addEventListener('click', () => document.getElementById('iconoArchivo').click());
  document.getElementById('iconoArchivo').addEventListener('change', async (e) => {
    const archivo = e.target.files[0];
    e.target.value = '';
    if (!archivo) return;
    const datos = new FormData();
    datos.append('icono', archivo);
    try {
      const nuevo = await apiFetch('/api/settings/icono', { method: 'POST', body: datos });
      state.ajustes = nuevo;
      pintarIcono(nuevo.tienda.icono);
      mostrarToast('Icono actualizado ✓');
    } catch (err) { mostrarToast(err.message); }
  });
  document.getElementById('btnIconoQuitar').addEventListener('click', async () => {
    try {
      const nuevo = await apiFetch('/api/settings/icono', { method: 'DELETE' });
      state.ajustes = nuevo;
      pintarIcono('');
      mostrarToast('Icono de fábrica restaurado.');
    } catch (err) { mostrarToast(err.message); }
  });

  // ---------- Horario ----------
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

  function renderHorario(horario) {
    const cont = document.getElementById('horarioLista');
    cont.innerHTML = '';
    ORDEN_DIAS.forEach((i) => {
      const d = horario.dias[i] || { abierto: false, desde: '09:00', hasta: '21:00' };
      const fila = document.createElement('div');
      fila.className = 'horario-fila' + (d.abierto ? '' : ' is-cerrado');
      fila.dataset.dia = i;
      fila.innerHTML = '<label class="dia"><input type="checkbox" class="h-abierto"><span></span></label>'
        + '<input type="time" class="h-desde" aria-label="Abre"><input type="time" class="h-hasta" aria-label="Cierra">';
      fila.querySelector('span').textContent = DIAS[i];
      const chk = fila.querySelector('.h-abierto');
      chk.checked = d.abierto;
      fila.querySelector('.h-desde').value = d.desde;
      fila.querySelector('.h-hasta').value = d.hasta;
      chk.addEventListener('change', () => fila.classList.toggle('is-cerrado', !chk.checked));
      cont.appendChild(fila);
    });
  }

  function leerHorario() {
    const dias = {};
    document.querySelectorAll('#horarioLista .horario-fila').forEach((f) => {
      dias[f.dataset.dia] = {
        abierto: f.querySelector('.h-abierto').checked,
        desde: f.querySelector('.h-desde').value || '09:00',
        hasta: f.querySelector('.h-hasta').value || '21:00',
      };
    });
    return dias;
  }

  // ---------- Métodos de pago ----------
  function renderPagos(pagos) {
    const cont = document.getElementById('pagosEdit');
    cont.innerHTML = '';
    pagos.forEach((m) => cont.appendChild(filaPago(m)));
  }

  function filaPago(m) {
    const div = document.createElement('div');
    div.className = 'pago-edit';
    div.dataset.id = m.id || '';
    div.innerHTML = '<input type="text" class="p-nombre" maxlength="50" placeholder="Nombre (ej: Transferencia)">'
      + '<textarea class="p-instr" rows="2" maxlength="300" placeholder="Instrucciones para el cliente (ej: número de tarjeta)"></textarea>'
      + '<div class="pago-edit__fila"><label class="switch-row" style="padding:0;flex:1"><span>Activo</span>'
      + '<span class="switch"><input type="checkbox" class="p-activo"><span class="switch__track"><span class="switch__thumb"></span></span></span></label>'
      + '<button type="button" class="btn--enlace btn--enlace-peligro p-borrar">Quitar</button></div>';
    div.querySelector('.p-nombre').value = m.nombre || '';
    div.querySelector('.p-instr').value = m.instrucciones || '';
    div.querySelector('.p-activo').checked = m.activo !== false;
    div.querySelector('.p-borrar').addEventListener('click', () => div.remove());
    return div;
  }

  function leerPagos() {
    return Array.from(document.querySelectorAll('#pagosEdit .pago-edit')).map((d) => ({
      id: d.dataset.id,
      nombre: d.querySelector('.p-nombre').value.trim(),
      instrucciones: d.querySelector('.p-instr').value.trim(),
      activo: d.querySelector('.p-activo').checked,
    }));
  }

  document.getElementById('btnAgregarPago').addEventListener('click', () => {
    const cont = document.getElementById('pagosEdit');
    if (cont.children.length >= 8) return mostrarToast('Máximo 8 métodos de pago.');
    const f = filaPago({ nombre: '', instrucciones: '', activo: true });
    cont.appendChild(f);
    f.querySelector('.p-nombre').focus();
  });

  // ---------- Temas ----------
  function tarjetaTema(t, actual, alElegir) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tema-opcion' + (t.id === actual ? ' is-activo' : '');
    b.dataset.id = t.id;
    const muestra = document.createElement('span');
    muestra.className = 'tema-opcion__muestra';
    t.colores.forEach((col) => {
      const x = document.createElement('span');
      x.style.background = col;
      muestra.appendChild(x);
    });
    const nombre = document.createElement('span');
    nombre.textContent = t.nombre;
    b.append(muestra, nombre);
    b.addEventListener('click', () => alElegir(t.id));
    return b;
  }

  function renderTemasAdmin(actual) {
    const grid = document.getElementById('temasAdmin');
    grid.innerHTML = '';
    window.Temas.lista.forEach((t) => grid.appendChild(tarjetaTema(t, actual, elegirTemaAdmin)));
  }

  async function elegirTemaAdmin(id) {
    const previo = state.yo.tema || 'auto';
    window.Temas.aplicar(id);
    renderTemasAdmin(id);
    try {
      await apiFetch('/api/me/tema', jsonOpts('PUT', { tema: id }));
      state.yo.tema = id;
      mostrarToast('Tema aplicado ✓');
    } catch (err) {
      window.Temas.aplicar(previo);
      renderTemasAdmin(previo);
      mostrarToast(err.message);
    }
  }

  function renderTemaDefecto(actual) {
    const sel = document.getElementById('temaDefectoSelect');
    sel.innerHTML = '';
    window.Temas.lista.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.nombre;
      sel.appendChild(o);
    });
    sel.value = actual;
  }

  // ---------- Telegram ----------
  function renderEventos(activos, etiquetas) {
    const cont = document.getElementById('eventosLista');
    cont.innerHTML = '';
    Object.keys(etiquetas).forEach((k) => {
      const fila = document.createElement('label');
      fila.className = 'switch-row';
      fila.innerHTML = '<span></span><span class="switch"><input type="checkbox"><span class="switch__track"><span class="switch__thumb"></span></span></span>';
      fila.querySelector('span').textContent = etiquetas[k];
      const chk = fila.querySelector('input');
      chk.dataset.evento = k;
      chk.checked = activos[k] !== false;
      cont.appendChild(fila);
    });
  }

  function leerEventos() {
    const out = {};
    document.querySelectorAll('#eventosLista input[data-evento]').forEach((c) => { out[c.dataset.evento] = c.checked; });
    return out;
  }

  async function cargarTelegram() {
    const cont = document.getElementById('telegramEstado');
    try {
      const t = await apiFetch('/api/settings/telegram');
      state.telegram = t;
      const partes = [];
      if (!t.configurado) {
        partes.push('Sin token: pega el token del bot y guarda.');
      } else if (!t.activo) {
        partes.push(`<span class="mal">● Bot desconectado</span>${t.error ? ' — ' + esc(t.error) : ''}`);
      } else {
        partes.push(`<span class="ok">● Bot conectado</span> (@${esc(t.bot)})`);
        if (t.enlace) partes.push(`<a href="${esc(t.enlace)}" target="_blank" rel="noopener">Abrir el bot y vincular</a> · código: <code>${esc(t.codigoVinculo)}</code>`);
      }
      if (t.chatIds.length) {
        partes.push('Chats vinculados: ' + t.chatIds.map((c) => `<code>${esc(c)}</code> <button type="button" class="btn--enlace btn--enlace-peligro" data-desv="${esc(c)}">quitar</button>`).join(' · '));
      } else if (t.configurado) {
        partes.push('Aún no hay chats vinculados.');
      }
      cont.innerHTML = partes.join('<br>');
      cont.querySelectorAll('[data-desv]').forEach((b) => b.addEventListener('click', () => desvincular(b.dataset.desv)));
    } catch (err) {
      cont.textContent = err.message;
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function desvincular(chatId) {
    try {
      await apiFetch('/api/settings/telegram/desvincular', jsonOpts('POST', { chatId }));
      mostrarToast('Chat desvinculado.');
      cargarTelegram();
    } catch (err) { mostrarToast(err.message); }
  }

  document.getElementById('btnTelegramPrueba').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await apiFetch('/api/settings/telegram/prueba', { method: 'POST' });
      mostrarToast('Mensaje de prueba enviado ✓');
    } catch (err) { mostrarToast(err.message); }
    b.disabled = false;
  });

  document.getElementById('btnTelegramCodigo').addEventListener('click', async () => {
    try {
      await apiFetch('/api/settings', jsonOpts('PUT', { telegram: { regenerarCodigo: true } }));
      mostrarToast('Nuevo código generado.');
      cargarTelegram();
    } catch (err) { mostrarToast(err.message); }
  });

  // ---------- Copias de seguridad ----------
  function renderFrecuencias(actual, idSelect) {
    const opciones = [[1, 'hora'], [3, '3 horas'], [6, '6 horas'], [12, '12 horas'], [24, 'día'], [48, '2 días'], [168, 'semana']];
    const sel = document.getElementById(idSelect || 'backupFrecuencia');
    sel.innerHTML = '';
    if (!opciones.some(([h]) => h === actual)) opciones.push([actual, `${actual} horas`]);
    opciones.forEach(([h, t]) => {
      const o = document.createElement('option');
      o.value = h;
      o.textContent = t;
      sel.appendChild(o);
    });
    sel.value = String(actual);
  }

  function pintarUltimoTelegram(iso) {
    document.getElementById('backupTgUltimo').textContent = iso ? `Último envío: ${formatearFecha(iso)}` : 'Todavía no se ha enviado ninguna copia por Telegram.';
  }

  document.getElementById('btnBackupTelegram').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    const txt = b.textContent;
    b.textContent = 'Enviando…';
    try {
      await apiFetch('/api/backups/telegram', { method: 'POST' });
      mostrarToast('Copia enviada a Telegram ✓');
      const a = await apiFetch('/api/settings');
      pintarUltimoTelegram(a.backup.telegramUltimo);
    } catch (err) { mostrarToast(err.message); }
    b.disabled = false;
    b.textContent = txt;
  });

  function formatearTamano(b) {
    if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(b / 1024)) + ' KB';
  }

  async function cargarBackups() {
    const cont = document.getElementById('backupsLista');
    try {
      const r = await apiFetch('/api/backups');
      cont.innerHTML = '';
      if (!r.copias.length) {
        cont.innerHTML = '<p class="cat-vacio">Todavía no hay copias.</p>';
        return;
      }
      r.copias.forEach((c) => {
        const fila = document.createElement('div');
        fila.className = 'backup-fila';
        const info = document.createElement('div');
        info.innerHTML = '<strong></strong><small></small>';
        info.querySelector('strong').textContent = formatearFecha(c.creadoEn);
        info.querySelector('small').textContent = `${c.manual ? 'Manual' : 'Automática'} · ${formatearTamano(c.tamano)}${c.imagenes ? ' · con fotos' : ''}`;
        const acc = document.createElement('div');
        const a = document.createElement('a');
        a.href = `/api/backups/${encodeURIComponent(c.nombre)}/descargar`;
        a.textContent = 'Descargar';
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn--enlace btn--enlace-peligro';
        del.textContent = 'Eliminar';
        del.addEventListener('click', () => abrirConfirmacion('¿Eliminar esta copia de seguridad?', async () => {
          try {
            await apiFetch(`/api/backups/${encodeURIComponent(c.nombre)}`, { method: 'DELETE' });
            cargarBackups();
          } catch (err) { mostrarToast(err.message); }
        }));
        acc.append(a, del);
        fila.append(info, acc);
        cont.appendChild(fila);
      });
    } catch (err) {
      cont.textContent = err.message;
    }
  }

  document.getElementById('btnBackupAhora').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = 'Creando…';
    try {
      await apiFetch('/api/backups', { method: 'POST' });
      mostrarToast('Copia creada ✓');
      cargarBackups();
    } catch (err) { mostrarToast(err.message); }
    b.disabled = false;
    b.textContent = '💾 Crear copia ahora';
  });

  // ---------- Contraseña del panel ----------
  document.getElementById('formClaveAdmin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('adminClaveError');
    const btn = document.getElementById('btnAdminClave');
    err.hidden = true;
    btn.disabled = true;
    try {
      await apiFetch('/api/password', jsonOpts('POST', {
        actual: document.getElementById('adminClaveActual').value,
        nueva: document.getElementById('adminClaveNueva').value,
      }));
      e.target.reset();
      mostrarToast('Contraseña cambiada ✓');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
    btn.disabled = false;
  });

  // ---------- Tipo de cambio ----------
  el.formTasa.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.tasaError.hidden = true;

    const tasaCup = parseFloat(el.campoTasa.value);
    if (Number.isNaN(tasaCup) || tasaCup <= 0) {
      el.tasaError.textContent = 'Ingresa un número mayor a 0.';
      el.tasaError.hidden = false;
      return;
    }

    el.btnGuardarTasa.disabled = true;
    el.btnGuardarTasa.textContent = 'Guardando…';

    try {
      const actualizado = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasaCup }),
      });
      el.campoTasa.value = actualizado.tasaCup;
      el.tasaActualizada.textContent = `Última actualización: ${formatearFecha(actualizado.actualizadoEn)}`;
      mostrarToast('Tasa de cambio actualizada.');
    } catch (err) {
      el.tasaError.textContent = err.message;
      el.tasaError.hidden = false;
    } finally {
      el.btnGuardarTasa.disabled = false;
      el.btnGuardarTasa.textContent = 'Guardar tasa';
    }
  });

  // ---------- Envío por municipio ----------
  function renderListaEnvios(enviosPorMunicipio) {
    el.enviosLista.innerHTML = '';
    MUNICIPIOS_HABANA.forEach((mun) => {
      const fila = document.createElement('label');
      fila.className = 'envio-fila';

      const nombre = document.createElement('span');
      nombre.className = 'envio-fila__nombre';
      nombre.textContent = mun.nombre;

      const campoPrecio = document.createElement('div');
      campoPrecio.className = 'campo-precio envio-fila__precio';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '0.01';
      input.inputMode = 'decimal';
      input.dataset.municipio = mun.id;
      input.value = Number(enviosPorMunicipio[mun.id]) || 0;
      const unidad = document.createElement('span');
      unidad.textContent = 'CUP';
      campoPrecio.append(input, unidad);

      fila.append(nombre, campoPrecio);
      el.enviosLista.appendChild(fila);
    });
  }

  el.formEnvios.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.enviosError.hidden = true;

    const enviosPorMunicipio = {};
    let huboInvalido = false;
    el.enviosLista.querySelectorAll('input[data-municipio]').forEach((input) => {
      const valor = parseFloat(input.value);
      if (Number.isNaN(valor) || valor < 0) huboInvalido = true;
      enviosPorMunicipio[input.dataset.municipio] = Number.isNaN(valor) ? 0 : valor;
    });

    if (huboInvalido) {
      el.enviosError.textContent = 'Todos los envíos deben ser números mayores o iguales a 0.';
      el.enviosError.hidden = false;
      return;
    }

    el.btnGuardarEnvios.disabled = true;
    el.btnGuardarEnvios.textContent = 'Guardando…';

    try {
      const actualizado = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enviosPorMunicipio }),
      });
      renderListaEnvios(actualizado.enviosPorMunicipio || {});
      mostrarToast('Envíos actualizados.');
    } catch (err) {
      el.enviosError.textContent = err.message;
      el.enviosError.hidden = false;
    } finally {
      el.btnGuardarEnvios.disabled = false;
      el.btnGuardarEnvios.textContent = 'Guardar envíos';
    }
  });

  // ---------- Diálogo de confirmación (reutilizable) ----------
  function abrirConfirmacion(mensaje, callback) {
    state.confirmCallback = callback;
    el.confirmTexto.textContent = mensaje;
    el.overlayConfirm.hidden = false;
    el.confirmEliminar.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.confirmEliminar.classList.add('is-abierto'));
  }

  function cerrarConfirmacion() {
    el.confirmEliminar.classList.remove('is-abierto');
    el.confirmEliminar.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayConfirm.hidden = true; }, 180);
    state.confirmCallback = null;
  }

  el.btnConfirmCancelar.addEventListener('click', cerrarConfirmacion);
  el.overlayConfirm.addEventListener('click', cerrarConfirmacion);

  el.btnConfirmEliminar.addEventListener('click', async () => {
    const callback = state.confirmCallback;
    cerrarConfirmacion();
    if (callback) await callback();
  });

  // ---------- Gestión de categorías ----------
  function renderListaCategorias() {
    el.catLista.innerHTML = '';

    if (state.categorias.length === 0) {
      const vacio = document.createElement('p');
      vacio.className = 'cat-vacio';
      vacio.textContent = 'Todavía no hay categorías.';
      el.catLista.appendChild(vacio);
      return;
    }

    state.categorias.forEach((cat) => {
      const fila = document.createElement('div');
      fila.className = 'cat-fila';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'cat-fila__input';
      input.maxLength = 40;
      input.value = cat.nombre;

      const btnGuardar = document.createElement('button');
      btnGuardar.type = 'button';
      btnGuardar.className = 'btn--enlace';
      btnGuardar.textContent = 'Guardar';
      btnGuardar.addEventListener('click', () => renombrarCategoria(cat.id, input.value));

      const btnBorrar = document.createElement('button');
      btnBorrar.type = 'button';
      btnBorrar.className = 'btn--enlace btn--enlace-peligro';
      btnBorrar.textContent = 'Eliminar';
      btnBorrar.addEventListener('click', () => {
        const enUso = state.productos.filter((p) => p.categoria === cat.id).length;
        const advertencia = enUso > 0 ? ` Se usa en ${enUso} ${enUso === 1 ? 'plato' : 'platos'} y no podrá eliminarse hasta reasignarlos.` : '';
        abrirConfirmacion(`¿Eliminar la categoría "${cat.nombre}"?${advertencia}`, () => eliminarCategoria(cat.id));
      });

      fila.append(input, btnGuardar, btnBorrar);
      el.catLista.appendChild(fila);
    });
  }

  async function renombrarCategoria(id, nombreNuevo) {
    el.categoriaError.hidden = true;
    const nombre = nombreNuevo.trim();
    if (!nombre) {
      el.categoriaError.textContent = 'El nombre no puede estar vacío.';
      el.categoriaError.hidden = false;
      return;
    }
    try {
      const actualizada = await apiFetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      const idx = state.categorias.findIndex((c) => c.id === id);
      state.categorias[idx] = actualizada;
      mostrarToast('Categoría actualizada.');
    } catch (err) {
      el.categoriaError.textContent = err.message;
      el.categoriaError.hidden = false;
    }
  }

  async function eliminarCategoria(id) {
    try {
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
      state.categorias = state.categorias.filter((c) => c.id !== id);
      renderListaCategorias();
      mostrarToast('Categoría eliminada.');
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  el.formCategoriaNueva.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.categoriaError.hidden = true;
    const nombre = el.campoCategoriaNueva.value.trim();
    if (!nombre) return;

    try {
      const creada = await apiFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre }),
      });
      state.categorias.push(creada);
      el.campoCategoriaNueva.value = '';
      renderListaCategorias();
      mostrarToast('Categoría agregada.');
    } catch (err) {
      el.categoriaError.textContent = err.message;
      el.categoriaError.hidden = false;
    }
  });

  // ---------- Inicio ----------
  cargarDatos();
  // Insignia de "Pedidos nuevos" + alertas persistentes de pedido nuevo o
  // cambio de estado — ver monitorPedidos.js, compartido con admin.html y
  // pedidos.html.
  MonitorPedidos.iniciar();
})();
