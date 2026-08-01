// src/routes/finanzas.js
// Movimientos de ingreso/egreso. Los que vienen de una venta se insertan
// desde routes/ventas.js (origen_modulo='ventas'); este router los deja
// leer pero NO editar ni borrar directamente aquí -- si se anula la venta
// original en Ventas, ese movimiento se borra solo (ver ventas.js DELETE).
// Esto evita que Finanzas y Ventas se desincronicen por una edición manual.
//
// Los movimientos manuales (gastos, pagos a proveedores, ajustes) sí
// tienen CRUD completo.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';

const router = Router();
router.use(auth);

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function registrarAuditoria({ usuario, accion, registroId, detalle }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, modulo, registro_id, detalle)
       VALUES ($1, $2, $3, 'finanzas', $4, $5)`,
      [usuario?.id ?? null, usuario?.nombre ?? 'Desconocido', accion, registroId ? String(registroId) : null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (err) {
    console.error('No se pudo escribir en audit_log:', err.message);
  }
}

router.get('/', verificarPermiso('finanzas.ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(`SELECT * FROM finanzas ${where} ORDER BY fecha DESC, id DESC LIMIT 5000`, valores);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los movimientos de finanzas.' });
  }
});

router.post('/', verificarPermiso('finanzas.crear'), async (req, res) => {
  const { fecha, tipo, categoria, concepto, monto, notas } = req.body;
  const errores = [];
  if (!fecha) errores.push('fecha es requerido');
  if (!['ingreso', 'egreso'].includes(tipo)) errores.push('tipo debe ser "ingreso" o "egreso"');
  if (!concepto) errores.push('concepto es requerido');
  if (errores.length) return res.status(400).json({ error: errores.join(', ') });

  try {
    const { rows } = await pool.query(
      `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, notas) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [fecha, tipo, categoria || null, concepto, numeroOCero(monto), notas || null]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria({ usuario: req.usuario, accion: 'crear', registroId: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el movimiento.' });
  }
});

router.put('/:id', verificarPermiso('finanzas.editar'), async (req, res) => {
  const { rows: actuales } = await pool.query(`SELECT origen_modulo FROM finanzas WHERE id = $1`, [req.params.id]);
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se edita directo aquí.' });
  }

  const { fecha, tipo, categoria, concepto, monto, notas } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE finanzas SET fecha=COALESCE($1,fecha), tipo=COALESCE($2,tipo), categoria=$3, concepto=COALESCE($4,concepto),
       monto=$5, notas=$6, actualizado_el=now() WHERE id=$7 RETURNING *`,
      [fecha || null, tipo || null, categoria || null, concepto || null, numeroOCero(monto), notas || null, req.params.id]
    );
    res.json(rows[0]);
    registrarAuditoria({ usuario: req.usuario, accion: 'editar', registroId: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el movimiento.' });
  }
});

router.delete('/:id', verificarPermiso('finanzas.eliminar'), async (req, res) => {
  const { rows: actuales } = await pool.query(`SELECT origen_modulo FROM finanzas WHERE id = $1`, [req.params.id]);
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se borra directo aquí.' });
  }

  try {
    await pool.query(`DELETE FROM finanzas WHERE id = $1`, [req.params.id]);
    res.status(204).end();
    registrarAuditoria({ usuario: req.usuario, accion: 'eliminar', registroId: req.params.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el movimiento.' });
  }
});

export default router;
