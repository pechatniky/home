// Валидация данных при оформлении заказа клиентом (без авторизации —
// клиент вводит свои данные вручную при каждом заказе).

const { HABANA_BOUNDS, MUNICIPIOS_HABANA } = require('../config');

const IDS_MUNICIPIOS_VALIDOS = new Set(MUNICIPIOS_HABANA.map((m) => m.id));

// Municipio de entrega (dentro de La Habana) — obligatorio. Cualquier valor
// que no esté en la lista de los 15 municipios se rechaza como inválido.
// Nunca se confía en el <select> del navegador: se revisa igual acá.
function validateMunicipio(municipioCrudo) {
  const municipio = String(municipioCrudo || '').trim();
  if (!municipio) {
    return { error: 'Selecciona tu municipio.', value: '' };
  }
  if (!IDS_MUNICIPIOS_VALIDOS.has(municipio)) {
    return { error: 'El municipio seleccionado no es válido.', value: '' };
  }
  return { error: null, value: municipio };
}

// Ubicación marcada en el mapa — ahora obligatoria (además de la dirección
// escrita a mano, no en lugar de ella): sin un punto marcado no se puede
// coordinar bien la entrega. Nunca confiamos en que el navegador ya la
// restringió a La Habana — se vuelve a chequear acá.
function validateUbicacion(ubicacionCruda) {
  if (ubicacionCruda === null || ubicacionCruda === undefined || typeof ubicacionCruda !== 'object') {
    return { error: 'Marca tu ubicación en el mapa.', value: null };
  }

  const lat = Number(ubicacionCruda.lat);
  const lng = Number(ubicacionCruda.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { error: 'La ubicación marcada en el mapa no es válida.', value: null };
  }
  const { latMin, latMax, lngMin, lngMax } = HABANA_BOUNDS;
  if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) {
    return { error: 'La ubicación marcada en el mapa debe estar dentro de La Habana.', value: null };
  }
  return { error: null, value: { lat, lng } };
}

// Datos del cliente escritos a mano en el formulario de pedido.
function validateClienteInput(clienteCrudo) {
  const errors = [];
  const cliente = clienteCrudo || {};
  const nombre = String(cliente.nombre || '').trim();
  const telefono = String(cliente.telefono || '').trim();
  const direccion = String(cliente.direccion || '').trim();
  const nota = String(cliente.nota || '').trim();

  if (!nombre) errors.push('El nombre es obligatorio.');
  if (nombre.length > 80) errors.push('El nombre es demasiado largo (máx. 80 caracteres).');
  if (!telefono) errors.push('El teléfono es obligatorio.');
  if (telefono.length > 30) errors.push('El teléfono es demasiado largo (máx. 30 caracteres).');
  if (!direccion) errors.push('La dirección de entrega es obligatoria.');
  if (direccion.length > 200) errors.push('La dirección es demasiado larga (máx. 200 caracteres).');
  if (nota.length > 300) errors.push('La nota es demasiado larga (máx. 300 caracteres).');

  const { error: errorUbicacion, value: ubicacion } = validateUbicacion(cliente.ubicacion);
  if (errorUbicacion) errors.push(errorUbicacion);

  const { error: errorMunicipio, value: municipio } = validateMunicipio(cliente.municipio);
  if (errorMunicipio) errors.push(errorMunicipio);

  return { errors, value: { nombre, telefono, direccion, nota, ubicacion, municipio } };
}

// Edición de los datos del cliente por el administrador: cada campo es
// opcional (si no viene, se conserva el actual). La ubicación del mapa no se
// toca desde acá.
function validateClienteEditable(crudo, actual) {
  const errors = [];
  const tomar = (k) => (crudo[k] !== undefined ? String(crudo[k] || '').trim() : actual[k] || '');
  const nombre = tomar('nombre');
  const telefono = tomar('telefono');
  const direccion = tomar('direccion');
  const nota = tomar('nota');
  const municipio = crudo.municipio !== undefined ? String(crudo.municipio || '').trim() : actual.municipio;

  if (!nombre) errors.push('El nombre es obligatorio.');
  if (nombre.length > 80) errors.push('El nombre es demasiado largo (máx. 80 caracteres).');
  if (!telefono) errors.push('El teléfono es obligatorio.');
  if (telefono.length > 30) errors.push('El teléfono es demasiado largo (máx. 30 caracteres).');
  if (!direccion) errors.push('La dirección de entrega es obligatoria.');
  if (direccion.length > 200) errors.push('La dirección es demasiado larga (máx. 200 caracteres).');
  if (nota.length > 300) errors.push('La nota es demasiado larga (máx. 300 caracteres).');
  if (municipio !== actual.municipio) {
    const { error } = validateMunicipio(municipio);
    if (error) errors.push(error);
  }
  return { errors, value: { nombre, telefono, direccion, nota, municipio } };
}

module.exports = { validateClienteInput, validateClienteEditable };
