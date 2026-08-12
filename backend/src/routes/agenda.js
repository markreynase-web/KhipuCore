// src/routes/agenda.js
// Citas: POST y PUT son manuales por dos motivos (mismo espíritu que
// vehiculos.js) -- (1) resolver cliente_nombre/vehiculo_descripcion (el
// SELECT genérico de crudFactory no hace JOIN) y (2) detectar choques de
// horario de verdad en el servidor, no solo en la UI. GET, DELETE y
// POST /import no tienen ninguno de esos dos problemas, se quedan en el
// CRUD genérico.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['pendiente', 'confirmada', 'completada', 'cancelada', 'no_asistio'];

function enteroPositivo(v, porDefecto) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : porDefecto;
}

// Devuelve las citas (de otro id) que se solapan con [hora, hora+duracion)
// el mismo día, en la misma empresa. Las canceladas no cuentan -- un
// horario cancelado queda libre para volver a usarse.
async function citasEnConflicto(cliente, { empresaId, fecha, hora, duracionMinutos, excluirId }) {
  const { rows } = await cliente.query(
    `SELECT id, hora, duracion_minutos, cliente_nombre, motivo FROM agenda
     WHERE empresa_id = $1 AND fecha = $2 AND estado != 'cancelada'
       AND ($3::int IS NULL OR id != $3)
       AND hora < ($4::time + ($5 || ' minutes')::interval)
       AND (hora + (duracion_minutos || ' minutes')::interval) > $4::time`,
    [empresaId, fecha, excluirId || null, hora, duracionMinutos]
  );
  return rows;
}

router.post('/', verificarPermiso('agenda.crear'), async (req, res) => {
  const { fecha, hora, duracion_minutos, cliente_id, motivo, vehiculo_id, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!hora) return res.status(400).json({ error: 'hora es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un cliente.' });
  if (!motivo) return res.status(400).json({ error: 'Describe el motivo de la cita.' });
  const duracionFinal = enteroPositivo(duracion_minutos, 30);
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'pendiente';

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El cliente seleccionado no existe.' }); }

    let vehiculoDescripcion = null;
    if (vehiculo_id) {
      const { rows: vehRows } = await cliente.query(`SELECT placa, marca, modelo, anio FROM vehiculos WHERE id=$1 AND empresa_id=$2`, [vehiculo_id, empresaId]);
      if (!vehRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El vehículo seleccionado no existe.' }); }
      const veh = vehRows[0];
      vehiculoDescripcion = `${veh.marca} ${veh.modelo}${veh.anio ? ' ' + veh.anio : ''} · ${veh.placa}`;
    }

    const conflictos = await citasEnConflicto(cliente, { empresaId, fecha, hora, duracionMinutos: duracionFinal, excluirId: null });
    if (conflictos.length) {
      await cliente.query('ROLLBACK');
      const c = conflictos[0];
      return res.status(409).json({
        error: `Ya hay una cita a las ${String(c.hora).slice(0, 5)} (${c.cliente_nombre} · ${c.motivo}) que se cruza con este horario.`,
        conflictos
      });
    }

    const { rows } = await cliente.query(
      `INSERT INTO agenda (fecha, hora, duracion_minutos, cliente_id, cliente_nombre, motivo, vehiculo_id, vehiculo_descripcion, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [fecha, hora, duracionFinal, cliente_id, cliRows[0].nombre, motivo, vehiculo_id || null, vehiculoDescripcion, estadoFinal, notas || null, empresaId]
    );
    const cita = rows[0];
    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'crear', modulo: 'agenda', registroId: cita.id, detalle: cita });
    await cliente.query('COMMIT');
    res.status(201).json(cita);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo agendar la cita.' });
  } finally {
    cliente.release();
  }
});

router.put('/:id', verificarPermiso('agenda.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, hora, duracion_minutos, cliente_id, motivo, vehiculo_id, estado, notas } = req.body;

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: antesRows } = await cliente.query(`SELECT * FROM agenda WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!antesRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Cita no encontrada.' }); }
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El cliente seleccionado no existe.' }); }
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    let vehiculoId = antes.vehiculo_id, vehiculoDescripcion = antes.vehiculo_descripcion;
    if (vehiculo_id !== undefined && Number(vehiculo_id || null) !== antes.vehiculo_id) {
      if (!vehiculo_id) {
        vehiculoId = null; vehiculoDescripcion = null;
      } else {
        const { rows: vehRows } = await cliente.query(`SELECT placa, marca, modelo, anio FROM vehiculos WHERE id=$1 AND empresa_id=$2`, [vehiculo_id, empresaId]);
        if (!vehRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El vehículo seleccionado no existe.' }); }
        const veh = vehRows[0];
        vehiculoId = vehiculo_id; vehiculoDescripcion = `${veh.marca} ${veh.modelo}${veh.anio ? ' ' + veh.anio : ''} · ${veh.placa}`;
      }
    }

    const fechaFinal = fecha || antes.fecha;
    const horaFinal = hora || antes.hora;
    const duracionFinal = duracion_minutos !== undefined && duracion_minutos !== '' ? enteroPositivo(duracion_minutos, antes.duracion_minutos) : antes.duracion_minutos;
    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    // Solo hace falta re-chequear choques si el horario (o su duración)
    // realmente cambió, o si se está reactivando una cita que estaba
    // cancelada -- de lo contrario una cita se "chocaría consigo misma"
    // en cada edición que no toque el horario para nada.
    const horarioCambio = fechaFinal !== antes.fecha || horaFinal !== antes.hora || duracionFinal !== antes.duracion_minutos;
    const seReactiva = antes.estado === 'cancelada' && estadoFinal !== 'cancelada';
    if (estadoFinal !== 'cancelada' && (horarioCambio || seReactiva)) {
      const conflictos = await citasEnConflicto(cliente, { empresaId, fecha: fechaFinal, hora: horaFinal, duracionMinutos: duracionFinal, excluirId: req.params.id });
      if (conflictos.length) {
        await cliente.query('ROLLBACK');
        const c = conflictos[0];
        return res.status(409).json({
          error: `Ya hay una cita a las ${String(c.hora).slice(0, 5)} (${c.cliente_nombre} · ${c.motivo}) que se cruza con este horario.`,
          conflictos
        });
      }
    }

    const { rows } = await cliente.query(
      `UPDATE agenda SET
         fecha = $1, hora = $2, duracion_minutos = $3, cliente_id = $4, cliente_nombre = $5,
         motivo = COALESCE($6, motivo), vehiculo_id = $7, vehiculo_descripcion = $8, estado = $9,
         notas = COALESCE($10, notas), actualizado_el = now()
       WHERE id = $11 AND empresa_id = $12 RETURNING *`,
      [fechaFinal, horaFinal, duracionFinal, clienteId, clienteNombre, motivo || null, vehiculoId, vehiculoDescripcion, estadoFinal,
       notas !== undefined ? notas : null, req.params.id, empresaId]
    );

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'editar', modulo: 'agenda', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
    await cliente.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la cita.' });
  } finally {
    cliente.release();
  }
});

// GET, DELETE y POST /import: sin efectos secundarios ni choques que
// resolver del lado del import masivo (un CSV de citas queda sujeto a las
// mismas reglas de NOT NULL que cualquier otro import -- no valida choques
// de horario fila por fila, ver limitación equivalente en ventas.js/import).
router.use(crearRouterCRUD({
  tabla: 'agenda',
  modulo: 'agenda',
  columnas: ['fecha', 'hora', 'duracion_minutos', 'cliente_id', 'cliente_nombre', 'motivo', 'vehiculo_id', 'vehiculo_descripcion', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'hora', 'cliente_id', 'cliente_nombre', 'motivo'],
  camposNumericos: ['cliente_id', 'duracion_minutos', 'vehiculo_id'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { duracion_minutos: 30, estado: 'pendiente' }
}));

export default router;
