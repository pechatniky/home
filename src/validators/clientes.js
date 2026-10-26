// Validación de registro/inicio de sesión/perfil de clientes de la tienda.
// Sin verificación de ningún tipo (ni email, ni SMS) — es el diseño más
// simple a propósito: se completan los datos y la cuenta ya queda activa.
//
// El INICIO DE SESIÓN es por EMAIL (antes era por teléfono). El teléfono
// sigue siendo obligatorio al registrarse (se usa para coordinar la entrega).
// El EMAIL no se puede cambiar después desde "Mi perfil" (ver validatePerfil)
// — es el identificador de la cuenta, cambiarlo sería casi como crear una
// cuenta nueva. El TELÉFONO sí se puede cambiar desde el perfil (por ejemplo,
// si el cliente cambia de número) — solo el email queda fijo desde el registro.

// Regex simple y permisiva (no intenta cubrir el estándar completo de email,
// solo lo razonable: algo@algo.algo) — suficiente para atrapar errores de
// tipeo sin rechazar direcciones válidas por ser demasiado estrictos.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// También permisiva a propósito: acepta dígitos, espacios, guiones,
// paréntesis y un "+" inicial (prefijo de país) — cubre tanto números
// cubanos (+53 5xxx xxxx) como de otros países, sin exigir un formato único.
// Exige al menos 7 dígitos en total para descartar valores claramente
// inválidos ("123", "n/a", etc.).
const TELEFONO_REGEX = /^\+?[0-9 ()-]{7,30}$/;

function contarDigitos(texto) {
  return (texto.match(/\d/g) || []).length;
}

function validarEmailBasico(email, errors) {
  if (!email) {
    errors.push('El email es obligatorio.');
  } else if (email.length > 254) {
    errors.push('El email es demasiado largo.');
  } else if (!EMAIL_REGEX.test(email)) {
    errors.push('Ingresa un email válido (por ejemplo: nombre@correo.com).');
  }
}

function validarTelefonoBasico(telefono, errors) {
  if (!telefono) {
    errors.push('El teléfono es obligatorio.');
  } else if (telefono.length > 30) {
    errors.push('El teléfono es demasiado largo (máx. 30 caracteres).');
  } else if (!TELEFONO_REGEX.test(telefono) || contarDigitos(telefono) < 7) {
    errors.push('Ingresa un teléfono válido (solo números, espacios, "+", "-" o paréntesis).');
  }
}

function validateRegistro(body) {
  const errors = [];
  const nombre = String((body && body.nombre) || '').trim();
  const email = String((body && body.email) || '').trim().toLowerCase();
  const telefono = String((body && body.telefono) || '').trim();
  const password = String((body && body.password) || '');
  const direccion = String((body && body.direccion) || '').trim();

  if (!nombre) errors.push('El nombre es obligatorio.');
  if (nombre.length > 80) errors.push('El nombre es demasiado largo (máx. 80 caracteres).');
  validarEmailBasico(email, errors);
  validarTelefonoBasico(telefono, errors);
  if (password.length < 4) errors.push('La contraseña debe tener al menos 4 caracteres.');
  if (direccion.length > 200) errors.push('La dirección es demasiado larga (máx. 200 caracteres).');

  return { errors, value: { nombre, email, telefono, password, direccion } };
}

// Edición de datos desde "Mi perfil": nombre, dirección y ahora también
// teléfono. El email NO se puede tocar acá — es fijo desde el registro. Si el
// cliente llega a mandarlo en el body igual, se ignora silenciosamente (el
// value devuelto ni lo incluye), así que la ruta no tiene forma de pisarlo
// por accidente.
function validatePerfil(body) {
  const errors = [];
  const nombre = String((body && body.nombre) || '').trim();
  const telefono = String((body && body.telefono) || '').trim();
  const direccion = String((body && body.direccion) || '').trim();

  if (!nombre) errors.push('El nombre es obligatorio.');
  if (nombre.length > 80) errors.push('El nombre es demasiado largo (máx. 80 caracteres).');
  validarTelefonoBasico(telefono, errors);
  if (direccion.length > 200) errors.push('La dirección es demasiado larga (máx. 200 caracteres).');

  return { errors, value: { nombre, telefono, direccion } };
}

function validateLogin(body) {
  const errors = [];
  const email = String((body && body.email) || '').trim().toLowerCase();
  const password = String((body && body.password) || '');

  if (!email) errors.push('Ingresa tu email.');
  if (!password) errors.push('Ingresa tu contraseña.');

  return { errors, value: { email, password } };
}

module.exports = { validateRegistro, validateLogin, validatePerfil };
