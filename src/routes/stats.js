// Estadísticas del panel (protegido). Montado en /api/stats.
const express = require('express');
const Stats = require('../services/stats');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const periodo = ['hoy', 'ayer', '7d', '30d', 'todo'].includes(req.query.periodo) ? req.query.periodo : '7d';
    res.set('Cache-Control', 'no-store');
    res.json(await Stats.calcular(periodo));
  } catch (err) { next(err); }
});

module.exports = router;
