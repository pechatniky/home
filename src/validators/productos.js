// Валидация входных данных товара (общая для создания и обновления).

const UNIDADES_PORCION = ['g', 'kg', 'ml', 'l'];

function validateProductInput(body, categorias) {
  const errors = [];
  const nombre = String(body.nombre || '').trim();
  const descripcion = String(body.descripcion || '').trim();
  const precio = Number(body.precio);
  const categoria = String(body.categoria || '').trim();
  const imagen = String(body.imagen || '').trim();
  const disponible = Boolean(body.disponible);

  if (!nombre) errors.push('El nombre del plato es obligatorio.');
  if (nombre.length > 80) errors.push('El nombre es demasiado largo (máx. 80 caracteres).');
  if (descripcion.length > 300) errors.push('La descripción es demasiado larga (máx. 300 caracteres).');
  if (Number.isNaN(precio) || precio < 0) errors.push('El precio debe ser un número igual o mayor a 0.');
  if (!categoria) {
    errors.push('Selecciona una categoría.');
  } else if (!categorias.some((c) => c.id === categoria)) {
    errors.push('La categoría seleccionada no existe.');
  }

  // Peso o volumen de la porción — opcional
  let porcion = null;
  const pesoValorCrudo = body.pesoValor;
  const tienePeso = pesoValorCrudo !== undefined && pesoValorCrudo !== null && String(pesoValorCrudo).trim() !== '';
  if (tienePeso) {
    const valor = Number(pesoValorCrudo);
    const unidad = String(body.pesoUnidad || '').trim();
    if (Number.isNaN(valor) || valor <= 0) {
      errors.push('El peso o volumen debe ser un número mayor a 0.');
    } else if (!UNIDADES_PORCION.includes(unidad)) {
      errors.push('Selecciona una unidad válida (g, kg, ml o l).');
    } else {
      porcion = { valor: Math.round(valor * 100) / 100, unidad };
    }
  }

  // Cantidad máxima por pedido — opcional, sin límite si se deja vacío
  let maximoPorPedido = null;
  const maximoCrudo = body.maximoPorPedido;
  const tieneMaximo = maximoCrudo !== undefined && maximoCrudo !== null && String(maximoCrudo).trim() !== '';
  if (tieneMaximo) {
    const maximo = Number(maximoCrudo);
    if (!Number.isInteger(maximo) || maximo <= 0) {
      errors.push('La cantidad máxima por pedido debe ser un número entero mayor a 0.');
    } else {
      maximoPorPedido = maximo;
    }
  }

  const value = {
    nombre,
    descripcion,
    precio: Math.round(precio * 100) / 100,
    categoria,
    imagen,
    disponible,
    porcion,
    maximoPorPedido,
  };

  // Stock (existencias): "stock" = cuántas porciones quedan (vacío = sin
  // control, ilimitado); "reponerDiario" = a cuánto vuelve el stock cada día
  // (vacío = no se repone solo). Solo se incluyen si vinieron en el body, así
  // un cliente viejo de la API no borra el stock sin querer.
  const leerEnteroOpcional = (clave, etiqueta, max) => {
    if (!(clave in body)) return undefined;
    const crudo = body[clave];
    if (crudo === null || crudo === undefined || String(crudo).trim() === '') return null;
    const n = Number(crudo);
    if (!Number.isInteger(n) || n < 0 || n > max) {
      errors.push(`${etiqueta} debe ser un número entero entre 0 y ${max}.`);
      return undefined;
    }
    return n;
  };
  const stock = leerEnteroOpcional('stock', 'El stock', 100000);
  const reponerDiario = leerEnteroOpcional('reponerDiario', 'La reposición diaria', 100000);
  if (stock !== undefined) value.stock = stock;
  if (reponerDiario !== undefined) value.reponerDiario = reponerDiario;

  return { errors, value };
}

module.exports = { validateProductInput, UNIDADES_PORCION };
