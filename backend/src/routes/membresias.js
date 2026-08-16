// src/routes/membresias.js
// La suscripción de un socio a un plan. 100% manual (no pasa por
// crudFactory.js): fecha_vencimiento se calcula del lado del servidor
// (fecha_inicio + plan.duracion_meses) -- nunca se confía en una fecha de
// vencimiento que mande el cliente, es la garantía central de todo el
// módulo. "Vencida"/"por vencer"/"al día" NO son un estado guardado: se
// calculan al vuelo comparando fecha_vencimiento contra hoy (ver
// 027_gimnasio.sql) -- el frontend arma el semáforo con ese dato, esta
// ruta solo entrega fecha_vencimiento tal cual.
//
// POST /:id/pagos es la pieza transaccional del módulo: registrar un pago
// SIEMPRE extiende fecha_vencimiento en la misma transacción (desde el
// vencimiento actual, no desde hoy -- así una renovación adelantada no le
// "roba" días al socio). No existe una ruta que inserte un pago sin mover
// la fecha, ni que mueva la fecha sin dejar su pago.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('membresias'));

const ESTADOS_VALIDOS = ['activa', 'cancelada'];
const METODOS_VALIDOS = ['efectivo', 'yape', 'plin', 'transferencia', 'tarjeta'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// YYYY-MM-DD + N meses, en JS (no en SQL) porque después se necesita el
// mismo cálculo tanto en el alta (fecha_inicio + duracion) como en cada
// renovación (vencimiento_actual + duracion) -- una sola función, dos usos.
// node-postgres devuelve las columnas DATE como objetos Date de JS (no
// como el string "YYYY-MM-DD" que se mandó) -- esto normaliza cualquiera
// de los dos formatos antes de operar con fechas.
function aFechaISO(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function sumarMeses(fecha, meses) {
  const d = new Date(aFechaISO(fecha) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + meses);
  return d.toISOString().slice(0, 10);
}

router.get('/', verificarPermiso('membresias.ver'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM membresias WHERE empresa_id=$1 ORDER BY fecha_vencimiento ASC, id DESC LIMIT 5000`,
      [req.usuario.empresa_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer las membresías.' });
  }
});

router.post('/', verificarPermiso('membresias.crear'), async (req, res) => {
  const { cliente_id, plan_id, fecha_inicio, notas, primer_pago } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un socio.' });
  if (!plan_id) return res.status(400).json({ error: 'Selecciona un plan.' });
  if (!fecha_inicio) return res.status(400).json({ error: 'fecha_inicio es requerido.' });
  if (primer_pago !== undefined && primer_pago !== null) {
    const monto = numeroOCero(primer_pago.monto);
    if (monto <= 0) return res.status(400).json({ error: 'El monto del primer pago debe ser mayor a 0.' });
    if (primer_pago.metodo && !METODOS_VALIDOS.includes(primer_pago.metodo)) {
      return res.status(400).json({ error: `metodo debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });
    }
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El socio seleccionado no existe.' }); }

    const { rows: planRows } = await cliente.query(`SELECT nombre, duracion_meses FROM planes_membresia WHERE id=$1 AND empresa_id=$2`, [plan_id, empresaId]);
    if (!planRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El plan seleccionado no existe.' }); }
    const plan = planRows[0];

    const fechaVencimiento = sumarMeses(fecha_inicio, plan.duracion_meses);

    const { rows } = await cliente.query(
      `INSERT INTO membresias (cliente_id, cliente_nombre, plan_id, plan_nombre, fecha_inicio, fecha_vencimiento, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,'activa',$7,$8) RETURNING *`,
      [cliente_id, cliRows[0].nombre, plan_id, plan.nombre, fecha_inicio, fechaVencimiento, notas || null, empresaId]
    );
    const membresia = rows[0];

    if (primer_pago) {
      await cliente.query(
        `INSERT INTO pagos_membresia (membresia_id, cliente_nombre, plan_nombre, fecha, monto, metodo, vencimiento_anterior, vencimiento_nuevo, notas, empresa_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [membresia.id, cliRows[0].nombre, plan.nombre, fecha_inicio, numeroOCero(primer_pago.monto),
         METODOS_VALIDOS.includes(primer_pago.metodo) ? primer_pago.metodo : 'efectivo',
         null, fechaVencimiento, primer_pago.notas || null, empresaId]
      );
    }

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'crear', modulo: 'membresias', registroId: membresia.id, detalle: { ...membresia, primer_pago: !!primer_pago } });
    await cliente.query('COMMIT');
    res.status(201).json(membresia);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la membresía.' });
  } finally {
    cliente.release();
  }
});

// Registrar un pago = extender fecha_vencimiento por la duración del plan
// ACTUAL de la membresía (si el socio cambió de plan más adelante, cada
// renovación usa el plan vigente en ese momento, no el original).
router.post('/:id/pagos', verificarPermiso('pagos_membresia.crear'), async (req, res) => {
  const { monto, metodo, fecha, notas } = req.body;
  const empresaId = req.usuario.empresa_id;
  const montoNum = numeroOCero(monto);
  if (montoNum <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0.' });
  if (metodo && !METODOS_VALIDOS.includes(metodo)) return res.status(400).json({ error: `metodo debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: memRows } = await cliente.query(`SELECT * FROM membresias WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!memRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Membresía no encontrada.' }); }
    const membresia = memRows[0];

    const { rows: planRows } = await cliente.query(`SELECT duracion_meses FROM planes_membresia WHERE id=$1 AND empresa_id=$2`, [membresia.plan_id, empresaId]);
    if (!planRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El plan de esta membresía ya no existe.' }); }

    const vencimientoAnterior = aFechaISO(membresia.fecha_vencimiento);
    const vencimientoNuevo = sumarMeses(vencimientoAnterior, planRows[0].duracion_meses);
    const fechaPago = fecha || new Date().toISOString().slice(0, 10);

    const { rows: pagoRows } = await cliente.query(
      `INSERT INTO pagos_membresia (membresia_id, cliente_nombre, plan_nombre, fecha, monto, metodo, vencimiento_anterior, vencimiento_nuevo, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [membresia.id, membresia.cliente_nombre, membresia.plan_nombre, fechaPago, montoNum,
       METODOS_VALIDOS.includes(metodo) ? metodo : 'efectivo', vencimientoAnterior, vencimientoNuevo, notas || null, empresaId]
    );

    const { rows: memActualizada } = await cliente.query(
      `UPDATE membresias SET fecha_vencimiento = $1, estado = 'activa', actualizado_el = now() WHERE id=$2 AND empresa_id=$3 RETURNING *`,
      [vencimientoNuevo, membresia.id, empresaId]
    );

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'crear', modulo: 'pagos_membresia', registroId: pagoRows[0].id, detalle: pagoRows[0] });
    await cliente.query('COMMIT');
    res.status(201).json({ pago: pagoRows[0], membresia: memActualizada[0] });
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el pago.' });
  } finally {
    cliente.release();
  }
});

// cliente_id/plan_id son INMUTABLES (mismo criterio que comandas.js) -- un
// cambio de plan o de socio es una membresía distinta, se cancela y se
// crea de nuevo. Sí se puede corregir fecha_inicio (recalcula el
// vencimiento SOLO si todavía no tuvo ningún pago -- después del primer
// pago, el vencimiento lo maneja exclusivamente POST /:id/pagos) y estado.
router.put('/:id', verificarPermiso('membresias.editar'), async (req, res) => {
  const { fecha_inicio, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM membresias WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Membresía no encontrada.' });
    const antes = antesRows[0];

    let fechaVencimiento = aFechaISO(antes.fecha_vencimiento);
    let fechaInicioFinal = aFechaISO(antes.fecha_inicio);
    if (fecha_inicio && fecha_inicio !== aFechaISO(antes.fecha_inicio)) {
      const { rows: pagosPrevios } = await pool.query(`SELECT count(*)::int AS n FROM pagos_membresia WHERE membresia_id=$1`, [req.params.id]);
      if (pagosPrevios[0].n > 0) {
        return res.status(400).json({ error: 'No se puede cambiar la fecha de inicio: esta membresía ya tiene pagos registrados.' });
      }
      const { rows: planRows } = await pool.query(`SELECT duracion_meses FROM planes_membresia WHERE id=$1 AND empresa_id=$2`, [antes.plan_id, empresaId]);
      fechaInicioFinal = fecha_inicio;
      fechaVencimiento = sumarMeses(fecha_inicio, planRows[0].duracion_meses);
    }

    const { rows } = await pool.query(
      `UPDATE membresias SET fecha_inicio = $1, fecha_vencimiento = $2, estado = $3, notas = $4, actualizado_el = now()
       WHERE id=$5 AND empresa_id=$6 RETURNING *`,
      [fechaInicioFinal, fechaVencimiento, ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Membresía no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'membresias', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la membresía.' });
  }
});

router.delete('/:id', verificarPermiso('membresias.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  try {
    const { rows: enUso } = await pool.query(`SELECT count(*)::int AS n FROM pagos_membresia WHERE membresia_id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (enUso[0].n > 0) return res.status(400).json({ error: `No se puede borrar: esta membresía tiene ${enUso[0].n} pago(s) registrados. Cancélala en vez de borrarla.` });

    const { rows } = await pool.query(`DELETE FROM membresias WHERE id=$1 AND empresa_id=$2 RETURNING *`, [req.params.id, empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'Membresía no encontrada.' });
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'membresias', registroId: req.params.id, detalle: { eliminado: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar la membresía.' });
  }
});

export default router;
