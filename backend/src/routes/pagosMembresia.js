// src/routes/pagosMembresia.js
// Historial de pagos. A propósito NO hay POST acá -- un pago siempre se
// crea junto con la extensión del vencimiento de su membresía, eso vive en
// POST /membresias/:id/pagos (ver routes/membresias.js). Esta ruta es
// solo para listar y para deshacer un pago mal registrado, que revierte la
// membresía al vencimiento_anterior guardado en el propio pago -- así
// nunca queda un pago borrado sin deshacer también la extensión que causó.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('pagos_membresia'));

router.get('/', verificarPermiso('pagos_membresia.ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const valores = [req.usuario.empresa_id];
  const condiciones = [`empresa_id = $1`];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  try {
    const { rows } = await pool.query(`SELECT * FROM pagos_membresia WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC, id DESC LIMIT 5000`, valores);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los pagos.' });
  }
});

// Solo se puede deshacer el ÚLTIMO pago de una membresía -- deshacer uno
// del medio dejaría vencimiento_nuevo del pago siguiente apuntando a una
// extensión que ya no existe. Esto se valida comparando fechas, no ids
// (dos membresías nunca comparten pagos, pero un pago viejo puede tener id
// más alto que uno nuevo si se corrigieron a mano en otro orden).
router.delete('/:id', verificarPermiso('pagos_membresia.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: pagoRows } = await cliente.query(`SELECT * FROM pagos_membresia WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!pagoRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Pago no encontrado.' }); }
    const pago = pagoRows[0];

    const { rows: masRecientes } = await cliente.query(
      `SELECT count(*)::int AS n FROM pagos_membresia WHERE membresia_id=$1 AND (fecha > $2 OR (fecha = $2 AND id > $3))`,
      [pago.membresia_id, pago.fecha, pago.id]
    );
    if (masRecientes[0].n > 0) {
      await cliente.query('ROLLBACK');
      return res.status(400).json({ error: 'Solo se puede deshacer el pago más reciente de esta membresía.' });
    }

    if (pago.vencimiento_anterior) {
      await cliente.query(`UPDATE membresias SET fecha_vencimiento = $1, actualizado_el = now() WHERE id=$2 AND empresa_id=$3`, [pago.vencimiento_anterior, pago.membresia_id, empresaId]);
    }
    await cliente.query(`DELETE FROM pagos_membresia WHERE id=$1 AND empresa_id=$2`, [pago.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'pagos_membresia', registroId: pago.id, detalle: { eliminado: pago, vencimientoRevertido: pago.vencimiento_anterior } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo deshacer el pago.' });
  } finally {
    cliente.release();
  }
});

export default router;
