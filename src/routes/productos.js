// CRUD de platos (protegido). Montado en /api/products.

const express = require('express');
const crypto = require('crypto');
const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { eliminarImagenSubida } = require('../lib/imagenes');
const { validateProductInput } = require('../validators/productos');
const { PRODUCTS_FILE, CATEGORIES_FILE } = require('../config');
const Ajustes = require('../lib/ajustes');
const Pedidos = require('../services/pedidos');

// Ajusta stockFecha / stock inicial cuando se configura la reposición diaria.
function normalizarStock(value, hoy, actual) {
  const rep = value.reponerDiario !== undefined ? value.reponerDiario : actual && actual.reponerDiario;
  if (rep !== null && rep !== undefined) {
    value.stockFecha = hoy;
    const st = value.stock !== undefined ? value.stock : actual && actual.stock;
    if (st === null || st === undefined) value.stock = rep;
  }
  return value;
}

const router = express.Router();

// Obtener todos los productos
router.get('/', async (req, res) => {
  try {
    const productos = await Pedidos.leerProductos();
    // Más nuevos primero
    productos.sort((a, b) => new Date(b.creadoEn) - new Date(a.creadoEn));
    res.json(productos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar los platos.' });
  }
});

// Crear un producto nuevo
router.post('/', async (req, res) => {
  try {
    const categorias = await readJson(CATEGORIES_FILE);
    const { errors, value } = validateProductInput(req.body, categorias);
    if (errors.length) {
      return res.status(400).json({ error: errors[0], errors });
    }

    const hoy = Ajustes.hoyLocal(await Ajustes.obtener());
    const nuevo = {
      id: crypto.randomUUID(),
      stock: null,
      reponerDiario: null,
      ...normalizarStock(value, hoy, null),
      creadoEn: new Date().toISOString(),
    };

    await queueWrite(async () => {
      const productos = await readJson(PRODUCTS_FILE);
      productos.push(nuevo);
      await writeJson(PRODUCTS_FILE, productos);
    });

    res.status(201).json(nuevo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el plato.' });
  }
});

// Actualizar un producto existente
router.put('/:id', async (req, res) => {
  try {
    const categorias = await readJson(CATEGORIES_FILE);
    const { errors, value } = validateProductInput(req.body, categorias);
    if (errors.length) {
      return res.status(400).json({ error: errors[0], errors });
    }

    let actualizado = null;
    let imagenAnterior = null;

    await queueWrite(async () => {
      const productos = await readJson(PRODUCTS_FILE);
      const idx = productos.findIndex((p) => p.id === req.params.id);
      if (idx === -1) return;
      imagenAnterior = productos[idx].imagen;
      normalizarStock(value, Ajustes.hoyLocal(await Ajustes.obtener()), productos[idx]);
      productos[idx] = { ...productos[idx], ...value };
      actualizado = productos[idx];
      await writeJson(PRODUCTS_FILE, productos);
    });

    if (!actualizado) {
      return res.status(404).json({ error: 'El plato no existe.' });
    }

    // Si la imagen cambió, borramos el archivo anterior para no acumular basura
    if (imagenAnterior && imagenAnterior !== value.imagen) {
      await eliminarImagenSubida(imagenAnterior);
    }

    res.json(actualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el plato.' });
  }
});

// Cambiar solo disponibilidad (para el interruptor rápido en la tarjeta)
router.patch('/:id/disponible', async (req, res) => {
  try {
    let actualizado = null;
    await queueWrite(async () => {
      const productos = await readJson(PRODUCTS_FILE);
      const idx = productos.findIndex((p) => p.id === req.params.id);
      if (idx === -1) return;
      productos[idx].disponible = Boolean(req.body.disponible);
      actualizado = productos[idx];
      await writeJson(PRODUCTS_FILE, productos);
    });

    if (!actualizado) {
      return res.status(404).json({ error: 'El plato no existe.' });
    }
    res.json(actualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la disponibilidad.' });
  }
});

// Ajuste rápido del stock (vacío/null = sin control de stock)
router.patch('/:id/stock', async (req, res) => {
  try {
    const crudo = req.body && req.body.stock;
    let stock = null;
    if (crudo !== null && crudo !== undefined && String(crudo).trim() !== '') {
      stock = Number(crudo);
      if (!Number.isInteger(stock) || stock < 0 || stock > 100000) {
        return res.status(400).json({ error: 'El stock debe ser un número entero entre 0 y 100000.' });
      }
    }
    const ajustes = await Ajustes.obtener();
    let actualizado = null;
    let antes = null;
    await queueWrite(async () => {
      const productos = await readJson(PRODUCTS_FILE);
      const idx = productos.findIndex((p) => p.id === req.params.id);
      if (idx === -1) return;
      antes = productos[idx].stock;
      productos[idx].stock = stock;
      if (productos[idx].reponerDiario !== null && productos[idx].reponerDiario !== undefined) {
        productos[idx].stockFecha = Ajustes.hoyLocal(ajustes);
      }
      actualizado = productos[idx];
      await writeJson(PRODUCTS_FILE, productos);
    });
    if (!actualizado) return res.status(404).json({ error: 'El plato no existe.' });
    Pedidos.revisarAlertasStock(antes, stock, actualizado, ajustes.pedidos.stockBajoUmbral);
    res.json(actualizado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el stock.' });
  }
});

// Eliminar un producto
router.delete('/:id', async (req, res) => {
  try {
    let eliminado = false;
    let imagen = null;

    await queueWrite(async () => {
      const productos = await readJson(PRODUCTS_FILE);
      const encontrado = productos.find((p) => p.id === req.params.id);
      if (!encontrado) return;
      imagen = encontrado.imagen;
      const siguiente = productos.filter((p) => p.id !== req.params.id);
      eliminado = true;
      await writeJson(PRODUCTS_FILE, siguiente);
    });

    if (!eliminado) {
      return res.status(404).json({ error: 'El plato no existe.' });
    }

    await eliminarImagenSubida(imagen);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar el plato.' });
  }
});

module.exports = router;
