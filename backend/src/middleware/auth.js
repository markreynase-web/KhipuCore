// src/middleware/auth.js
// Primera pieza del pipeline auth() → verificarPermiso() → CRUD.
// Por ahora solo valida que el token sea válido y adjunta el usuario a
// req.usuario; verificarPermiso() (Fase 4, pasos 2-3) vendrá después y sí
// va a decidir qué puede hacer ese usuario según su rol.

import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

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

// Hasta ahora, `empresa_modulos` solo se leía para armar el sidebar
// (routes/empresa.js) -- un usuario con el permiso de rol correcto podía
// pegarle igual a la API de un módulo que su empresa nunca contrató, solo
// porque el módulo no aparecía en su menú. Este middleware es el candado
// real: se consulta la base en cada request (a propósito, NO se congela en
// el JWT como los permisos -- ver la nota de trade-off en permisos.js). Un
// módulo puede pasar a estar desactivado en cualquier momento (por ejemplo,
// si el super admin lo apaga por falta de pago) y eso debe bloquear la API
// de inmediato, no recién cuando venza el token de 8h.
export function requireModulo(moduloId) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT 1 FROM empresa_modulos WHERE empresa_id = $1 AND modulo_id = $2',
        [req.usuario.empresa_id, moduloId]
      );
      if (!rows.length) {
        return res.status(403).json({ error: `Tu empresa no tiene el módulo "${moduloId}" habilitado.` });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'No se pudo verificar el acceso al módulo.' });
    }
  };
}

// Panel de super administrador: rutas que cruzan empresas a propósito (dar
// de alta una empresa, habilitar sus módulos, crear su primer admin) --
// nunca se usa junto con requireEmpresa(), son sesiones mutuamente
// excluyentes (ver routes/auth.js).
export function requireSuperAdmin(req, res, next) {
  if (!req.usuario?.es_super_admin) {
    return res.status(403).json({ error: 'Esta acción requiere una cuenta de super administrador.' });
  }
  next();
}
