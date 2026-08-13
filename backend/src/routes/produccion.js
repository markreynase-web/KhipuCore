// src/routes/produccion.js
// Órdenes de producción para UN producto existente de Inventario. Mismo
// patrón que compras.js: completar la orden (estado='completada') es lo
// que suma cantidad_producida al stock; una vez completada el estado queda
// fijo por el mismo motivo (revertir significaría desandar stock que ya
// pudo haberse vendido). Sin egreso automático a Finanzas -- a diferencia
// de una compra (que tiene un monto claro: cantidad × costo_unitario a un
// proveedor), el costo de producir es una mezcla de materiales + mano de
// obra que la empresa ya suele llevar en sus propios registros; inventarlo
// acá sería una cifra sin respaldo real.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['planificada', 'en_proceso', 'completada', 'cancelada'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('produccion.crear'), async (req, res) => {
  const { fecha_inicio, producto_id, cantidad_planificada, fecha_fin_estimada, estado, costo_materiales, costo_mano_obra, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha_inicio) return res.status(400).json({ error: 'fecha_inicio es requerido' });
  if (!producto_id) return res.status(400).json({ error: 'Selecciona un producto.' });
  const cantidadPlanNum = numeroOCero(cantidad_planificada);
  if (cantidadPlanNum <= 0) return res.status(400).json({ error: 'La cantidad planificada debe ser mayor a 0.' });
  if (numeroOCero(costo_materiales) < 0 || numeroOCero(costo_mano_obra) < 0) return res.status(400).json({ error: 'Los costos no pueden ser negativos.' });
  // 'completada' no se acepta al crear -- mismo motivo que compras.js: el
  // efecto de stock siempre pasa por el mismo camino, el de PUT.
  const estadoFinal = ['planificada', 'en_proceso', 'cancelada'].includes(estado) ? estado : 'planificada';

  try {
    const { rows: prodRows } = await pool.query(`SELECT nombre FROM inventario WHERE id=$1 AND empresa_id=$2`, [producto_id, empresaId]);
    if (!prodRows.length) return res.status(404).json({ error: 'El producto seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO ordenes_produccion (fecha_inicio, producto_id, producto_nombre, cantidad_planificada, cantidad_producida, fecha_fin_estimada, estado, costo_materiales, costo_mano_obra, notas, empresa_id)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fecha_inicio, producto_id, prodRows[0].nombre, cantidadPlanNum, fecha_fin_estimada || null, estadoFinal,
       numeroOCero(costo_materiales), numeroOCero(costo_mano_obra), notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'produccion', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la orden de producción.' });
  }
});

router.put('/:id', verificarPermiso('produccion.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha_inicio, cantidad_planificada, cantidad_producida, fecha_fin_estimada, estado, costo_materiales, costo_mano_obra, notas } = req.body;

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: antesRows } = await cliente.query(`SELECT * FROM ordenes_produccion WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!antesRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const antes = antesRows[0];

    if (antes.estado === 'completada') {
      // Ya sumó al stock -- solo quedan editables campos informativos.
      const { rows } = await cliente.query(
        `UPDATE ordenes_produccion SET notas = COALESCE($1, notas), actualizado_el = now()
         WHERE id=$2 AND empresa_id=$3 RETURNING *`,
        [notas !== undefined ? notas : null, req.params.id, empresaId]
      );
      await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'editar', modulo: 'produccion', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
      await cliente.query('COMMIT');
      return res.json(rows[0]);
    }

    if (estado && !ESTADOS_VALIDOS.includes(estado)) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` }); }
    const cantidadPlanFinal = cantidad_planificada !== undefined && cantidad_planificada !== '' ? numeroOCero(cantidad_planificada) : Number(antes.cantidad_planificada);
    if (cantidadPlanFinal <= 0) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: 'La cantidad planificada debe ser mayor a 0.' }); }
    const estadoFinal = estado || antes.estado;

    let cantidadProducidaFinal = cantidad_producida !== undefined && cantidad_producida !== '' ? numeroOCero(cantidad_producida) : Number(antes.cantidad_producida);
    if (estadoFinal === 'completada') {
      // Si no se indicó cantidad producida al completar, se asume que se
      // cumplió el plan -- es el caso normal; producir menos de lo
      // planificado es la excepción y requiere decirlo explícitamente.
      if (cantidad_producida === undefined || cantidad_producida === '') cantidadProducidaFinal = cantidadPlanFinal;
      if (cantidadProducidaFinal <= 0) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: 'La cantidad producida debe ser mayor a 0 para completar la orden.' }); }

      await cliente.query(`SELECT id FROM inventario WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [antes.producto_id, empresaId]);
      await cliente.query(
        `UPDATE inventario SET stock = stock + $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`,
        [cantidadProducidaFinal, antes.producto_id, empresaId]
      );
    }

    const { rows } = await cliente.query(
      `UPDATE ordenes_produccion SET
         fecha_inicio = COALESCE($1, fecha_inicio), cantidad_planificada = $2, cantidad_producida = $3,
         fecha_fin_estimada = $4, estado = $5, costo_materiales = $6, costo_mano_obra = $7,
         notas = COALESCE($8, notas), actualizado_el = now()
       WHERE id=$9 AND empresa_id=$10 RETURNING *`,
      [fecha_inicio || null, cantidadPlanFinal, cantidadProducidaFinal,
       fecha_fin_estimada !== undefined ? fecha_fin_estimada || null : antes.fecha_fin_estimada, estadoFinal,
       costo_materiales !== undefined && costo_materiales !== '' ? numeroOCero(costo_materiales) : antes.costo_materiales,
       costo_mano_obra !== undefined && costo_mano_obra !== '' ? numeroOCero(costo_mano_obra) : antes.costo_mano_obra,
       notas !== undefined ? notas : null, req.params.id, empresaId]
    );

    await registrarAuditoria(cliente, {
      usuario: req.usuario, accion: 'editar', modulo: 'produccion', registroId: req.params.id,
      detalle: { antes, despues: rows[0], stockSumado: estadoFinal === 'completada' && antes.estado !== 'completada' ? cantidadProducidaFinal : null }
    });
    await cliente.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la orden de producción.' });
  } finally {
    cliente.release();
  }
});

// DELETE: si ya estaba 'completada', revierte el stock sumado -- mismo
// motivo que compras.js (no dejar un stock inflado por una orden borrada).
// No hay egreso de Finanzas que revertir acá (nunca se posteó ninguno).
router.delete('/:id', verificarPermiso('produccion.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM ordenes_produccion WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const orden = rows[0];

    if (orden.estado === 'completada' && Number(orden.cantidad_producida) > 0) {
      await cliente.query(`UPDATE inventario SET stock = stock - $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`, [orden.cantidad_producida, orden.producto_id, empresaId]);
    }
    await cliente.query(`DELETE FROM ordenes_produccion WHERE id = $1 AND empresa_id = $2`, [orden.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'produccion', registroId: orden.id, detalle: { eliminado: orden } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar la orden de producción.' });
  } finally {
    cliente.release();
  }
});

router.use(crearRouterCRUD({
  tabla: 'ordenes_produccion',
  modulo: 'produccion',
  columnas: ['fecha_inicio', 'producto_id', 'producto_nombre', 'cantidad_planificada', 'cantidad_producida', 'fecha_fin_estimada', 'estado', 'costo_materiales', 'costo_mano_obra', 'notas'],
  camposRequeridos: ['fecha_inicio', 'producto_id', 'producto_nombre'],
  camposNumericos: ['producto_id', 'cantidad_planificada', 'cantidad_producida', 'costo_materiales', 'costo_mano_obra'],
  columnaFecha: 'fecha_inicio',
  valoresPorDefecto: { cantidad_producida: 0, estado: 'planificada' }
}));

export default router;
