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
// V-05 (auditoría de seguridad): además de confirmar que el módulo esté
// habilitado para la empresa (lo de siempre), esta misma consulta ahora
// también confirma que la membresía del usuario a esa empresa siga activa
// -- mismo viaje a la base de datos, sin round-trip nuevo. Antes, eliminar o
// deshabilitar a alguien (o borrar su usuario_empresa) no cortaba su sesión
// hasta que el JWT expirara solo (hasta 8h): el módulo se revisaba, pero
// nunca si esa persona seguía teniendo derecho a estar en la empresa.
//
// Excepción a propósito: las sesiones de impersonación de soporte
// (ver routes/superadmin.js POST /empresas/:id/impersonar) NUNCA tienen una
// fila real en usuario_empresa -- el super admin no se vincula formalmente a
// la empresa que soporta, es un acceso sintetizado y de corta vida (30 min)
// que ya queda auditado en el momento en que se genera. Exigirles la misma
// fila rompería la impersonación por completo, así que para esas sesiones
// (impersonando:true en el JWT) se sigue validando solo el módulo, igual
// que antes.
export function requireModulo(moduloId) {
  return async (req, res, next) => {
    try {
      const esImpersonacion = req.usuario?.impersonando === true;
      const { rows } = await pool.query(
        esImpersonacion
          ? `SELECT 1 FROM empresa_modulos WHERE empresa_id = $1 AND modulo_id = $2`
          : `SELECT 1 FROM empresa_modulos em
             WHERE em.empresa_id = $1 AND em.modulo_id = $2
               AND EXISTS (
                 SELECT 1 FROM usuario_empresa ue
                 WHERE ue.usuario_id = $3 AND ue.empresa_id = $1 AND ue.activo = true
               )`,
        esImpersonacion ? [req.usuario.empresa_id, moduloId] : [req.usuario.empresa_id, moduloId, req.usuario.id]
      );
      if (!rows.length) {
        return res.status(403).json({ error: `Tu empresa no tiene el módulo "${moduloId}" habilitado, o tu acceso a esta empresa ya no está activo.` });
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
