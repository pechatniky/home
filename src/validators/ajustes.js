// Validación de la configuración general (Ajustes): tipo de cambio y costo
// de envío por municipio (de La Habana — el negocio reparte solo ahí).

const { MUNICIPIOS_HABANA } = require('../config');

const COSTO_ENVIO_MAXIMO = 100000; // CUP — tope defensivo contra valores absurdos por error de tipeo

// Recibe { [municipioId]: numero, ... } y valida cada municipio conocido.
// Los municipios que falten en el body se guardan en 0 (sin costo definido
// todavía) en vez de rechazar la petición — así el admin puede ir llenando
// de a uno si quiere, sin tener que mandar los 15 siempre.
function validateEnviosPorMunicipio(bodyEnvios) {
  const errors = [];
  const value = {};

  if (bodyEnvios === null || typeof bodyEnvios !== 'object') {
    return { errors: ['El costo de envío no es válido.'], value: {} };
  }

  MUNICIPIOS_HABANA.forEach(({ id, nombre }) => {
    const crudo = bodyEnvios[id];
    if (crudo === undefined) {
      value[id] = 0;
      return;
    }
    const numero = Number(crudo);
    if (!Number.isFinite(numero) || numero < 0) {
      errors.push(`El envío para "${nombre}" debe ser un número mayor o igual a 0.`);
      return;
    }
    if (numero > COSTO_ENVIO_MAXIMO) {
      errors.push(`El envío para "${nombre}" parece demasiado alto. Revisa el valor.`);
      return;
    }
    value[id] = Math.round(numero * 100) / 100;
  });

  return { errors, value };
}

module.exports = { validateEnviosPorMunicipio };
