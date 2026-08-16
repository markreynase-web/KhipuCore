// src/routes/auditoria.js
// "Registro de actividad": responde a la pregunta que un cliente real hace
// tarde o temprano -- "¿quién eliminó esta venta?", "¿quién editó este
// cliente?". Las filas las escribe crudFactory.js solo; aquí solo se leen,
// con filtros simples por módulo/usuario/rango de fechas.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';

const router = Router();
router.use(auth, requireEmpresa, verificarPermiso('auditoria.ver'));

// GET /api/auditoria?modulo=ventas&usuario_id=3&desde=...&hasta=...&limite=200
router.get('/', async (req, res) => {
  const { modulo, desde, hasta, usuario_id } = req.query;
  const limite = Math.min(Number(req.query.limite) || 200, 1000);

  const valores = [req.usuario.empresa_id];
  const condiciones = [`empresa_id = $1`];
  if (modulo) { valores.push(modulo); condiciones.push(`modulo = $${valores.length}`); }
  // usuario_id ya estaba prometido en el comentario de arriba del archivo
  // ("filtros simples por módulo/usuario/rango de fechas") pero nunca se
  // había implementado -- la columna y su índice (idx_audit_log_usuario)
  // ya existen desde 006_auditoria.sql, así que agregarlo acá es solo
  // completar lo que el comentario ya decía, no una migración nueva.
  if (usuario_id) { valores.push(Number(usuario_id)); condiciones.push(`usuario_id = $${valores.length}`); }
  if (desde) { valores.push(desde); condiciones.push(`creado_el >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`creado_el <= $${valores.length}`); }
  const where = `WHERE ${condiciones.join(' AND ')}`;

  try {
    const { rows } = await pool.query(
      `SELECT id, usuario_id, usuario_nombre, accion, modulo, registro_id, detalle, creado_el, via_impersonacion
       FROM audit_log ${where}
       ORDER BY creado_el DESC
       LIMIT ${limite}`,
      valores
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo leer el registro de actividad.' });
  }
});

export default router;
