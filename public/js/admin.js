// Логика панели администратора товаров.
// Чистый JS без фреймворков, работа с REST API сервера.

(() => {
  'use strict';

  // ---------- Состояние приложения ----------
  const state = {
    productos: [],
    categorias: [],
    tasaCup: null, // сколько CUP за 1 USD — только для справочного показа, редактируется в /ajustes
    categoriaActiva: 'todos',
    busqueda: '',
    filtroEstado: 'todos', // todos | disponibles | ocultos | agotados | poco
    umbralStock: 5,
    confirmCallback: null,
    subiendoImagen: false,
  };

  // ---------- Ссылки на DOM-элементы ----------
  const el = {
    lista: document.getElementById('lista'),
    estadoVacio: document.getElementById('estadoVacio'),
    conteo: document.getElementById('conteoPlatos'),
    chips: document.getElementById('chipsCategorias'),
    chipsEstado: document.getElementById('chipsEstadoPlato'),
    campoStock: document.getElementById('campoStock'),
    campoReponer: document.getElementById('campoReponer'),

    btnBuscar: document.getElementById('btnBuscar'),
    searchbar: document.getElementById('searchbar'),
    inputBuscar: document.getElementById('inputBuscar'),
    btnSalir: document.getElementById('btnSalir'),
    pedidosBadge: document.getElementById('pedidosBadge'),

    btnNuevo: document.getElementById('btnNuevo'),
    overlay: document.getElementById('overlay'),
    sheet: document.getElementById('sheetForm'),
    sheetTitulo: document.getElementById('sheetTitulo'),
    btnCerrarSheet: document.getElementById('btnCerrarSheet'),
    btnCancelar: document.getElementById('btnCancelar'),

    form: document.getElementById('formPlato'),
    platoId: document.getElementById('platoId'),
    campoNombre: document.getElementById('campoNombre'),
    campoDescripcion: document.getElementById('campoDescripcion'),
    campoPrecio: document.getElementById('campoPrecio'),
    precioUsdPreview: document.getElementById('precioUsdPreview'),
    campoPesoValor: document.getElementById('campoPesoValor'),
    campoPesoUnidad: document.getElementById('campoPesoUnidad'),
    campoMaximoPedido: document.getElementById('campoMaximoPedido'),
    campoCategoria: document.getElementById('campoCategoria'),
    campoDisponible: document.getElementById('campoDisponible'),
    formError: document.getElementById('formError'),
    btnGuardar: document.getElementById('btnGuardar'),

    campoImagenArchivo: document.getElementById('campoImagenArchivo'),
    campoImagenUrl: document.getElementById('campoImagenUrl'),
    imagenPreview: document.getElementById('imagenPreview'),
    imagenEstado: document.getElementById('imagenEstado'),
    btnQuitarImagen: document.getElementById('btnQuitarImagen'),

    overlayConfirm: document.getElementById('overlayConfirm'),
    confirmEliminar: document.getElementById('confirmEliminar'),
    confirmTexto: document.getElementById('confirmTexto'),
    btnConfirmCancelar: document.getElementById('btnConfirmCancelar'),
    btnConfirmEliminar: document.getElementById('btnConfirmEliminar'),

    toast: document.getElementById('toast'),
  };

  // Цвета для аватара-заглушки, когда у блюда нет картинки
  const COLORES_AVATAR = ['#F2318C', '#2FD8E0', '#FFC93C', '#9B5DE0', '#A8FF3E'];

  function colorParaNombre(nombre) {
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
    return COLORES_AVATAR[Math.abs(hash) % COLORES_AVATAR.length];
  }

  // ---------- Formato de precios (CUP con referencia en USD) ----------
  function formatearCup(precio) {
    return Number.isInteger(precio) ? String(precio) : precio.toFixed(2);
  }

  function formatearUsdReferencia(precioCup) {
    if (!state.tasaCup) return '';
    // Siempre redondeado hacia arriba: el equivalente en USD es un número entero
    // y es el precio final que se muestra (sin signo de "aproximado").
    const usd = Math.ceil(precioCup / state.tasaCup);
    return `$${usd} USD`;
  }

  function formatearPorcion(porcion) {
    if (!porcion) return '';
    return `${formatearCup(porcion.valor)} ${porcion.unidad}`;
  }

  // ---------- Utilidades de red ----------
  async function apiFetch(url, options) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (_) {
      throw new Error('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
    }

    // Sesión vencida o no iniciada: mandamos al login
    if (res.status === 401) {
      window.location.href = '/?acceso=1';
      throw new Error('Sesión expirada.');
    }

    if (!res.ok) {
      let mensaje = 'Ocurrió un error inesperado.';
      try {
        const data = await res.json();
        if (data.error) mensaje = data.error;
      } catch (_) { /* respuesta sin cuerpo JSON, p. ej. 204 */ }
      throw new Error(mensaje);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  function mostrarToast(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('is-visible');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(() => el.toast.classList.remove('is-visible'), 2200);
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
      state.tasaCup = ajustes.tasaCup;
      state.umbralStock = ajustes.pedidos.stockBajoUmbral;
      if (window.Temas) window.Temas.aplicar(yo.tema);
      renderChips();
      renderLista();
      poblarSelectCategorias();
    } catch (err) {
      el.conteo.textContent = 'No se pudieron cargar los datos.';
      mostrarToast(err.message);
    }
  }

  // ---------- Render: chips de categoría ----------
  function renderChips() {
    // Quitamos todo salvo el botón "Todos" y reconstruimos según el estado actual
    el.chips.querySelectorAll('.chip').forEach((c) => {
      if (c.dataset.categoria !== 'todos') c.remove();
    });

    state.categorias.forEach((cat) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.dataset.categoria = cat.id;
      chip.textContent = cat.nombre;
      el.chips.appendChild(chip);
    });

    // Si la categoría activa ya no existe (se eliminó), volvemos a "Todos"
    if (state.categoriaActiva !== 'todos' && !state.categorias.some((c) => c.id === state.categoriaActiva)) {
      state.categoriaActiva = 'todos';
    }
    el.chips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', c.dataset.categoria === state.categoriaActiva);
    });
  }

  function poblarSelectCategorias() {
    const seleccionActual = el.campoCategoria.value;
    el.campoCategoria.innerHTML = state.categorias
      .map((cat) => `<option value="${cat.id}">${cat.nombre}</option>`)
      .join('');
    if (state.categorias.some((c) => c.id === seleccionActual)) {
      el.campoCategoria.value = seleccionActual;
    }
  }

  function nombreCategoria(id) {
    const cat = state.categorias.find((c) => c.id === id);
    return cat ? cat.nombre : id;
  }

  // ---------- Render: lista de productos ----------
  function productosFiltrados() {
    return state.productos.filter((p) => {
      const coincideCategoria = state.categoriaActiva === 'todos' || p.categoria === state.categoriaActiva;
      const coincideBusqueda = p.nombre.toLowerCase().includes(state.busqueda.toLowerCase());
      return coincideCategoria && coincideBusqueda && coincideEstado(p);
    });
  }

  function tieneStock(p) { return p.stock !== null && p.stock !== undefined; }

  function coincideEstado(p) {
    switch (state.filtroEstado) {
      case 'disponibles': return p.disponible && !(tieneStock(p) && p.stock <= 0);
      case 'ocultos': return !p.disponible;
      case 'agotados': return tieneStock(p) && p.stock <= 0;
      case 'poco': return tieneStock(p) && p.stock > 0 && p.stock <= state.umbralStock;
      default: return true;
    }
  }

  function actualizarContadoresFiltro() {
    const cuenta = {
      todos: state.productos.length,
      disponibles: state.productos.filter((p) => p.disponible && !(tieneStock(p) && p.stock <= 0)).length,
      ocultos: state.productos.filter((p) => !p.disponible).length,
      agotados: state.productos.filter((p) => tieneStock(p) && p.stock <= 0).length,
      poco: state.productos.filter((p) => tieneStock(p) && p.stock > 0 && p.stock <= state.umbralStock).length,
    };
    el.chipsEstado.querySelectorAll('.chip').forEach((c) => {
      const base = c.dataset.base || c.textContent;
      c.dataset.base = base;
      const n = cuenta[c.dataset.filtro];
      c.textContent = c.dataset.filtro === 'todos' || !n ? base : `${base} (${n})`;
      c.classList.toggle('is-active', c.dataset.filtro === state.filtroEstado);
    });
  }

  el.chipsEstado.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.filtroEstado = chip.dataset.filtro;
    renderLista();
  });

  function renderLista() {
    const productos = productosFiltrados();
    el.lista.innerHTML = '';

    el.conteo.textContent = `${state.productos.length} ${state.productos.length === 1 ? 'plato' : 'platos'} en el menú`;
    actualizarContadoresFiltro();

    if (productos.length === 0) {
      el.estadoVacio.hidden = false;
      el.estadoVacio.querySelector('h2').textContent =
        state.productos.length === 0 ? 'Aún no hay platos aquí' : 'No hay platos que coincidan';
      el.estadoVacio.querySelector('p').textContent =
        state.productos.length === 0
          ? 'Agrega el primero y aparecerá en la lista al instante.'
          : 'Prueba con otra categoría o término de búsqueda.';
      return;
    }
    el.estadoVacio.hidden = true;

    productos.forEach((p) => el.lista.appendChild(crearTarjeta(p)));
  }

  function crearAvatar(p) {
    const avatar = document.createElement('div');
    avatar.className = 'tarjeta__avatar';
    avatar.style.background = colorParaNombre(p.nombre);
    avatar.textContent = p.nombre.charAt(0).toUpperCase();
    return avatar;
  }

  function crearTarjeta(p) {
    const tarjeta = document.createElement('article');
    tarjeta.className = `tarjeta ${p.disponible ? '' : 'is-agotado'}`;

    // Медиа: картинка (clicable, abre en pestaña nueva), o un avatar de color si no hay
    if (p.imagen) {
      const link = document.createElement('a');
      link.className = 'tarjeta__imagen-link';
      link.href = p.imagen;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const img = document.createElement('img');
      img.className = 'tarjeta__imagen';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = p.imagen;
      img.alt = p.nombre;
      img.addEventListener('error', () => link.replaceWith(crearAvatar(p)), { once: true });

      link.appendChild(img);
      tarjeta.appendChild(link);
    } else {
      tarjeta.appendChild(crearAvatar(p));
    }

    const info = document.createElement('div');
    info.className = 'tarjeta__info';

    const nombre = document.createElement('p');
    nombre.className = 'tarjeta__nombre';
    nombre.textContent = p.nombre;

    const meta = document.createElement('div');
    meta.className = 'tarjeta__meta';
    const precio = document.createElement('span');
    precio.className = 'tarjeta__precio';
    precio.textContent = `${formatearCup(p.precio)} CUP`;
    const categoria = document.createElement('span');
    categoria.textContent = `· ${nombreCategoria(p.categoria)}`;
    meta.append(precio, categoria);
    const porcionTexto = formatearPorcion(p.porcion);
    if (porcionTexto) {
      const porcion = document.createElement('span');
      porcion.textContent = `· ${porcionTexto}`;
      meta.appendChild(porcion);
    }

    const filaSecundaria = document.createElement('div');
    filaSecundaria.className = 'tarjeta__meta tarjeta__meta--secundaria';
    const usdRef = formatearUsdReferencia(p.precio);
    if (usdRef) {
      const usd = document.createElement('span');
      usd.textContent = usdRef;
      filaSecundaria.appendChild(usd);
    }
    if (p.maximoPorPedido) {
      const maximo = document.createElement('span');
      maximo.textContent = `Máx. ${p.maximoPorPedido}/pedido`;
      filaSecundaria.appendChild(maximo);
    }

    const estado = document.createElement('span');
    estado.className = `tarjeta__estado ${p.disponible ? 'tarjeta__estado--activo' : 'tarjeta__estado--agotado'}`;
    estado.textContent = p.disponible ? 'Disponible' : 'Oculto';
    filaSecundaria.appendChild(estado);

    // Stock (existencias): botón que permite ajustarlo rápido
    const btnStock = document.createElement('button');
    btnStock.type = 'button';
    btnStock.className = 'etiqueta-stock etiqueta-stock--btn';
    if (tieneStock(p)) {
      if (p.stock <= 0) { btnStock.classList.add('etiqueta-stock--agotado'); btnStock.textContent = '📦 Agotado'; }
      else if (p.stock <= state.umbralStock) { btnStock.classList.add('etiqueta-stock--poco'); btnStock.textContent = `📦 Quedan ${p.stock}`; }
      else btnStock.textContent = `📦 ${p.stock}`;
      if (p.reponerDiario !== null && p.reponerDiario !== undefined) btnStock.textContent += ` · ↻${p.reponerDiario}/día`;
    } else {
      btnStock.textContent = '📦 Sin límite';
    }
    btnStock.title = 'Cambiar el stock';
    btnStock.addEventListener('click', () => ajustarStockRapido(p));
    filaSecundaria.appendChild(btnStock);

    info.append(nombre, meta, filaSecundaria);

    const acciones = document.createElement('div');
    acciones.className = 'tarjeta__acciones';
    const btnEditar = document.createElement('button');
    btnEditar.className = 'tarjeta__btn tarjeta__btn--editar';
    btnEditar.textContent = 'Editar';
    btnEditar.addEventListener('click', () => abrirFormulario(p));
    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'tarjeta__btn tarjeta__btn--borrar';
    btnBorrar.textContent = 'Eliminar';
    btnBorrar.addEventListener('click', () => {
      abrirConfirmacion(`"${p.nombre}" se quitará del menú de forma permanente.`, () => eliminarProducto(p.id));
    });
    const btnVisible = document.createElement('button');
    btnVisible.className = 'tarjeta__btn';
    btnVisible.textContent = p.disponible ? 'Ocultar' : 'Mostrar';
    btnVisible.addEventListener('click', () => alternarDisponible(p));
    acciones.append(btnEditar, btnVisible, btnBorrar);

    tarjeta.append(info, acciones);
    return tarjeta;
  }

  async function alternarDisponible(p) {
    try {
      const actualizado = await apiFetch(`/api/products/${p.id}/disponible`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disponible: !p.disponible }),
      });
      const idx = state.productos.findIndex((x) => x.id === p.id);
      if (idx !== -1) state.productos[idx] = actualizado;
      renderLista();
      mostrarToast(actualizado.disponible ? 'Plato visible en la tienda.' : 'Plato oculto de la tienda.');
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  // Ajuste rápido de stock con un cuadro de diálogo del navegador.
  async function ajustarStockRapido(p) {
    const actual = tieneStock(p) ? String(p.stock) : '';
    const r = window.prompt(`Stock de "${p.nombre}" (cuántas porciones quedan).\nDeja vacío para quitar el límite:`, actual);
    if (r === null) return;
    try {
      const actualizado = await apiFetch(`/api/products/${p.id}/stock`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock: r.trim() }),
      });
      const idx = state.productos.findIndex((x) => x.id === p.id);
      if (idx !== -1) state.productos[idx] = actualizado;
      renderLista();
      mostrarToast('Stock actualizado.');
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  // ---------- Filtro por categoría ----------
  el.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.categoriaActiva = chip.dataset.categoria;
    renderLista();
  });

  // ---------- Búsqueda ----------
  el.btnBuscar.addEventListener('click', () => {
    const abierta = !el.searchbar.hidden;
    el.searchbar.hidden = abierta;
    el.btnBuscar.setAttribute('aria-expanded', String(!abierta));
    if (!abierta) el.inputBuscar.focus();
    else {
      el.inputBuscar.value = '';
      state.busqueda = '';
      renderLista();
    }
  });

  el.inputBuscar.addEventListener('input', (e) => {
    state.busqueda = e.target.value;
    renderLista();
  });

  // ---------- Sheet de producto: abrir / cerrar ----------
  function resetImagen() {
    el.campoImagenArchivo.value = '';
    el.campoImagenUrl.value = '';
    el.imagenPreview.hidden = true;
    el.imagenPreview.src = '';
    el.btnQuitarImagen.hidden = true;
    el.imagenEstado.hidden = true;
  }

  function actualizarPrecioUsdPreview() {
    const precio = parseFloat(el.campoPrecio.value);
    if (Number.isNaN(precio) || !state.tasaCup) {
      el.precioUsdPreview.textContent = '';
      return;
    }
    el.precioUsdPreview.textContent = formatearUsdReferencia(precio);
  }

  el.campoPrecio.addEventListener('input', actualizarPrecioUsdPreview);

  function abrirFormulario(producto) {
    el.form.reset();
    el.formError.hidden = true;
    resetImagen();

    if (producto) {
      el.sheetTitulo.textContent = 'Editar plato';
      el.platoId.value = producto.id;
      el.campoNombre.value = producto.nombre;
      el.campoDescripcion.value = producto.descripcion || '';
      el.campoPrecio.value = producto.precio;
      el.campoCategoria.value = producto.categoria;
      el.campoDisponible.checked = producto.disponible;

      if (producto.porcion) {
        el.campoPesoValor.value = producto.porcion.valor;
        el.campoPesoUnidad.value = producto.porcion.unidad;
      } else {
        el.campoPesoValor.value = '';
        el.campoPesoUnidad.value = 'g';
      }
      el.campoMaximoPedido.value = producto.maximoPorPedido || '';
      el.campoStock.value = tieneStock(producto) ? producto.stock : '';
      el.campoReponer.value = producto.reponerDiario !== null && producto.reponerDiario !== undefined ? producto.reponerDiario : '';

      if (producto.imagen) {
        el.campoImagenUrl.value = producto.imagen;
        el.imagenPreview.src = producto.imagen;
        el.imagenPreview.hidden = false;
        el.btnQuitarImagen.hidden = false;
      }
    } else {
      el.sheetTitulo.textContent = 'Nuevo plato';
      el.platoId.value = '';
      el.campoDisponible.checked = true;
    }

    actualizarPrecioUsdPreview();

    el.overlay.hidden = false;
    el.sheet.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheet.classList.add('is-abierto'));
  }

  function cerrarFormulario() {
    el.sheet.classList.remove('is-abierto');
    el.sheet.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlay.hidden = true; }, 200);
  }

  el.btnNuevo.addEventListener('click', () => abrirFormulario(null));
  el.btnCerrarSheet.addEventListener('click', cerrarFormulario);
  el.btnCancelar.addEventListener('click', cerrarFormulario);
  el.overlay.addEventListener('click', cerrarFormulario);

  // ---------- Subida de imagen ----------
  el.campoImagenArchivo.addEventListener('change', async () => {
    const file = el.campoImagenArchivo.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      mostrarToast('La imagen no puede pesar más de 5 MB.');
      el.campoImagenArchivo.value = '';
      return;
    }

    // Vista previa inmediata desde el archivo local, mientras se sube
    const previaLocal = URL.createObjectURL(file);
    el.imagenPreview.src = previaLocal;
    el.imagenPreview.hidden = false;
    el.imagenEstado.textContent = 'Subiendo imagen…';
    el.imagenEstado.hidden = false;

    state.subiendoImagen = true;
    el.btnGuardar.disabled = true;

    try {
      const datosForm = new FormData();
      datosForm.append('imagen', file);
      const res = await fetch('/api/upload', { method: 'POST', body: datosForm });

      if (res.status === 401) {
        window.location.href = '/?acceso=1';
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'No se pudo subir la imagen.');
      }

      const data = await res.json();
      el.campoImagenUrl.value = data.url;
      el.imagenPreview.src = data.url;
      el.btnQuitarImagen.hidden = false;
      el.imagenEstado.hidden = true;
    } catch (err) {
      mostrarToast(err.message);
      resetImagen();
    } finally {
      URL.revokeObjectURL(previaLocal);
      state.subiendoImagen = false;
      el.btnGuardar.disabled = false;
    }
  });

  el.btnQuitarImagen.addEventListener('click', resetImagen);

  // ---------- Guardar (crear / actualizar) ----------
  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.formError.hidden = true;

    if (state.subiendoImagen) {
      el.formError.textContent = 'Espera a que la imagen termine de subirse.';
      el.formError.hidden = false;
      return;
    }

    const payload = {
      nombre: el.campoNombre.value.trim(),
      descripcion: el.campoDescripcion.value.trim(),
      precio: parseFloat(el.campoPrecio.value),
      categoria: el.campoCategoria.value,
      imagen: el.campoImagenUrl.value,
      disponible: el.campoDisponible.checked,
      pesoValor: el.campoPesoValor.value,
      pesoUnidad: el.campoPesoUnidad.value,
      maximoPorPedido: el.campoMaximoPedido.value,
      stock: el.campoStock.value,
      reponerDiario: el.campoReponer.value,
    };

    const id = el.platoId.value;
    el.btnGuardar.disabled = true;
    el.btnGuardar.textContent = 'Guardando…';

    try {
      if (id) {
        const actualizado = await apiFetch(`/api/products/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const idx = state.productos.findIndex((p) => p.id === id);
        state.productos[idx] = actualizado;
        mostrarToast('Plato actualizado.');
      } else {
        const creado = await apiFetch('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        state.productos.unshift(creado);
        mostrarToast('Plato agregado al menú.');
      }
      renderLista();
      cerrarFormulario();
    } catch (err) {
      el.formError.textContent = err.message;
      el.formError.hidden = false;
    } finally {
      el.btnGuardar.disabled = false;
      el.btnGuardar.textContent = 'Guardar plato';
    }
  });

  async function eliminarProducto(id) {
    try {
      await apiFetch(`/api/products/${id}`, { method: 'DELETE' });
      state.productos = state.productos.filter((p) => p.id !== id);
      renderLista();
      mostrarToast('Plato eliminado.');
    } catch (err) {
      mostrarToast(err.message);
    }
  }

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

  // ---------- Inicio ----------
  cargarDatos();
  // Insignia de "Pedidos nuevos" + alertas persistentes de pedido nuevo o
  // cambio de estado (por ejemplo, si el cliente cancela el suyo) — ver
  // monitorPedidos.js, compartido con pedidos.html y ajustes.html.
  MonitorPedidos.iniciar();
})();
