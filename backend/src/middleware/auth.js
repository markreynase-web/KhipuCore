// src/middleware/auth.js
// Primera pieza del pipeline auth() → verificarPermiso() → CRUD.
// Por ahora solo valida que el token sea válido y adjunta el usuario a
// req.usuario; verificarPermiso() (Fase 4, pasos 2-3) vendrá después y sí
// va a decidir qué puede hacer ese usuario según su rol.

import jwt from 'jsonwebtoken';

export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });

  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o vencida. Inicia sesión de nuevo.' });
  }
}
