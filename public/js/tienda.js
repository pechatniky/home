// Logica de la tienda publica: catalogo, carrito (guardado en localStorage
// del navegador del cliente) y envio del pedido. Hacer un pedido requiere
// tener una cuenta de cliente con sesion iniciada (ya no se admiten pedidos
// de invitado) — el catalogo en si sigue siendo visible para cualquiera.

(() => {
  'use strict';

  const CARRITO_KEY = 'pechatniky_carrito';

  const state = {
    categorias: [],
    productos: [],
    tasaCup: null,
    enviosPorMunicipio: {}, // { [municipioId]: costoCup } — costo de envío configurado por el admin
    categoriaActiva: 'todos',
    busqueda: '', // texto del buscador de platos (nombre y descripción)
    carrito: {}, // { [productoId]: cantidad }
    cuenta: null, // { id, nombre, email, telefono, direccion } | null — cuenta opcional del cliente
    ubicacionSeleccionada: null, // { lat, lng } | null — punto marcado en el mapa, obligatorio para pedir
    config: null, // ajustes públicos: tienda, contactos, horario/estado, pagos, mínimo…
    menuCargado: false,
    desdeCache: false, // el menú mostrado viene de la copia guardada (sin conexión)
    pagoSeleccionado: null,
    claveEnvio: null, // clave de idempotencia del intento de pedido en curso
    enviando: false,
    ultimosPedidos: [], // última lista de "mis pedidos" (para "Pedir de nuevo")
  };

  // Municipios de La Habana — debe coincidir con MUNICIPIOS_HABANA en
  // src/config.js (no hay build step que comparta este archivo entre
  // servidor y navegador, así que se repite acá a mano, igual que ya se hace
  // con los límites del mapa de La Habana más abajo).
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
    lista: document.getElementById('lista'),
    estadoVacio: document.getElementById('estadoVacio'),
    menuSubtitulo: document.getElementById('menuSubtitulo'),
    chips: document.getElementById('chipsCategorias'),
    buscadorPlatos: document.getElementById('buscadorPlatos'),

    btnCarrito: document.getElementById('btnCarrito'),
    carritoBadge: document.getElementById('carritoBadge'),

    overlay: document.getElementById('overlay'),
    sheetCarrito: document.getElementById('sheetCarrito'),
    btnCerrarCarrito: document.getElementById('btnCerrarCarrito'),

    carritoLista: document.getElementById('carritoLista'),
    carritoVacioMsg: document.getElementById('carritoVacioMsg'),
    carritoTotal: document.getElementById('carritoTotal'),
    carritoSubtotalValor: document.getElementById('carritoSubtotalValor'),
    carritoEnvioValor: document.getElementById('carritoEnvioValor'),
    carritoEnvioMunicipio: document.getElementById('carritoEnvioMunicipio'),
    carritoTotalValor: document.getElementById('carritoTotalValor'),

    formPedido: document.getElementById('formPedido'),
    campoNombre: document.getElementById('campoNombre'),
    campoTelefono: document.getElementById('campoTelefono'),
    campoMunicipio: document.getElementById('campoMunicipio'),
    campoDireccion: document.getElementById('campoDireccion'),
    campoNota: document.getElementById('campoNota'),
    formError: document.getElementById('formError'),
    btnConfirmarPedido: document.getElementById('btnConfirmarPedido'),

    btnElegirUbicacion: document.getElementById('btnElegirUbicacion'),
    ubicacionEstado: document.getElementById('ubicacionEstado'),
    overlayMapa: document.getElementById('overlayMapa'),
    sheetMapa: document.getElementById('sheetMapa'),
    btnCerrarMapa: document.getElementById('btnCerrarMapa'),
    btnQuitarUbicacion: document.getElementById('btnQuitarUbicacion'),
    btnConfirmarUbicacion: document.getElementById('btnConfirmarUbicacion'),
    btnMiUbicacion: document.getElementById('btnMiUbicacion'),
    mapaPedido: document.getElementById('mapaPedido'),

    overlayProducto: document.getElementById('overlayProducto'),
    sheetProducto: document.getElementById('sheetProducto'),
    btnCerrarProducto: document.getElementById('btnCerrarProducto'),
    productoDetalleNombre: document.getElementById('productoDetalleNombre'),
    productoDetalleImagen: document.getElementById('productoDetalleImagen'),
    productoDetalleMeta: document.getElementById('productoDetalleMeta'),
    productoDetalleDescripcion: document.getElementById('productoDetalleDescripcion'),
    productoDetalleAcciones: document.getElementById('productoDetalleAcciones'),

    btnPedidosCliente: document.getElementById('btnPedidosCliente'),
    pedidosClienteBadge: document.getElementById('pedidosClienteBadge'),
    overlayPedidosCliente: document.getElementById('overlayPedidosCliente'),
    sheetPedidosCliente: document.getElementById('sheetPedidosCliente'),
    btnCerrarPedidosCliente: document.getElementById('btnCerrarPedidosCliente'),

    btnCuenta: document.getElementById('btnCuenta'),
    overlayCuenta: document.getElementById('overlayCuenta'),
    sheetCuenta: document.getElementById('sheetCuenta'),
    btnCerrarCuenta: document.getElementById('btnCerrarCuenta'),

    cuentaInvitado: document.getElementById('cuentaInvitado'),
    tabLogin: document.getElementById('tabLogin'),
    tabRegistro: document.getElementById('tabRegistro'),
    formLoginCliente: document.getElementById('formLoginCliente'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginClienteError: document.getElementById('loginClienteError'),
    btnLoginCliente: document.getElementById('btnLoginCliente'),
    formRegistroCliente: document.getElementById('formRegistroCliente'),
    registroNombre: document.getElementById('registroNombre'),
    registroEmail: document.getElementById('registroEmail'),
    registroTelefono: document.getElementById('registroTelefono'),
    registroPassword: document.getElementById('registroPassword'),
    registroDireccion: document.getElementById('registroDireccion'),
    registroClienteError: document.getElementById('registroClienteError'),
    btnRegistroCliente: document.getElementById('btnRegistroCliente'),

    cuentaSesion: document.getElementById('cuentaSesion'),
    cuentaNombre: document.getElementById('cuentaNombre'),
    misPedidosLista: document.getElementById('misPedidosLista'),
    misPedidosVacio: document.getElementById('misPedidosVacio'),

    formPerfilCliente: document.getElementById('formPerfilCliente'),
    perfilNombre: document.getElementById('perfilNombre'),
    perfilEmail: document.getElementById('perfilEmail'),
    perfilTelefono: document.getElementById('perfilTelefono'),
    perfilDireccion: document.getElementById('perfilDireccion'),
    perfilError: document.getElementById('perfilError'),
    btnGuardarPerfil: document.getElementById('btnGuardarPerfil'),

    btnCerrarSesionCliente: document.getElementById('btnCerrarSesionCliente'),

    toast: document.getElementById('toast'),

    tiendaEmoji: document.getElementById('tiendaEmoji'),
    tiendaNombre: document.getElementById('tiendaNombre'),
    contactosBar: document.getElementById('contactosBar'),
    estadoTienda: document.getElementById('estadoTienda'),
    anuncio: document.getElementById('anuncio'),
    bannerRed: document.getElementById('bannerRed'),
    bannerRedTexto: document.getElementById('bannerRedTexto'),
    btnReintentar: document.getElementById('btnReintentar'),
    footerContacto: document.getElementById('footerContacto'),
    instalarWrap: document.getElementById('instalarWrap'),
    btnInstalar: document.getElementById('btnInstalar'),

    avisosCarrito: document.getElementById('avisosCarrito'),
    pagosLista: document.getElementById('pagosLista'),
    campoPagoWrap: document.getElementById('campoPagoWrap'),
    tiempoEstimado: document.getElementById('tiempoEstimado'),

    overlayConfirmacion: document.getElementById('overlayConfirmacion'),
    sheetConfirmacion: document.getElementById('sheetConfirmacion'),
    confirmacionContenido: document.getElementById('confirmacionContenido'),

    temasGrid: document.getElementById('temasGrid'),
    formClaveCliente: document.getElementById('formClaveCliente'),
    claveActual: document.getElementById('claveActual'),
    claveNueva: document.getElementById('claveNueva'),
    claveError: document.getElementById('claveError'),
    btnCambiarClave: document.getElementById('btnCambiarClave'),
  };

  const ESTADOS_PEDIDO = {
    nuevo: 'Nuevo',
    en_preparacion: 'En preparación',
    enviado: 'Enviado',
    completado: 'Completado',
    cancelado: 'Cancelado',
  };

  // Solo se puede cancelar un pedido mientras sigue en este estado (debe
  // coincidir con ESTADO_CANCELABLE_DESDE del servidor).
  const ESTADO_CANCELABLE = 'nuevo';

  // Estados que cuentan como "abiertos" (todavía no entregados) para la
  // insignia del ícono "Mis pedidos".
  const ESTADOS_ABIERTOS = ['nuevo', 'en_preparacion', 'enviado'];

  // Últimos estados vistos de "mis pedidos", para avisar con un toast solo
  // cuando cambian (y no la primera vez que se ve cada pedido).
  let estadosConocidos = {};
  let edicionesConocidas = {};

  const COLORES_AVATAR = ['#F2318C', '#2FD8E0', '#FFC93C', '#9B5DE0', '#A8FF3E'];

  function colorParaNombre(nombre) {
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
    return COLORES_AVATAR[Math.abs(hash) % COLORES_AVATAR.length];
  }

  // ---------- Formato de precios ----------
  function formatearCup(precio) {
    return Number.isInteger(precio) ? String(precio) : precio.toFixed(2);
  }

  function formatearUsdReferencia(precioCup) {
    if (!state.tasaCup) return '';
    const usd = Math.ceil(precioCup / state.tasaCup);
    return `$${usd} USD`;
  }

  function formatearPorcion(porcion) {
    if (!porcion) return '';
    return `${formatearCup(porcion.valor)} ${porcion.unidad}`;
  }

  function nombreCategoria(id) {
    const cat = state.categorias.find((c) => c.id === id);
    return cat ? cat.nombre : id;
  }

  // ---------- Red ----------
  const MENSAJE_SIN_RED = 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';

  async function peticion(url, options) {
    // Tiempo máximo de espera: en redes lentas es mejor avisar que dejar
    // el botón "Enviando…" colgado para siempre.
    const controlador = new AbortController();
    const limite = setTimeout(() => controlador.abort(), 25000);
    let res;
    try {
      res = await fetch(url, { ...(options || {}), signal: controlador.signal });
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError'
        ? 'El servidor tardó demasiado en responder. Intenta de nuevo.'
        : MENSAJE_SIN_RED);
      e.red = true;
      throw e;
    } finally {
      clearTimeout(limite);
    }
    if (!res.ok) {
      let mensaje = 'Ocurrió un error inesperado.';
      try {
        const data = await res.json();
        if (data.error) mensaje = data.error;
      } catch (_) { /* respuesta sin cuerpo JSON */ }
      const e = new Error(res.status >= 500 && mensaje === 'Ocurrió un error inesperado.' ? 'El servidor tuvo un problema. Intenta de nuevo en un momento.' : mensaje);
      e.status = res.status;
      throw e;
    }
    if (res.status === 204) return null;
    const datos = await res.json();
    if (datos && typeof datos === 'object' && res.headers.get('X-Desde-Cache')) {
      Object.defineProperty(datos, '__cache', { value: true });
    }
    return datos;
  }

  function mostrarToast(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('is-visible');
    clearTimeout(mostrarToast._t);
    mostrarToast._t = setTimeout(() => el.toast.classList.remove('is-visible'), 2600);
  }

  // ---------- Carrito: persistencia local ----------
  function cargarCarritoGuardado() {
    try {
      const guardado = localStorage.getItem(CARRITO_KEY);
      state.carrito = guardado ? JSON.parse(guardado) || {} : {};
    } catch (_) {
      state.carrito = {};
    }
  }

  function guardarCarrito() {
    try {
      localStorage.setItem(CARRITO_KEY, JSON.stringify(state.carrito));
    } catch (_) {
      // Almacenamiento no disponible (modo privado, etc.) — no es crítico,
      // el carrito solo no sobrevivirá a un refresco de la página.
    }
  }

  // Quita del carrito platos que ya no existen o dejaron de estar
  // disponibles, y ajusta cantidades que superen el máximo permitido (por
  // ejemplo, si el admin bajó el máximo de un plato después de que el
  // cliente ya tenía más en su carrito guardado de una visita anterior).
  // Este es justo el caso "se descubrió en el carrito" — acá sí se avisa con
  // un error, ya que el ajuste cambia lo que el cliente había elegido.
  function sanearCarrito() {
    const ajustados = [];
    const quitados = [];
    Object.keys(state.carrito).forEach((id) => {
      const producto = state.productos.find((p) => p.id === id);
      if (!producto) {
        delete state.carrito[id];
        return;
      }
      if (producto.agotado) {
        delete state.carrito[id];
        quitados.push(producto.nombre);
        return;
      }
      if (producto.maximoPorPedido && state.carrito[id] > producto.maximoPorPedido) {
        state.carrito[id] = producto.maximoPorPedido;
        ajustados.push(producto.nombre);
      }
      if (producto.quedan && state.carrito[id] > producto.quedan) {
        state.carrito[id] = producto.quedan;
        ajustados.push(producto.nombre);
      }
    });
    guardarCarrito();

    if (quitados.length) {
      mostrarToast(quitados.length === 1
        ? `"${quitados[0]}" se agotó y lo quitamos de tu pedido.`
        : 'Algunos platos de tu pedido se agotaron y los quitamos.');
      return;
    }

    if (ajustados.length === 1) {
      mostrarToast(`Ajustamos la cantidad de "${ajustados[0]}" a lo que hay disponible.`);
    } else if (ajustados.length > 1) {
      mostrarToast('Ajustamos la cantidad de algunos platos de tu carrito a lo que hay disponible.');
    }
  }

  function itemsCarrito() {
    return Object.entries(state.carrito)
      .map(([productoId, cantidad]) => {
        const producto = state.productos.find((p) => p.id === productoId);
        return producto ? { producto, cantidad } : null;
      })
      .filter(Boolean);
  }

  function actualizarBadgeCarrito() {
    const total = Object.values(state.carrito).reduce((suma, c) => suma + c, 0);
    el.carritoBadge.textContent = String(total);
    el.btnCarrito.hidden = total === 0;
  }

  // ---------- Carga del menú (inicial y refrescos silenciosos) ----------
  function mostrarEsqueleto() {
    el.lista.innerHTML = '';
    el.estadoVacio.hidden = true;
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'esqueleto';
      el.lista.appendChild(d);
    }
  }

  function mostrarBanner(texto, info) {
    el.bannerRedTexto.textContent = texto;
    el.bannerRed.classList.toggle('banner-red--info', Boolean(info));
    el.bannerRed.hidden = false;
  }

  function ocultarBanner() {
    el.bannerRed.hidden = true;
  }

  let huellaMenu = '';

  async function cargarMenu() {
    const primera = !state.menuCargado;
    if (primera) mostrarEsqueleto();
    try {
      const [datos, sesion] = await Promise.all([
        peticion('/api/public/menu'),
        primera ? peticion('/api/public/me') : Promise.resolve(null),
      ]);
      state.config = datos.config || state.config;
      state.tasaCup = datos.tasaCup;
      state.enviosPorMunicipio = datos.enviosPorMunicipio || {};
      state.desdeCache = Boolean(datos.__cache);
      if (sesion) state.cuenta = sesion.cliente;

      const huella = JSON.stringify([datos.categorias, datos.productos]);
      const cambioMenu = primera || huella !== huellaMenu;
      huellaMenu = huella;
      state.categorias = datos.categorias;
      state.productos = datos.productos;

      aplicarConfig();

      if (primera) cargarCarritoGuardado();
      if (cambioMenu) {
        sanearCarrito();
        renderChips();
        if (primera) renderSelectorMunicipio();
        renderLista();
        actualizarBadgeCarrito();
        if (el.sheetCarrito.classList.contains('is-abierto')) renderCarrito();
      } else if (el.sheetCarrito.classList.contains('is-abierto')) {
        renderCarrito(); // el horario o los mínimos pudieron cambiar
      }

      if (state.desdeCache) {
        mostrarBanner('Sin conexión: mostramos el último menú guardado. Los pedidos requieren internet.', true);
      } else {
        ocultarBanner();
      }

      if (primera) {
        state.menuCargado = true;
        comprobarAdmin();
        prefillDatosCliente();
        aplicarTemaCuenta();
        renderTemas();
        if (state.cuenta) cargarMisPedidos().then(() => atenderAtajoURL());
        else atenderAtajoURL();
      }
    } catch (err) {
      if (primera) {
        el.lista.innerHTML = '';
        el.menuSubtitulo.textContent = 'No se pudo cargar el menú.';
        mostrarVacioConReintento(err.red ? 'Sin conexión' : 'No se pudo cargar el menú', err.message);
      } else {
        mostrarBanner(err.red ? 'Sin conexión: puede que lo que ves no esté actualizado.' : err.message, true);
      }
    }
  }

  function mostrarVacioConReintento(titulo, texto) {
    el.estadoVacio.hidden = false;
    el.estadoVacio.querySelector('h2').textContent = titulo;
    el.estadoVacio.querySelector('p').textContent = texto;
    if (!el.estadoVacio.querySelector('.btn')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--principal';
      b.textContent = 'Reintentar';
      b.addEventListener('click', () => { state.menuCargado = false; cargarMenu(); });
      el.estadoVacio.appendChild(b);
    }
  }

  el.btnReintentar.addEventListener('click', () => {
    el.btnReintentar.disabled = true;
    cargarMenu().finally(() => { el.btnReintentar.disabled = false; });
  });

  // Atajo de la PWA: /?ver=pedidos abre "Mis pedidos"
  function atenderAtajoURL() {
    try {
      const ver = new URLSearchParams(location.search).get('ver');
      const params = new URLSearchParams(location.search);
      if (ver === 'pedidos') abrirPedidosCliente();
      else if (params.get('acceso')) {
        abrirCuenta();
        history.replaceState(null, '', '/');
      }
    } catch (_) { /* ignorar */ }
  }

  // ---------- Ajustes públicos: nombre, contactos, estado, anuncio ----------
  function soloDigitos(t) { return String(t || '').replace(/\D/g, ''); }

  function crearEnlaceContacto(texto, href, externo) {
    const a = document.createElement('a');
    a.className = 'contacto-link';
    a.href = href;
    a.textContent = texto;
    if (externo) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }

  function aplicarConfig() {
    const cfg = state.config;
    if (!cfg) return;

    el.tiendaNombre.textContent = cfg.tienda.nombre;
    el.tiendaEmoji.textContent = cfg.tienda.emoji;
    el.menuSubtitulo.textContent = cfg.tienda.eslogan || `${state.productos.length} platos disponibles`;

    // Barra de contactos (siempre arriba): estado + enlaces
    el.contactosBar.querySelectorAll('.contacto-link').forEach((n) => n.remove());
    const est = cfg.estado;
    el.estadoTienda.hidden = false;
    el.estadoTienda.textContent = est.texto;
    el.estadoTienda.classList.toggle('estado-tienda--cerrado', !est.abierto);

    const c = cfg.contactos;
    if (c.telefono) el.contactosBar.appendChild(crearEnlaceContacto(`📞 ${c.telefono}`, `tel:${c.telefono.replace(/[^\d+]/g, '')}`));
    if (c.whatsapp && soloDigitos(c.whatsapp)) el.contactosBar.appendChild(crearEnlaceContacto('💬 WhatsApp', `https://wa.me/${soloDigitos(c.whatsapp)}`, true));
    if (c.telegram) el.contactosBar.appendChild(crearEnlaceContacto('✈️ Telegram', `https://t.me/${encodeURIComponent(c.telegram)}`, true));
    if (c.instagram) el.contactosBar.appendChild(crearEnlaceContacto('📷 Instagram', `https://instagram.com/${encodeURIComponent(c.instagram)}`, true));
    if (c.facebook) el.contactosBar.appendChild(crearEnlaceContacto('👍 Facebook', /^https?:\/\//i.test(c.facebook) ? c.facebook : `https://facebook.com/${encodeURIComponent(c.facebook)}`, true));
    if (c.email) el.contactosBar.appendChild(crearEnlaceContacto('✉️ Email', `mailto:${c.email}`));
    if (c.direccion) el.contactosBar.appendChild(crearEnlaceContacto(`📍 ${c.direccion}`, `https://www.openstreetmap.org/search?query=${encodeURIComponent(`${c.direccion}, La Habana`)}`, true));

    // Anuncio destacado
    if (cfg.tienda.anuncioActivo && cfg.tienda.anuncio) {
      el.anuncio.textContent = cfg.tienda.anuncio;
      el.anuncio.hidden = false;
    } else {
      el.anuncio.hidden = true;
    }

    // Pie de página
    const partes = [];
    if (c.telefono) partes.push(c.telefono);
    if (c.direccion) partes.push(c.direccion);
    el.footerContacto.textContent = partes.join(' · ');
  }

  // Si hay una cuenta con sesión iniciada, completa el formulario de entrega
  // con sus datos guardados (el cliente igual puede editarlos antes de pedir).
  function prefillDatosCliente() {
    if (!state.cuenta) return;
    if (!el.campoNombre.value) el.campoNombre.value = state.cuenta.nombre || '';
    if (!el.campoTelefono.value) el.campoTelefono.value = state.cuenta.telefono || '';
    if (!el.campoDireccion.value) el.campoDireccion.value = state.cuenta.direccion || '';
  }

  // ---------- Temas ----------
  // El tema elegido se guarda en el dispositivo (localStorage) y, si hay
  // cuenta, también en el servidor para que acompañe al cliente.
  function aplicarTemaCuenta() {
    if (state.cuenta && state.cuenta.tema && window.Temas) window.Temas.aplicar(state.cuenta.tema);
  }

  function renderTemas() {
    if (!window.Temas || !el.temasGrid) return;
    el.temasGrid.innerHTML = '';
    const actual = window.Temas.actual();
    window.Temas.lista.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tema-opcion${t.id === actual ? ' is-activo' : ''}`;
      b.dataset.tema = t.id;
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
      el.temasGrid.appendChild(b);
    });
  }

  if (el.temasGrid) {
    el.temasGrid.addEventListener('click', async (e) => {
      const b = e.target.closest('.tema-opcion');
      if (!b || !window.Temas) return;
      window.Temas.aplicar(b.dataset.tema);
      renderTemas();
      if (state.cuenta) {
        try {
          state.cuenta = await peticion('/api/public/me/tema', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tema: b.dataset.tema }),
          });
        } catch (_) { /* queda guardado en el dispositivo igualmente */ }
      }
    });
  }

  // ---------- Chips de categoría ----------
  function renderChips() {
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
    if (state.categoriaActiva !== 'todos' && !state.categorias.some((c) => c.id === state.categoriaActiva)) {
      state.categoriaActiva = 'todos';
    }
    el.chips.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', c.dataset.categoria === state.categoriaActiva);
    });
  }

  el.chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    el.chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.categoriaActiva = chip.dataset.categoria;
    renderLista();
  });

  // ---------- Selector de municipio (los 15 de La Habana) ----------
  // Los 15 municipios se pueden elegir todos — el negocio reparte en toda la
  // ciudad, lo que cambia de uno a otro es el costo de envío. El servidor
  // vuelve a validar que el id mandado sea uno de los 15, sin importar qué
  // mande el navegador.
  function renderSelectorMunicipio() {
    // Se deja el <option> placeholder ya escrito en el HTML y se agregan los
    // municipios después de él.
    MUNICIPIOS_HABANA.forEach((mun) => {
      const option = document.createElement('option');
      option.value = mun.id;
      option.textContent = mun.nombre;
      el.campoMunicipio.appendChild(option);
    });
  }

  function costoEnvioMunicipio(municipioId) {
    return Number(state.enviosPorMunicipio[municipioId]) || 0;
  }

  el.campoMunicipio.addEventListener('change', () => {
    if (el.carritoTotal.hidden) return; // el carrito todavía no está abierto/renderizado
    renderCarrito();
  });

  // ---------- Búsqueda de platos ----------
  // Filtra por nombre y descripción, sin distinguir mayúsculas/acentos exactos
  // (comparación simple con toLowerCase — suficiente para este catálogo chico).
  el.buscadorPlatos.addEventListener('input', () => {
    state.busqueda = el.buscadorPlatos.value.trim().toLowerCase();
    renderLista();
  });

  // ---------- Render: lista de productos ----------
  function productosFiltrados() {
    return state.productos.filter((p) => {
      if (state.categoriaActiva !== 'todos' && p.categoria !== state.categoriaActiva) return false;
      if (state.busqueda) {
        const enNombre = p.nombre.toLowerCase().includes(state.busqueda);
        const enDescripcion = (p.descripcion || '').toLowerCase().includes(state.busqueda);
        if (!enNombre && !enDescripcion) return false;
      }
      return true;
    });
  }

  function renderLista() {
    const productos = productosFiltrados();
    el.lista.innerHTML = '';

    if (!(state.config && state.config.tienda.eslogan)) {
      el.menuSubtitulo.textContent = `${state.productos.length} ${state.productos.length === 1 ? 'plato disponible' : 'platos disponibles'}`;
    }

    if (productos.length === 0) {
      el.estadoVacio.hidden = false;
      el.estadoVacio.querySelector('h2').textContent =
        state.busqueda ? 'No encontramos ese plato' : state.productos.length === 0 ? 'No hay platos disponibles' : 'No hay platos en esta categoría';
      el.estadoVacio.querySelector('p').textContent = state.busqueda
        ? 'Prueba con otra palabra o revisa la categoría seleccionada.'
        : state.productos.length === 0
          ? 'Vuelve a mirar más tarde, estamos actualizando el menú.'
          : 'Prueba con otra categoría.';
      return;
    }
    el.estadoVacio.hidden = true;

    productos.forEach((p) => el.lista.appendChild(crearTarjetaProducto(p)));
  }

  function crearAvatar(p) {
    const avatar = document.createElement('div');
    avatar.className = 'tarjeta__avatar';
    avatar.style.background = colorParaNombre(p.nombre);
    avatar.textContent = p.nombre.charAt(0).toUpperCase();
    return avatar;
  }

  // "Agotado" o "Quedan N" (solo cuando queda poco; el stock exacto no se muestra).
  function crearEtiquetaStock(p) {
    if (p.agotado) {
      const e = document.createElement('span');
      e.className = 'etiqueta-stock etiqueta-stock--agotado';
      e.textContent = 'Agotado';
      return e;
    }
    if (p.quedan) {
      const e = document.createElement('span');
      e.className = 'etiqueta-stock etiqueta-stock--poco';
      e.textContent = p.quedan === 1 ? '¡Queda 1!' : `Quedan ${p.quedan}`;
      return e;
    }
    return null;
  }

  function crearTarjetaProducto(p) {
    const tarjeta = document.createElement('article');
    tarjeta.className = `tarjeta tarjeta--clickable${p.agotado ? ' tarjeta--agotada' : ''}`;

    // Toda la tarjeta abre el detalle del plato (foto más grande + descripción
    // completa) — salvo el control de cantidad, que tiene su propio click.
    tarjeta.tabIndex = 0;
    tarjeta.setAttribute('role', 'button');
    tarjeta.setAttribute('aria-label', `Ver detalle de ${p.nombre}`);
    // Usamos e.composedPath() en vez de e.target.closest(): el botón
    // "Agregar" se reemplaza a sí mismo por un stepper en su propio click
    // (ver cambiarCantidad), así que al llegar acá por burbujeo e.target ya
    // quedó desconectado del documento y closest() ya no encuentra a su
    // ancestro — con composedPath() usamos la ruta original del evento, que
    // no cambia aunque el DOM se haya modificado en el camino.
    function clickFueEnAcciones(e) {
      return typeof e.composedPath === 'function'
        ? e.composedPath().some((nodo) => nodo.classList && nodo.classList.contains('tarjeta__acciones'))
        : Boolean(e.target.closest && e.target.closest('.tarjeta__acciones'));
    }
    tarjeta.addEventListener('click', (e) => {
      if (clickFueEnAcciones(e)) return;
      abrirDetalleProducto(p);
    });
    tarjeta.addEventListener('keydown', (e) => {
      if (clickFueEnAcciones(e)) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        abrirDetalleProducto(p);
      }
    });

    if (p.imagen) {
      const contenedorImagen = document.createElement('div');
      contenedorImagen.className = 'tarjeta__imagen-link';
      const img = document.createElement('img');
      img.className = 'tarjeta__imagen';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 60;
      img.height = 60;
      img.src = p.imagen;
      img.alt = p.nombre;
      img.addEventListener('error', () => contenedorImagen.replaceWith(crearAvatar(p)), { once: true });
      contenedorImagen.appendChild(img);
      tarjeta.appendChild(contenedorImagen);
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
    const etiquetaStock = crearEtiquetaStock(p);
    if (etiquetaStock) meta.appendChild(etiquetaStock);

    const filaSecundaria = document.createElement('div');
    filaSecundaria.className = 'tarjeta__meta tarjeta__meta--secundaria';
    const usdRef = formatearUsdReferencia(p.precio);
    if (usdRef) {
      const usd = document.createElement('span');
      usd.textContent = usdRef;
      filaSecundaria.appendChild(usd);
    }
    // El máximo por pedido (p.maximoPorPedido) ya NO se muestra acá — el
    // cliente no necesita saber el número de antemano. Sigue aplicándose
    // igual: el stepper no deja pasarse (ver crearStepper/cambiarCantidad
    // más abajo), y si de todos modos llegara a haber más en el carrito de
    // lo permitido (por ejemplo, el admin bajó el máximo después de que el
    // cliente ya tenía más en su carrito guardado), recién ahí se avisa con
    // un error — ver sanearCarrito().
    if (p.descripcion) {
      const desc = document.createElement('p');
      desc.className = 'tarjeta__descripcion';
      desc.textContent = p.descripcion;
      info.append(nombre, meta, desc, filaSecundaria);
    } else {
      info.append(nombre, meta, filaSecundaria);
    }

    const acciones = document.createElement('div');
    acciones.className = 'tarjeta__acciones tarjeta__acciones--tienda';
    acciones.appendChild(crearControlCantidad(p));

    tarjeta.append(info, acciones);
    return tarjeta;
  }

  // ---------- Detalle del plato (bottom sheet: foto grande + descripción completa) ----------
  function crearAvatarGrande(p) {
    const avatar = document.createElement('div');
    avatar.className = 'producto-detalle__avatar';
    avatar.style.background = colorParaNombre(p.nombre);
    avatar.textContent = p.nombre.charAt(0).toUpperCase();
    return avatar;
  }

  function abrirDetalleProducto(p) {
    el.productoDetalleNombre.textContent = p.nombre;

    // Foto grande — sigue siendo clicable: abre la imagen original a tamaño
    // completo en una pestaña nueva, igual que antes en la tarjeta chica.
    el.productoDetalleImagen.innerHTML = '';
    if (p.imagen) {
      const link = document.createElement('a');
      link.className = 'producto-detalle__imagen-link';
      link.href = p.imagen;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const img = document.createElement('img');
      img.className = 'producto-detalle__imagen';
      img.src = p.imagen;
      img.alt = p.nombre;
      img.addEventListener('error', () => link.replaceWith(crearAvatarGrande(p)), { once: true });
      link.appendChild(img);
      el.productoDetalleImagen.appendChild(link);
    } else {
      el.productoDetalleImagen.appendChild(crearAvatarGrande(p));
    }

    // Precio, categoría, porción y máximo — mismo contenido que en la tarjeta.
    el.productoDetalleMeta.innerHTML = '';
    const precio = document.createElement('span');
    precio.className = 'tarjeta__precio';
    precio.textContent = `${formatearCup(p.precio)} CUP`;
    el.productoDetalleMeta.appendChild(precio);
    const usdRef = formatearUsdReferencia(p.precio);
    if (usdRef) {
      const usd = document.createElement('span');
      usd.textContent = `· ${usdRef}`;
      el.productoDetalleMeta.appendChild(usd);
    }
    const categoria = document.createElement('span');
    categoria.textContent = `· ${nombreCategoria(p.categoria)}`;
    el.productoDetalleMeta.appendChild(categoria);
    const porcionTexto = formatearPorcion(p.porcion);
    if (porcionTexto) {
      const porcion = document.createElement('span');
      porcion.textContent = `· ${porcionTexto}`;
      el.productoDetalleMeta.appendChild(porcion);
    }
    const etiquetaStockDetalle = crearEtiquetaStock(p);
    if (etiquetaStockDetalle) el.productoDetalleMeta.appendChild(etiquetaStockDetalle);
    // El máximo por pedido tampoco se muestra acá (ver nota en
    // crearTarjetaProducto más arriba, misma razón).

    // Descripción completa, sin truncar (a diferencia de la tarjeta chica).
    if (p.descripcion) {
      el.productoDetalleDescripcion.textContent = p.descripcion;
      el.productoDetalleDescripcion.hidden = false;
    } else {
      el.productoDetalleDescripcion.hidden = true;
    }

    // Mismo control de agregar/stepper que la tarjeta — cambiarCantidad ya
    // actualiza todas las copias en pantalla a la vez.
    el.productoDetalleAcciones.innerHTML = '';
    el.productoDetalleAcciones.appendChild(crearControlCantidad(p));

    el.overlayProducto.hidden = false;
    el.sheetProducto.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetProducto.classList.add('is-abierto'));
  }

  function cerrarDetalleProducto() {
    el.sheetProducto.classList.remove('is-abierto');
    el.sheetProducto.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayProducto.hidden = true; }, 200);
  }

  el.btnCerrarProducto.addEventListener('click', cerrarDetalleProducto);
  el.overlayProducto.addEventListener('click', cerrarDetalleProducto);

  // ---------- Control de cantidad (agregar / stepper) ----------
  function crearControlCantidad(producto) {
    const contenedor = document.createElement('div');
    contenedor.className = 'tarjeta__cantidad';
    contenedor.dataset.cantidadDe = producto.id;

    const cantidad = state.carrito[producto.id] || 0;

    if (producto.agotado) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--fantasma btn--chico';
      btn.textContent = 'Agotado';
      btn.disabled = true;
      contenedor.appendChild(btn);
    } else if (cantidad === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--principal btn--chico';
      btn.textContent = 'Agregar';
      btn.addEventListener('click', () => cambiarCantidad(producto, 1));
      contenedor.appendChild(btn);
    } else {
      contenedor.appendChild(crearStepper(producto, cantidad));
    }

    return contenedor;
  }

  function crearStepper(producto, cantidad) {
    const stepper = document.createElement('div');
    stepper.className = 'stepper';

    const btnMenos = document.createElement('button');
    btnMenos.type = 'button';
    btnMenos.className = 'stepper__btn';
    btnMenos.textContent = '−';
    btnMenos.setAttribute('aria-label', `Quitar uno de ${producto.nombre}`);
    btnMenos.addEventListener('click', () => cambiarCantidad(producto, -1));

    const valor = document.createElement('span');
    valor.className = 'stepper__valor';
    valor.textContent = cantidad;

    const btnMas = document.createElement('button');
    btnMas.type = 'button';
    btnMas.className = 'stepper__btn';
    btnMas.textContent = '+';
    btnMas.setAttribute('aria-label', `Agregar uno de ${producto.nombre}`);
    // A propósito NO se deshabilita de antemano al llegar al máximo — eso ya
    // era una forma de "avisar" del límite sin decirlo con palabras. Se deja
    // siempre activo; cambiarCantidad() es quien decide si se puede sumar
    // uno más, y si no, recién ahí muestra el error (ver más abajo).
    btnMas.addEventListener('click', () => cambiarCantidad(producto, 1));

    stepper.append(btnMenos, valor, btnMas);
    return stepper;
  }

  // El máximo por pedido ya no se muestra de antemano en la tarjeta (ver
  // crearTarjetaProducto) ni bloquea el botón "+" en silencio — el cliente
  // se entera del límite recién cuando lo alcanza, con un error explícito.
  function cambiarCantidad(producto, delta) {
    const actual = state.carrito[producto.id] || 0;
    let siguiente = actual + delta;
    if (siguiente < 0) siguiente = 0;

    if (delta > 0 && producto.maximoPorPedido && siguiente > producto.maximoPorPedido) {
      mostrarToast(`Ya tienes el máximo permitido de "${producto.nombre}" en tu pedido (${producto.maximoPorPedido}).`);
      return;
    }

    if (delta > 0 && producto.quedan && siguiente > producto.quedan) {
      mostrarToast(`Solo quedan ${producto.quedan} de "${producto.nombre}".`);
      return;
    }

    if (siguiente === 0) delete state.carrito[producto.id];
    else state.carrito[producto.id] = siguiente;

    guardarCarrito();
    actualizarBadgeCarrito();

    // Puede haber dos controles del mismo producto en pantalla a la vez (la
    // tarjeta de la lista y el sheet de detalle) — actualizamos todos.
    document.querySelectorAll(`[data-cantidad-de="${producto.id}"]`).forEach((contenedorViejo) => {
      contenedorViejo.replaceWith(crearControlCantidad(producto));
    });

    if (el.sheetCarrito.classList.contains('is-abierto')) renderCarrito();
  }

  // ---------- Sheet del carrito ----------
  function abrirCarrito() {
    // Hacer un pedido requiere cuenta — si no hay sesión, mandamos al
    // cliente directo a iniciar sesión o registrarse, en vez de mostrarle
    // un formulario de pedido que el servidor igual va a rechazar.
    if (!state.cuenta) {
      mostrarToast('Inicia sesión o crea una cuenta para hacer tu pedido.');
      abrirCuenta();
      return;
    }
    renderPagos();
    renderCarrito();
    el.overlay.hidden = false;
    el.sheetCarrito.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetCarrito.classList.add('is-abierto'));
  }

  function cerrarCarrito() {
    el.sheetCarrito.classList.remove('is-abierto');
    el.sheetCarrito.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlay.hidden = true; }, 200);
  }

  el.btnCarrito.addEventListener('click', abrirCarrito);
  el.btnCerrarCarrito.addEventListener('click', cerrarCarrito);
  el.overlay.addEventListener('click', cerrarCarrito);

  function crearFilaCarrito(producto, cantidad) {
    const fila = document.createElement('div');
    fila.className = 'carrito-fila';

    const info = document.createElement('div');
    info.className = 'carrito-fila__info';
    const nombre = document.createElement('p');
    nombre.className = 'carrito-fila__nombre';
    nombre.textContent = producto.nombre;
    const precioUnit = document.createElement('p');
    precioUnit.className = 'carrito-fila__precio';
    precioUnit.textContent = `${formatearCup(producto.precio)} CUP c/u`;
    info.append(nombre, precioUnit);

    const stepper = crearStepper(producto, cantidad);

    const subtotal = document.createElement('p');
    subtotal.className = 'carrito-fila__subtotal';
    subtotal.textContent = `${formatearCup(producto.precio * cantidad)} CUP`;

    fila.append(info, stepper, subtotal);
    return fila;
  }

  // Mismo cálculo que el servidor (Pedidos.calcularEnvio) — el servidor
  // vuelve a calcularlo siempre; esto es solo para mostrar el total.
  function calcularEnvioCliente(subtotal, municipio) {
    const gratisDesde = state.config ? Number(state.config.pedidos.envioGratisDesdeCup) || 0 : 0;
    if (gratisDesde > 0 && subtotal >= gratisDesde) return { envio: 0, gratis: true };
    return { envio: costoEnvioMunicipio(municipio), gratis: false };
  }

  function crearAviso(texto, ok) {
    const d = document.createElement('div');
    d.className = `aviso-carrito${ok ? ' aviso-carrito--ok' : ''}`;
    d.textContent = texto;
    return d;
  }

  function subtotalCarrito() {
    return itemsCarrito().reduce((s, { producto, cantidad }) => s + producto.precio * cantidad, 0);
  }

  // Habilita/deshabilita "Confirmar pedido" según mínimo, horario y envío en curso.
  function actualizarBotonPedido() {
    const cfg = state.config;
    let bloqueado = state.enviando;
    let texto = state.enviando ? 'Enviando…' : 'Confirmar pedido';
    if (!state.enviando && cfg) {
      const minimo = Number(cfg.pedidos.pedidoMinimoCup) || 0;
      const sub = subtotalCarrito();
      if (minimo > 0 && sub < minimo) { bloqueado = true; texto = `Pedido mínimo ${formatearCup(minimo)} CUP`; }
      else if (!cfg.estado.abierto && !cfg.horario.aceptarFueraDeHorario) { bloqueado = true; texto = 'Cerrado ahora'; }
      else if (!cfg.estado.abierto) texto = 'Confirmar pedido para después';
    }
    el.btnConfirmarPedido.disabled = bloqueado;
    el.btnConfirmarPedido.textContent = texto;
  }

  function renderPagos() {
    const pagos = state.config ? state.config.pedidos.pagos : [];
    el.pagosLista.innerHTML = '';
    el.campoPagoWrap.hidden = pagos.length === 0;
    if (!pagos.some((m) => m.id === state.pagoSeleccionado)) state.pagoSeleccionado = pagos[0] ? pagos[0].id : null;
    pagos.forEach((m) => {
      const label = document.createElement('label');
      label.className = 'pago-opcion';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'metodoPago';
      radio.value = m.id;
      radio.checked = m.id === state.pagoSeleccionado;
      radio.addEventListener('change', () => { state.pagoSeleccionado = m.id; });
      const texto = document.createElement('span');
      const nombre = document.createElement('strong');
      nombre.textContent = m.nombre;
      texto.appendChild(nombre);
      if (m.instrucciones) {
        const small = document.createElement('small');
        small.textContent = m.instrucciones;
        texto.appendChild(small);
      }
      label.append(radio, texto);
      el.pagosLista.appendChild(label);
    });
  }

  function renderCarrito() {
    const items = itemsCarrito();
    el.carritoLista.innerHTML = '';
    el.avisosCarrito.innerHTML = '';

    if (items.length === 0) {
      el.carritoVacioMsg.hidden = false;
      el.carritoTotal.hidden = true;
      el.formPedido.hidden = true;
      return;
    }

    el.carritoVacioMsg.hidden = true;
    el.formPedido.hidden = false;

    let subtotal = 0;
    items.forEach(({ producto, cantidad }) => {
      subtotal += producto.precio * cantidad;
      el.carritoLista.appendChild(crearFilaCarrito(producto, cantidad));
    });

    el.carritoTotal.hidden = false;
    const usdRefSubtotal = formatearUsdReferencia(subtotal);
    el.carritoSubtotalValor.textContent = usdRefSubtotal ? `${formatearCup(subtotal)} CUP · ${usdRefSubtotal}` : `${formatearCup(subtotal)} CUP`;

    // El envío depende del municipio elegido en el formulario de abajo —
    // mientras no se elija ninguno, se muestra "—" en vez de sumar 0 CUP
    // (0 podría confundirse con "envío gratis").
    const municipio = el.campoMunicipio.value;
    if (municipio) {
      const { envio, gratis } = calcularEnvioCliente(subtotal, municipio);
      const nombreMunicipio = (MUNICIPIOS_HABANA.find((m) => m.id === municipio) || {}).nombre || '';
      el.carritoEnvioMunicipio.textContent = ` (${nombreMunicipio})`;
      el.carritoEnvioValor.textContent = gratis ? 'Gratis 🎉' : `${formatearCup(envio)} CUP`;
      const total = subtotal + envio;
      const usdRefTotal = formatearUsdReferencia(total);
      el.carritoTotalValor.textContent = usdRefTotal ? `${formatearCup(total)} CUP · ${usdRefTotal}` : `${formatearCup(total)} CUP`;
    } else {
      el.carritoEnvioMunicipio.textContent = '';
      el.carritoEnvioValor.textContent = '—';
      el.carritoTotalValor.textContent = usdRefSubtotal ? `${formatearCup(subtotal)} CUP · ${usdRefSubtotal}` : `${formatearCup(subtotal)} CUP`;
    }

    // Avisos: horario, mínimo, envío gratis, tiempo estimado
    const cfg = state.config;
    if (cfg) {
      if (!cfg.estado.abierto) {
        if (cfg.horario.aceptarFueraDeHorario) {
          el.avisosCarrito.appendChild(crearAviso(`🌙 Ahora estamos cerrados. Si haces tu pedido ahora, te lo entregamos ${cfg.estado.textoEntrega}.`));
        } else {
          el.avisosCarrito.appendChild(crearAviso(`🌙 Ahora estamos cerrados y no recibimos pedidos. Volvemos ${cfg.estado.textoEntrega}.`));
        }
      }
      const minimo = Number(cfg.pedidos.pedidoMinimoCup) || 0;
      if (minimo > 0 && subtotal < minimo) {
        el.avisosCarrito.appendChild(crearAviso(`El pedido mínimo es de ${formatearCup(minimo)} CUP (sin envío). Te faltan ${formatearCup(minimo - subtotal)} CUP.`));
      }
      const gratisDesde = Number(cfg.pedidos.envioGratisDesdeCup) || 0;
      if (gratisDesde > 0) {
        if (subtotal >= gratisDesde) el.avisosCarrito.appendChild(crearAviso('🎉 ¡Tu envío es gratis!', true));
        else el.avisosCarrito.appendChild(crearAviso(`Agrega ${formatearCup(gratisDesde - subtotal)} CUP más y el envío es gratis.`, true));
      }
      if (cfg.estado.abierto && cfg.pedidos.tiempoEstimado) {
        el.tiempoEstimado.textContent = `⏱ Tiempo estimado de entrega: ${cfg.pedidos.tiempoEstimado}`;
        el.tiempoEstimado.hidden = false;
      } else {
        el.tiempoEstimado.hidden = true;
      }
    }
    actualizarBotonPedido();
  }

  // ---------- Sheet "Mi cuenta" ----------
  function abrirCuenta() {
    el.overlayCuenta.hidden = false;
    el.sheetCuenta.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetCuenta.classList.add('is-abierto'));

    if (state.cuenta) {
      mostrarVistaSesion();
    } else {
      mostrarVistaInvitado();
    }
  }

  function cerrarCuenta() {
    el.sheetCuenta.classList.remove('is-abierto');
    el.sheetCuenta.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayCuenta.hidden = true; }, 200);
  }

  el.btnCuenta.addEventListener('click', abrirCuenta);
  el.btnCerrarCuenta.addEventListener('click', cerrarCuenta);
  el.overlayCuenta.addEventListener('click', cerrarCuenta);

  // ---------- Sheet "Mis pedidos" (ícono aparte en la barra superior) ----------
  function abrirPedidosCliente() {
    // Sin cuenta no hay pedidos que mostrar — mandamos a iniciar sesión.
    if (!state.cuenta) {
      mostrarToast('Inicia sesión o crea una cuenta para ver tus pedidos.');
      abrirCuenta();
      return;
    }
    limpiarAvisosPedidos();
    el.overlayPedidosCliente.hidden = false;
    el.sheetPedidosCliente.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetPedidosCliente.classList.add('is-abierto'));
    cargarMisPedidos();
  }

  function cerrarPedidosCliente() {
    el.sheetPedidosCliente.classList.remove('is-abierto');
    el.sheetPedidosCliente.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayPedidosCliente.hidden = true; }, 200);
  }

  el.btnPedidosCliente.addEventListener('click', abrirPedidosCliente);
  el.btnCerrarPedidosCliente.addEventListener('click', cerrarPedidosCliente);
  el.overlayPedidosCliente.addEventListener('click', cerrarPedidosCliente);

  function mostrarVistaInvitado() {
    el.cuentaInvitado.hidden = false;
    el.cuentaSesion.hidden = true;
  }

  function mostrarVistaSesion() {
    el.cuentaInvitado.hidden = true;
    el.cuentaSesion.hidden = false;
    el.cuentaNombre.textContent = state.cuenta.nombre;
    el.perfilNombre.value = state.cuenta.nombre || '';
    // El email es de solo lectura acá (no se puede cambiar) — solo se
    // muestra como referencia de con qué cuenta se inició sesión. El
    // teléfono sí se puede editar (por ejemplo, si el cliente cambió de
    // número).
    el.perfilEmail.value = state.cuenta.email || '';
    el.perfilTelefono.value = state.cuenta.telefono || '';
    el.perfilDireccion.value = state.cuenta.direccion || '';
    renderTemas();
  }

  // ---------- Mi perfil: cambiar nombre/teléfono/dirección por defecto ----------
  el.formPerfilCliente.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.perfilError.hidden = true;
    el.btnGuardarPerfil.disabled = true;
    el.btnGuardarPerfil.textContent = 'Guardando…';

    try {
      const actualizado = await peticion('/api/public/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: el.perfilNombre.value.trim(),
          telefono: el.perfilTelefono.value.trim(),
          direccion: el.perfilDireccion.value.trim(),
        }),
      });
      state.cuenta = actualizado;
      el.cuentaNombre.textContent = actualizado.nombre;
      mostrarToast('Perfil actualizado.');
    } catch (err) {
      el.perfilError.textContent = err.message;
      el.perfilError.hidden = false;
    } finally {
      el.btnGuardarPerfil.disabled = false;
      el.btnGuardarPerfil.textContent = 'Guardar cambios';
    }
  });

  // ---------- Cambiar contraseña ----------
  el.formClaveCliente.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.claveError.hidden = true;
    el.btnCambiarClave.disabled = true;
    try {
      await peticion('/api/public/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual: el.claveActual.value, nueva: el.claveNueva.value }),
      });
      el.formClaveCliente.reset();
      el.formClaveCliente.closest('details').open = false;
      mostrarToast('Contraseña cambiada.');
    } catch (err) {
      el.claveError.textContent = err.message;
      el.claveError.hidden = false;
    } finally {
      el.btnCambiarClave.disabled = false;
    }
  });

  // ---------- Insignia de "Mis pedidos" (pedidos abiertos, sin entregar) ----------
  function actualizarBadgePedidosCliente(pedidos) {
    if (!state.cuenta) {
      el.pedidosClienteBadge.hidden = true;
      return;
    }
    const abiertos = pedidos.filter((p) => ESTADOS_ABIERTOS.includes(p.estado)).length;
    el.pedidosClienteBadge.textContent = abiertos > 9 ? '9+' : String(abiertos);
    el.pedidosClienteBadge.hidden = abiertos === 0;
  }

  // ---------- Tabs: iniciar sesión / crear cuenta ----------
  el.tabLogin.addEventListener('click', () => {
    el.tabLogin.classList.add('is-active');
    el.tabRegistro.classList.remove('is-active');
    el.formLoginCliente.hidden = false;
    el.formRegistroCliente.hidden = true;
  });

  el.tabRegistro.addEventListener('click', () => {
    el.tabRegistro.classList.add('is-active');
    el.tabLogin.classList.remove('is-active');
    el.formRegistroCliente.hidden = false;
    el.formLoginCliente.hidden = true;
  });

  // ---------- Iniciar sesión ----------
  el.formLoginCliente.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginClienteError.hidden = true;
    el.btnLoginCliente.disabled = true;
    el.btnLoginCliente.textContent = 'Entrando…';

    try {
      // Atajo para el administrador: si escribe "admin" (sin @) en vez de un
      // email, usamos su contraseña para entrar directamente al panel.
      const usuarioEscrito = el.loginEmail.value.trim();
      if (usuarioEscrito && !usuarioEscrito.includes('@')) {
        await peticion('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario: usuarioEscrito, password: el.loginPassword.value }),
        });
        el.formLoginCliente.reset();
        mostrarAdmin(true);
        cerrarCuenta();
        mostrarToast('Sesión de administrador iniciada.');
        return;
      }
      const cliente = await peticion('/api/public/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: el.loginEmail.value.trim(), password: el.loginPassword.value }),
      });
      state.cuenta = cliente;
      prefillDatosCliente();
      aplicarTemaCuenta();
      el.formLoginCliente.reset();
      mostrarVistaSesion();
      cargarMisPedidos();
      mostrarToast(`¡Hola, ${cliente.nombre}!`);
    } catch (err) {
      el.loginClienteError.textContent = err.message;
      el.loginClienteError.hidden = false;
    } finally {
      el.btnLoginCliente.disabled = false;
      el.btnLoginCliente.textContent = 'Entrar';
    }
  });

  // ---------- Crear cuenta ----------
  el.formRegistroCliente.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.registroClienteError.hidden = true;
    el.btnRegistroCliente.disabled = true;
    el.btnRegistroCliente.textContent = 'Creando…';

    try {
      const cliente = await peticion('/api/public/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: el.registroNombre.value.trim(),
          email: el.registroEmail.value.trim(),
          telefono: el.registroTelefono.value.trim(),
          password: el.registroPassword.value,
          direccion: el.registroDireccion.value.trim(),
        }),
      });
      state.cuenta = cliente;
      prefillDatosCliente();
      aplicarTemaCuenta();
      el.formRegistroCliente.reset();
      mostrarVistaSesion();
      cargarMisPedidos();
      mostrarToast(`¡Cuenta creada! Hola, ${cliente.nombre}.`);
    } catch (err) {
      el.registroClienteError.textContent = err.message;
      el.registroClienteError.hidden = false;
    } finally {
      el.btnRegistroCliente.disabled = false;
      el.btnRegistroCliente.textContent = 'Crear cuenta';
    }
  });

  // ---------- Administrador (misma entrada que los clientes) ----------
  function mostrarAdmin(si) {
    state.esAdmin = Boolean(si);
    const btn = document.getElementById('btnAdminPanel');
    const caja = document.getElementById('cuentaAdmin');
    // El enlace se pone por JS solo si hay sesión de admin: no aparece en el HTML público.
    if (btn) { btn.hidden = !si; if (si) btn.setAttribute('href', '/admin'); else btn.removeAttribute('href'); }
    const ir = document.getElementById('btnIrPanel');
    if (ir) { if (si) ir.setAttribute('href', '/admin'); else ir.removeAttribute('href'); }
    if (caja) caja.hidden = !si;
  }

  async function comprobarAdmin() {
    try {
      const r = await fetch('/api/es-admin', { cache: 'no-store' });
      if (r.ok) mostrarAdmin((await r.json()).admin);
    } catch (_) { /* sin red: no mostramos nada */ }
  }

  document.getElementById('btnCerrarAdmin').addEventListener('click', async () => {
    try { await peticion('/api/logout', { method: 'POST' }); } catch (_) { /* ignorar */ }
    mostrarAdmin(false);
    cerrarCuenta();
    mostrarToast('Cerraste la sesión de administrador.');
  });

  // ---------- Cerrar sesión de cliente ----------
  el.btnCerrarSesionCliente.addEventListener('click', async () => {
    try {
      await peticion('/api/public/logout', { method: 'POST' });
    } catch (_) { /* si falla, igual limpiamos la vista local */ }
    state.cuenta = null;
    estadosConocidos = {};
    edicionesConocidas = {};
    state.ultimosPedidos = [];
    limpiarAvisosPedidos();
    mostrarVistaInvitado();
    aplicarTemaCuenta();
    actualizarBadgePedidosCliente([]);
    mostrarToast('Cerraste sesión.');
  });

  // ---------- Mis pedidos ----------
  function formatearFechaPedido(iso) {
    if (!iso) return '';
    const fecha = new Date(iso);
    return fecha.toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function renderMisPedidos(pedidos) {
    el.misPedidosLista.innerHTML = '';
    if (pedidos.length === 0) {
      el.misPedidosVacio.hidden = false;
      return;
    }
    el.misPedidosVacio.hidden = true;
    pedidos.forEach((p) => el.misPedidosLista.appendChild(crearFilaMiPedido(p)));
  }

  async function cargarMisPedidos() {
    try {
      const pedidos = await peticion('/api/public/mis-pedidos');
      // Al cargar la lista, el cliente ya "vio" el estado actual de cada uno.
      pedidos.forEach((p) => { estadosConocidos[p.id] = p.estado; edicionesConocidas[p.id] = p.editadoEn || null; });
      state.ultimosPedidos = pedidos;
      actualizarBadgePedidosCliente(pedidos);
      renderMisPedidos(pedidos);
    } catch (err) {
      mostrarToast(err.message);
    }
  }

  const PASOS_PROGRESO = [
    { estado: 'nuevo', etiqueta: 'Recibido' },
    { estado: 'en_preparacion', etiqueta: 'Preparando' },
    { estado: 'enviado', etiqueta: 'En camino' },
    { estado: 'completado', etiqueta: 'Entregado' },
  ];

  function crearProgreso(pedido) {
    const contenedor = document.createElement('div');
    contenedor.className = 'progreso';
    const actual = PASOS_PROGRESO.findIndex((p) => p.estado === pedido.estado);
    PASOS_PROGRESO.forEach((paso, i) => {
      if (i > 0) {
        const linea = document.createElement('span');
        linea.className = `progreso__linea${i <= actual ? ' is-hecha' : ''}`;
        contenedor.appendChild(linea);
      }
      const div = document.createElement('div');
      div.className = `progreso__paso${i <= actual ? ' is-hecho' : ''}${i === actual ? ' is-actual' : ''}`;
      const punto = document.createElement('span');
      punto.className = 'progreso__punto';
      const etiqueta = document.createElement('span');
      etiqueta.className = 'progreso__etiqueta';
      etiqueta.textContent = paso.etiqueta;
      div.append(punto, etiqueta);
      contenedor.appendChild(div);
    });
    return contenedor;
  }

  function crearFilaMiPedido(pedido) {
    const fila = document.createElement('div');
    fila.className = 'mi-pedido';

    const cabecera = document.createElement('div');
    cabecera.className = 'mi-pedido__cabecera';
    const fecha = document.createElement('span');
    fecha.className = 'mi-pedido__fecha';
    const numero = document.createElement('span');
    numero.className = 'mi-pedido__numero';
    numero.textContent = pedido.numero ? `#${pedido.numero}` : '';
    fecha.append(numero, document.createTextNode(`${pedido.numero ? ' · ' : ''}${formatearFechaPedido(pedido.creadoEn)}`));
    const estado = document.createElement('span');
    estado.className = `mi-pedido__estado mi-pedido__estado--${pedido.estado}`;
    estado.textContent = ESTADOS_PEDIDO[pedido.estado] || pedido.estado;
    cabecera.append(fecha, estado);

    const resumen = document.createElement('p');
    resumen.className = 'mi-pedido__resumen';
    resumen.textContent = pedido.items.map((it) => `${it.cantidad}× ${it.nombre}`).join(', ');

    fila.append(cabecera);
    if (pedido.estado !== 'cancelado') fila.appendChild(crearProgreso(pedido));
    fila.append(resumen);

    if (pedido.fueraDeHorario && ['nuevo', 'en_preparacion'].includes(pedido.estado) && pedido.mensajeEntrega) {
      const aviso = document.createElement('p');
      aviso.className = 'mi-pedido__aviso';
      aviso.textContent = pedido.mensajeEntrega;
      fila.appendChild(aviso);
    }

    // Pedidos viejos (de antes de agregar el envío) no tienen envioCup — en
    // ese caso se muestra solo el total, como antes.
    if (pedido.envioCup !== undefined && pedido.envioCup !== null) {
      const desglose = document.createElement('p');
      desglose.className = 'mi-pedido__envio';
      desglose.textContent = `Subtotal ${formatearCup(pedido.totalCup)} CUP + envío ${pedido.envioGratis ? 'gratis' : `${formatearCup(pedido.envioCup)} CUP`}${pedido.metodoPago ? ` · ${pedido.metodoPago.nombre}` : ''}`;
      fila.appendChild(desglose);
    }

    const total = document.createElement('p');
    total.className = 'mi-pedido__total';
    const totalAPagar = pedido.totalConEnvioCup !== undefined ? pedido.totalConEnvioCup : pedido.totalCup;
    total.textContent = `Total: ${formatearCup(totalAPagar)} CUP`;
    fila.appendChild(total);

    const acciones = document.createElement('div');
    acciones.className = 'mi-pedido__acciones';

    // Solo se puede cancelar mientras el pedido sigue "nuevo" (el admin
    // todavía no empezó a prepararlo).
    if (pedido.estado === ESTADO_CANCELABLE) {
      const btnCancelar = document.createElement('button');
      btnCancelar.type = 'button';
      btnCancelar.className = 'btn btn--fantasma btn--chico';
      btnCancelar.textContent = 'Cancelar pedido';
      btnCancelar.addEventListener('click', () => cancelarPedido(pedido.id, btnCancelar));
      acciones.appendChild(btnCancelar);
    }

    // "Pedir de nuevo": copia los platos y los datos de entrega al carrito.
    const btnRepetir = document.createElement('button');
    btnRepetir.type = 'button';
    btnRepetir.className = 'btn btn--principal btn--chico';
    btnRepetir.textContent = '🔁 Pedir de nuevo';
    btnRepetir.addEventListener('click', () => pedirDeNuevo(pedido));
    acciones.appendChild(btnRepetir);

    fila.appendChild(acciones);
    return fila;
  }

  function pedirDeNuevo(pedido) {
    const faltan = [];
    const nuevoCarrito = {};
    pedido.items.forEach((it) => {
      const prod = state.productos.find((p) => p.id === it.productoId);
      if (!prod || prod.agotado) { faltan.push(it.nombre); return; }
      let cant = it.cantidad;
      if (prod.maximoPorPedido) cant = Math.min(cant, prod.maximoPorPedido);
      if (prod.quedan) cant = Math.min(cant, prod.quedan);
      nuevoCarrito[prod.id] = cant;
    });
    if (Object.keys(nuevoCarrito).length === 0) {
      mostrarToast('Ninguno de esos platos está disponible ahora.');
      return;
    }
    state.carrito = nuevoCarrito;
    guardarCarrito();
    actualizarBadgeCarrito();
    renderLista();

    // Datos de entrega del pedido anterior
    const c = pedido.cliente || {};
    el.campoNombre.value = c.nombre || el.campoNombre.value;
    el.campoTelefono.value = c.telefono || el.campoTelefono.value;
    el.campoMunicipio.value = c.municipio || '';
    el.campoDireccion.value = c.direccion || '';
    el.campoNota.value = c.nota || '';
    state.ubicacionSeleccionada = c.ubicacion ? { lat: c.ubicacion.lat, lng: c.ubicacion.lng } : null;
    actualizarEstadoUbicacion();

    cerrarPedidosCliente();
    setTimeout(abrirCarrito, 250);
    if (faltan.length) {
      mostrarToast(`No están disponibles ahora: ${faltan.join(', ')}.`);
    }
  }

  async function cancelarPedido(id, boton) {
    if (!window.confirm('¿Seguro que quieres cancelar este pedido?')) return;
    boton.disabled = true;
    boton.textContent = 'Cancelando…';
    try {
      await peticion(`/api/public/orders/${id}/cancelar`, { method: 'POST' });
      estadosConocidos[id] = 'cancelado';
      mostrarToast('Pedido cancelado.');
      cargarMisPedidos();
    } catch (err) {
      mostrarToast(err.message);
      boton.disabled = false;
      boton.textContent = 'Cancelar pedido';
    }
  }

  // ---------- Sondeo: avisar al cliente de cambios de estado en sus pedidos ----------
  const INTERVALO_SONDEO_CUENTA = 15000; // 15s
  // Cambios en los pedidos del cliente que todavía no vio (hace parpadear el título).
  let avisosSinLeer = 0;
  function limpiarAvisosPedidos() {
    avisosSinLeer = 0;
    if (window.AvisoTitulo) window.AvisoTitulo.establecer(0);
  }

  async function revisarMisPedidosCambios() {
    if (!state.cuenta) return;
    try {
      const pedidos = await peticion('/api/public/mis-pedidos');
      const sheetAbierto = el.sheetPedidosCliente.classList.contains('is-abierto');

      pedidos.forEach((p) => {
        const anterior = estadosConocidos[p.id];
        const num = p.numero ? ` #${p.numero}` : '';
        const hayCambio = (anterior !== undefined && anterior !== p.estado)
          || (edicionesConocidas[p.id] !== undefined && (p.editadoEn || null) !== edicionesConocidas[p.id]);
        if (hayCambio && !sheetAbierto) avisosSinLeer += 1;
        if (anterior !== undefined && anterior !== p.estado) {
          // Aviso bien visible que se queda hasta que el cliente lo cierre a
          // mano — un toast normal desaparece solo y se puede pasar por alto.
          const etiqueta = ESTADOS_PEDIDO[p.estado] || p.estado;
          if (window.Alertas) {
            window.Alertas.mostrar(`Tu pedido${num} ahora está: ${etiqueta}.`, p.estado === 'cancelado' ? 'cancelado' : 'cambio');
          } else {
            mostrarToast(`Tu pedido${num} ahora está: ${etiqueta}.`);
          }
        } else if (edicionesConocidas[p.id] !== undefined && (p.editadoEn || null) !== edicionesConocidas[p.id]) {
          const msg = `La tienda modificó tu pedido${num}. Revisa los detalles en "Mis pedidos".`;
          if (window.Alertas) window.Alertas.mostrar(msg, 'cambio'); else mostrarToast(msg);
        }
        estadosConocidos[p.id] = p.estado;
        edicionesConocidas[p.id] = p.editadoEn || null;
      });

      state.ultimosPedidos = pedidos;
      actualizarBadgePedidosCliente(pedidos);
      if (window.AvisoTitulo) window.AvisoTitulo.establecer(avisosSinLeer, avisosSinLeer === 1 ? 'Tu pedido cambió' : 'Novedades en tus pedidos');
      // Si el cliente ya está mirando la lista, la refrescamos al toque.
      if (sheetAbierto) renderMisPedidos(pedidos);
    } catch (_) { /* sondeo silencioso */ }
  }

  // ---------- Ubicación en el mapa (obligatoria, solo La Habana) ----------
  // Se suma a la dirección escrita a mano, no la reemplaza — el repartidor
  // necesita un punto exacto además del texto, así que ahora es requisito
  // para poder confirmar el pedido (ver validación en el submit más abajo).
  //
  // Leaflet + OpenStreetMap, servidos localmente (sin clave de API, sin
  // tarjeta, sin registro en ningún lado — ver public/vendor/leaflet/).
  //
  // Todo el arranque del mapa está envuelto en try/catch con mensajes
  // visibles (consola + toast): la vez anterior el botón "no hacía nada" sin
  // ningún error a la vista, lo cual es peor que un error — así, si algo
  // vuelve a fallar (por ejemplo, un bloqueador de contenido corta los tiles
  // de OpenStreetMap), el cliente lo ve en vez de quedarse mirando un botón
  // muerto.
  const HABANA_CENTRO = [23.1136, -82.3666];
  // Debe coincidir con HABANA_BOUNDS en src/config.js — usado acá también
  // para el botón "Mi ubicación" (descartar una posición GPS fuera de zona)
  // además de para los límites de arrastre/zoom del mapa más abajo.
  const HABANA_BOUNDS_CLIENTE = { latMin: 22.93, latMax: 23.20, lngMin: -82.55, lngMax: -82.20 };

  let mapaInstancia = null;
  let marcadorInstancia = null;
  let ubicacionTemporal = null; // lo que el cliente tocó en el mapa, antes de confirmar

  // Ícono del marcador como SVG en línea (sin archivos de imagen aparte): el
  // ícono por defecto de Leaflet depende de tres PNG servidos por separado
  // (marker-icon.png, marker-icon-2x.png, marker-shadow.png) y su detección
  // automática de la carpeta puede fallar según cómo el navegador reporte la
  // URL del script — eso causaba un 404 en marker-shadow.png. Con un
  // L.divIcon con SVG embebido no hay ningún archivo que pueda faltar: el
  // ícono viaja dentro del propio JS. La "sombra" se logra con un filtro CSS
  // (ver .marcador-ubicacion en styles.css) en vez de una imagen aparte.
  const SVG_MARCADOR = `
    <svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.716 23.284 0 15 0z" fill="#F2318C"/>
      <circle cx="15" cy="15" r="6" fill="#ffffff"/>
    </svg>
  `;
  const iconoUbicacion = L.divIcon({
    className: 'marcador-ubicacion',
    html: SVG_MARCADOR,
    iconSize: [30, 42],
    iconAnchor: [15, 42], // la punta del pin señala el punto exacto
  });

  function inicializarMapa() {
    if (mapaInstancia) return;

    if (typeof L === 'undefined') {
      throw new Error('No se pudo cargar el mapa (Leaflet). Intenta recargar la página.');
    }

    const { latMin, latMax, lngMin, lngMax } = HABANA_BOUNDS_CLIENTE;
    const bounds = L.latLngBounds([latMin, lngMin], [latMax, lngMax]);
    mapaInstancia = L.map(el.mapaPedido, {
      center: HABANA_CENTRO,
      zoom: 12,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: bounds,
      maxBoundsViscosity: 1.0, // no deja "escaparse" del rectángulo al arrastrar
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(mapaInstancia);
    mapaInstancia.on('click', (e) => colocarMarcador(e.latlng));
  }

  function colocarMarcador(latlng) {
    ubicacionTemporal = { lat: latlng.lat, lng: latlng.lng };
    if (marcadorInstancia) marcadorInstancia.setLatLng(latlng);
    else marcadorInstancia = L.marker(latlng, { icon: iconoUbicacion }).addTo(mapaInstancia);
    el.btnConfirmarUbicacion.disabled = false;
  }

  function quitarMarcador() {
    ubicacionTemporal = null;
    if (marcadorInstancia && mapaInstancia) {
      mapaInstancia.removeLayer(marcadorInstancia);
      marcadorInstancia = null;
    }
    el.btnConfirmarUbicacion.disabled = true;
  }

  function actualizarEstadoUbicacion() {
    if (state.ubicacionSeleccionada) {
      el.ubicacionEstado.textContent = '✓ Ubicación marcada en el mapa.';
      el.ubicacionEstado.hidden = false;
    } else {
      el.ubicacionEstado.hidden = true;
    }
  }

  function abrirMapa() {
    el.overlayMapa.hidden = false;
    el.sheetMapa.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetMapa.classList.add('is-abierto'));

    try {
      inicializarMapa();
      if (state.ubicacionSeleccionada) {
        const latlng = L.latLng(state.ubicacionSeleccionada.lat, state.ubicacionSeleccionada.lng);
        mapaInstancia.setView(latlng, 15);
        colocarMarcador(latlng);
      } else {
        quitarMarcador();
      }
      // El mapa se crea mientras el sheet todavía está "entrando" — recalculamos
      // el tamaño una vez que termina de mostrarse, si no los tiles salen mal recortados.
      setTimeout(() => { if (mapaInstancia) mapaInstancia.invalidateSize(); }, 250);
    } catch (err) {
      // Antes esto podía fallar en silencio — ahora queda tanto en la
      // consola (para depurar) como avisado al cliente (para que sepa que
      // puede seguir con solo la dirección escrita).
      console.error('No se pudo iniciar el mapa:', err);
      mostrarToast('No se pudo cargar el mapa. Puedes seguir escribiendo la dirección a mano.');
      cerrarMapa();
    }
  }

  function cerrarMapa() {
    el.sheetMapa.classList.remove('is-abierto');
    el.sheetMapa.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayMapa.hidden = true; }, 200);
  }

  el.btnElegirUbicacion.addEventListener('click', abrirMapa);
  el.btnCerrarMapa.addEventListener('click', cerrarMapa);
  el.overlayMapa.addEventListener('click', cerrarMapa);

  el.btnQuitarUbicacion.addEventListener('click', () => {
    state.ubicacionSeleccionada = null;
    quitarMarcador();
    actualizarEstadoUbicacion();
  });

  el.btnConfirmarUbicacion.addEventListener('click', () => {
    if (!ubicacionTemporal) return;
    state.ubicacionSeleccionada = ubicacionTemporal;
    actualizarEstadoUbicacion();
    cerrarMapa();
    mostrarToast('Ubicación marcada en el mapa.');
  });

  // "Mi ubicación": usa el GPS/geolocalización del navegador para centrar el
  // mapa y colocar el marcador solo, sin que el cliente tenga que buscar su
  // punto a mano. Sigue siendo un punto de partida nada más — el cliente
  // puede tocar el mapa después para ajustarlo si no quedó exacto, y todavía
  // hay que tocar "Confirmar ubicación" para que quede guardado.
  el.btnMiUbicacion.addEventListener('click', () => {
    if (!navigator.geolocation) {
      mostrarToast('Tu navegador no admite geolocalización. Marca el punto a mano en el mapa.');
      return;
    }

    el.btnMiUbicacion.disabled = true;
    const textoOriginal = el.btnMiUbicacion.textContent;
    el.btnMiUbicacion.textContent = 'Localizando…';

    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        el.btnMiUbicacion.disabled = false;
        el.btnMiUbicacion.textContent = textoOriginal;
        const latlng = L.latLng(posicion.coords.latitude, posicion.coords.longitude);
        const { latMin, latMax, lngMin, lngMax } = HABANA_BOUNDS_CLIENTE;
        if (latlng.lat < latMin || latlng.lat > latMax || latlng.lng < lngMin || latlng.lng > lngMax) {
          mostrarToast('Tu ubicación actual parece estar fuera de La Habana — marca el punto a mano.');
          return;
        }
        mapaInstancia.setView(latlng, 16);
        colocarMarcador(latlng);
      },
      (err) => {
        el.btnMiUbicacion.disabled = false;
        el.btnMiUbicacion.textContent = textoOriginal;
        const mensajes = {
          1: 'Permiso de ubicación denegado. Puedes marcar el punto a mano en el mapa.',
          2: 'No se pudo determinar tu ubicación. Puedes marcar el punto a mano en el mapa.',
          3: 'La búsqueda de ubicación tardó demasiado. Puedes marcar el punto a mano en el mapa.',
        };
        mostrarToast(mensajes[err.code] || 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });

  // ---------- Enviar pedido ----------
  function nuevaClave() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (_) { /* ignorar */ }
    return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  }

  // La clave de idempotencia está ligada al contenido del pedido: si el
  // cliente toca dos veces (o reintenta tras un corte de red) se envía la
  // MISMA clave y el servidor devuelve el mismo pedido en vez de duplicarlo;
  // si cambia algo del pedido, se genera una clave nueva.
  function claveParaPayload(payload) {
    const firma = JSON.stringify([payload.items, payload.cliente, payload.metodoPago]);
    if (!state.claveEnvio || state.claveEnvio.firma !== firma) state.claveEnvio = { firma, clave: nuevaClave() };
    return state.claveEnvio.clave;
  }

  el.formPedido.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.enviando) return; // protección contra doble toque
    el.formError.hidden = true;

    const items = itemsCarrito();
    if (items.length === 0) {
      el.formError.textContent = 'Agrega al menos un plato a tu pedido.';
      el.formError.hidden = false;
      return;
    }

    if (!el.campoMunicipio.value) {
      el.formError.textContent = 'Selecciona tu municipio.';
      el.formError.hidden = false;
      return;
    }

    if (!state.ubicacionSeleccionada) {
      el.formError.textContent = 'Marca tu ubicación en el mapa antes de confirmar el pedido.';
      el.formError.hidden = false;
      return;
    }

    const payload = {
      cliente: {
        nombre: el.campoNombre.value.trim(),
        telefono: el.campoTelefono.value.trim(),
        municipio: el.campoMunicipio.value,
        direccion: el.campoDireccion.value.trim(),
        nota: el.campoNota.value.trim(),
        ubicacion: state.ubicacionSeleccionada,
      },
      items: items.map(({ producto, cantidad }) => ({ productoId: producto.id, cantidad })),
      metodoPago: state.pagoSeleccionado,
    };
    payload.clave = claveParaPayload(payload);

    state.enviando = true;
    actualizarBotonPedido();

    try {
      const pedido = await peticion('/api/public/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      state.claveEnvio = null;
      state.carrito = {};
      guardarCarrito();
      renderLista();
      actualizarBadgeCarrito();
      cerrarCarrito();
      el.formPedido.reset();
      prefillDatosCliente();
      // La ubicación es por pedido — el próximo pedido empieza sin ninguna marcada.
      state.ubicacionSeleccionada = null;
      quitarMarcador();
      actualizarEstadoUbicacion();
      setTimeout(() => mostrarConfirmacion(pedido), 250);
      // Refrescamos "Mis pedidos" y el menú (el stock cambió).
      cargarMisPedidos();
      cargarMenu();
    } catch (err) {
      el.formError.textContent = err.red
        ? `${err.message} No te preocupes: si el pedido llegó a enviarse, no se duplicará al reintentar.`
        : err.message;
      el.formError.hidden = false;
      // Un error de negocio (stock, mínimo…) puede cambiar el menú: lo refrescamos.
      if (err.status === 400 || err.status === 409) cargarMenu();
    } finally {
      state.enviando = false;
      actualizarBotonPedido();
    }
  });

  // ---------- Confirmación del pedido ----------
  function mostrarConfirmacion(pedido) {
    const box = el.confirmacionContenido;
    box.innerHTML = '';

    const icono = document.createElement('div');
    icono.className = 'confirmacion__icono';
    icono.textContent = '✓';
    const h3 = document.createElement('h3');
    h3.textContent = '¡Pedido recibido!';
    const numero = document.createElement('div');
    numero.className = 'confirmacion__numero';
    numero.textContent = pedido.numero ? `#${pedido.numero}` : '';
    const texto = document.createElement('p');
    texto.className = 'confirmacion__texto';
    if (pedido.fueraDeHorario && pedido.mensajeEntrega) {
      texto.textContent = pedido.mensajeEntrega;
    } else {
      texto.textContent = `Te avisaremos aquí en cuanto empecemos a prepararlo.${pedido.tiempoEstimado ? ` Tiempo estimado: ${pedido.tiempoEstimado}.` : ''}`;
    }
    box.append(icono, h3);
    if (pedido.numero) box.appendChild(numero);
    box.appendChild(texto);

    const resumen = document.createElement('div');
    resumen.className = 'confirmacion__resumen';
    const ul = document.createElement('ul');
    pedido.items.forEach((it) => {
      const li = document.createElement('li');
      li.textContent = `${it.cantidad}× ${it.nombre}`;
      ul.appendChild(li);
    });
    resumen.appendChild(ul);
    const fila = (a, b, clase) => {
      const f = document.createElement('div');
      f.className = `fila${clase ? ` ${clase}` : ''}`;
      const x = document.createElement('span'); x.textContent = a;
      const y = document.createElement('span'); y.textContent = b;
      f.append(x, y);
      return f;
    };
    resumen.appendChild(fila('Subtotal', `${formatearCup(pedido.totalCup)} CUP`));
    resumen.appendChild(fila(`Envío (${(MUNICIPIOS_HABANA.find((m) => m.id === pedido.cliente.municipio) || {}).nombre || ''})`, pedido.envioGratis ? 'Gratis' : `${formatearCup(pedido.envioCup)} CUP`));
    resumen.appendChild(fila('Total', `${formatearCup(pedido.totalConEnvioCup)} CUP`, 'fila--total'));
    if (pedido.metodoPago) resumen.appendChild(fila('Pago', pedido.metodoPago.nombre));
    resumen.appendChild(fila('Entrega en', `${pedido.cliente.direccion}`));
    box.appendChild(resumen);

    const pagoCfg = state.config && state.config.pedidos.pagos.find((m) => pedido.metodoPago && m.id === pedido.metodoPago.id);
    if (pagoCfg && pagoCfg.instrucciones) {
      const ins = document.createElement('div');
      ins.className = 'confirmacion__pago';
      ins.textContent = `💳 ${pagoCfg.nombre}\n${pagoCfg.instrucciones}`;
      box.appendChild(ins);
    }

    const acciones = document.createElement('div');
    acciones.className = 'form__acciones';
    const b1 = document.createElement('button');
    b1.type = 'button';
    b1.className = 'btn btn--fantasma';
    b1.textContent = 'Seguir viendo el menú';
    b1.addEventListener('click', cerrarConfirmacion);
    const b2 = document.createElement('button');
    b2.type = 'button';
    b2.className = 'btn btn--principal';
    b2.textContent = 'Ver mis pedidos';
    b2.addEventListener('click', () => { cerrarConfirmacion(); setTimeout(abrirPedidosCliente, 250); });
    acciones.append(b1, b2);
    box.appendChild(acciones);

    el.overlayConfirmacion.hidden = false;
    el.sheetConfirmacion.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => el.sheetConfirmacion.classList.add('is-abierto'));
  }

  function cerrarConfirmacion() {
    el.sheetConfirmacion.classList.remove('is-abierto');
    el.sheetConfirmacion.setAttribute('aria-hidden', 'true');
    setTimeout(() => { el.overlayConfirmacion.hidden = true; }, 200);
  }
  el.overlayConfirmacion.addEventListener('click', cerrarConfirmacion);

  // ---------- Instalar como app (PWA) ----------
  let promptInstalacion = null;
  const esStandalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalacion = e;
    el.instalarWrap.hidden = false;
  });
  window.addEventListener('appinstalled', () => { promptInstalacion = null; el.instalarWrap.hidden = true; });
  if (!esStandalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) el.instalarWrap.hidden = false;
  el.btnInstalar.addEventListener('click', async () => {
    if (promptInstalacion) {
      promptInstalacion.prompt();
      try { await promptInstalacion.userChoice; } catch (_) { /* ignorar */ }
      promptInstalacion = null;
      el.instalarWrap.hidden = true;
    } else {
      mostrarToast('En Safari toca Compartir y luego "Añadir a pantalla de inicio".');
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  // ---------- Inicio ----------
  cargarMenu();
  setInterval(() => { if (!document.hidden) revisarMisPedidosCambios(); }, INTERVALO_SONDEO_CUENTA);
  // Refresco silencioso del menú (stock, horario, precios) cada minuto, y al
  // volver a la pestaña o recuperar la conexión.
  setInterval(() => { if (!document.hidden && state.menuCargado && !state.enviando) cargarMenu(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.menuCargado) cargarMenu(); });
  window.addEventListener('online', () => { if (state.menuCargado) cargarMenu(); });
  window.addEventListener('offline', () => mostrarBanner('Sin conexión a internet. Puedes ver el menú, pero para pedir necesitas conexión.', true));
})();
