// src/routes/finanzas.js
// Movimientos de ingreso/egreso. Los que vienen de una venta se insertan
// desde routes/ventas.js (origen_modulo='ventas'); este router los deja
// leer pero NO editar ni borrar directamente aquí -- si se anula la venta
// original en Ventas, ese movimiento se borra solo (ver ventas.js DELETE).
// Esto evita que Finanzas y Ventas se desincronicen por una edición manual.
//
// Los movimientos manuales (gastos, pagos a proveedores, ajustes) sí
// tienen CRUD completo.
//
// Fase A (multi-tenant): archivo 100% manual (no pasa por crudFactory.js),
// así que cada consulta agrega "empresa_id" a mano.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../auditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.get('/', verificarPermiso('finanzas.ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const valores = [req.usuario.empresa_id];
  const condiciones = [`empresa_id = $1`];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  const where = `WHERE ${condiciones.join(' AND ')}`;
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
  // El signo del movimiento lo da "tipo" (ingreso/egreso), no "monto" -- un
  // monto negativo aquí resta de los totales de ingresos/egresos en vez de
  // sumar, sin ningún error.
  if (monto !== undefined && monto !== '' && numeroOCero(monto) < 0) errores.push('monto no puede ser negativo');
  if (errores.length) return res.status(400).json({ error: errores.join(', ') });

  try {
    const { rows } = await pool.query(
      `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, notas, empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fecha, tipo, categoria || null, concepto, numeroOCero(monto), notas || null, req.usuario.empresa_id]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'finanzas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el movimiento.' });
  }
});

router.put('/:id', verificarPermiso('finanzas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { rows: actuales } = await pool.query(`SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se edita directo aquí.' });
  }
  const antes = actuales[0];

  const { fecha, tipo, categoria, concepto, monto, notas } = req.body;
  if (monto !== undefined && monto !== '' && numeroOCero(monto) < 0) {
    return res.status(400).json({ error: 'monto no puede ser negativo' });
  }
  try {
    const montoNuevo = numeroOCero(monto);
    const { rows } = await pool.query(
      `UPDATE finanzas SET fecha=COALESCE($1,fecha), tipo=COALESCE($2,tipo), categoria=$3, concepto=COALESCE($4,concepto),
       monto=$5, notas=$6, actualizado_el=now() WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [fecha || null, tipo || null, categoria || null, concepto || null, montoNuevo, notas || null, req.params.id, empresaId]
    );
    res.json(rows[0]);

    // Diff simple antes/después -- suficiente para este módulo (no tiene
    // tantos campos como ventas.js), no hace falta el helper sonIguales()
    // de crudFactory.js.
    const cambios = {};
    ['fecha', 'tipo', 'categoria', 'concepto', 'monto', 'notas'].forEach(campo => {
      let antesVal = antes[campo];
      let despuesVal = rows[0][campo];
      if (campo === 'monto') { antesVal = Number(antesVal); despuesVal = Number(despuesVal); }
      else {
        if (antesVal instanceof Date) antesVal = antesVal.toISOString().slice(0, 10);
        if (despuesVal instanceof Date) despuesVal = despuesVal.toISOString().slice(0, 10);
      }
      const iguales = campo === 'monto' ? antesVal === despuesVal : String(antesVal ?? '') === String(despuesVal ?? '');
      if (!iguales) cambios[campo] = { antes: antesVal, despues: despuesVal };
    });
    registrarAuditoria(pool, {
      usuario: req.usuario, accion: 'editar', modulo: 'finanzas', registroId: req.params.id,
      detalle: Object.keys(cambios).length ? cambios : 'Sin cambios en los valores (se guardó igual).'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el movimiento.' });
  }
});

router.delete('/:id', verificarPermiso('finanzas.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { rows: actuales } = await pool.query(`SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se borra directo aquí.' });
  }

  try {
    await pool.query(`DELETE FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'finanzas', registroId: req.params.id, detalle: { eliminado: actuales[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el movimiento.' });
  }
});

export default router;
