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

// Fase A (multi-tenant): todo router de datos usa auth() + requireEmpresa()
// juntos. Sin esto, un token de una versión anterior (sin empresa_id) o un
// preAuthToken (que a propósito no lleva empresa_id, ver routes/auth.js)
// pasaría auth() sin problema y terminaría filtrando cada consulta por
// "empresa_id = undefined" -- Postgres no lanza error ahí, simplemente no
// encuentra nada, y eso se ve igual que "esta empresa no tiene datos" en
// vez de un error claro de sesión vencida.
export function requireEmpresa(req, res, next) {
  if (!req.usuario?.empresa_id) {
    return res.status(401).json({ error: 'Tu sesión es de una versión anterior. Vuelve a iniciar sesión.' });
  }
  next();
}
