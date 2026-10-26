// Middleware que exige sesión iniciada para las rutas /api protegidas
// (todo salvo /api/public/* y /api/login).

function requireAuth(req, res, next) {
  if (req.session && req.session.autenticado) return next();
  return res.status(401).json({ error: 'Sesión expirada. Inicia sesión de nuevo.' });
}

module.exports = requireAuth;
