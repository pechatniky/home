// CRUD de categorías (protegido). Montado en /api/categories.

const express = require('express');
const { readJson, writeJson, queueWrite } = require('../lib/jsonStore');
const { slugify } = require('../lib/slugify');
const { CATEGORIES_FILE, PRODUCTS_FILE } = require('../config');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const categorias = await readJson(CATEGORIES_FILE);
    res.json(categorias);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron cargar las categorías.' });
  }
});

router.post('/', async (req, res) => {
  try {
    const nombre = String((req.body && req.body.nombre) || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
    if (nombre.length > 40) return res.status(400).json({ error: 'El nombre es demasiado largo (máx. 40 caracteres).' });

    let nueva = null;
    let error = null;

    await queueWrite(async () => {
      const categorias = await readJson(CATEGORIES_FILE);

      if (categorias.some((c) => c.nombre.toLowerCase() === nombre.toLowerCase())) {
        error = 'Ya existe una categoría con ese nombre.';
        return;
      }

      let id = slugify(nombre) || 'categoria';
      let sufijo = 2;
      while (categorias.some((c) => c.id === id)) {
        id = `${slugify(nombre)}-${sufijo}`;
        sufijo += 1;
      }

      nueva = { id, nombre };
      categorias.push(nueva);
      await writeJson(CATEGORIES_FILE, categorias);
    });

    if (error) return res.status(400).json({ error });
    res.status(201).json(nueva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la categoría.' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const nombre = String((req.body && req.body.nombre) || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio.' });
    if (nombre.length > 40) return res.status(400).json({ error: 'El nombre es demasiado largo (máx. 40 caracteres).' });

    let actualizada = null;
    let error = null;

    await queueWrite(async () => {
      const categorias = await readJson(CATEGORIES_FILE);
      const idx = categorias.findIndex((c) => c.id === req.params.id);
      if (idx === -1) {
        error = 'not-found';
        return;
      }
      if (categorias.some((c) => c.id !== req.params.id && c.nombre.toLowerCase() === nombre.toLowerCase())) {
        error = 'Ya existe una categoría con ese nombre.';
        return;
      }
      categorias[idx].nombre = nombre;
      actualizada = categorias[idx];
      await writeJson(CATEGORIES_FILE, categorias);
    });

    if (error === 'not-found') return res.status(404).json({ error: 'La categoría no existe.' });
    if (error) return res.status(400).json({ error });
    res.json(actualizada);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la categoría.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    let error = null;
    let eliminada = false;

    await queueWrite(async () => {
      const [categorias, productos] = await Promise.all([readJson(CATEGORIES_FILE), readJson(PRODUCTS_FILE)]);
      const enUso = productos.filter((p) => p.categoria === req.params.id).length;
      if (enUso > 0) {
        error = `No se puede eliminar: ${enUso} ${enUso === 1 ? 'plato usa' : 'platos usan'} esta categoría.`;
        return;
      }
      const siguiente = categorias.filter((c) => c.id !== req.params.id);
      eliminada = siguiente.length !== categorias.length;
      if (eliminada) await writeJson(CATEGORIES_FILE, siguiente);
    });

    if (error) return res.status(400).json({ error });
    if (!eliminada) return res.status(404).json({ error: 'La categoría no existe.' });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la categoría.' });
  }
});

module.exports = router;
