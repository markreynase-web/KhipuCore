// src/routes/turnos.js
// Asignación de conductor + unidad + ruta + horario. POST/PUT son manuales
// porque necesitan resolver TRES snapshots (conductor_nombre,
// flota_descripcion, ruta_nombre) -- crudFactory no hace JOIN en su SELECT
// genérico, mismo motivo que vehiculos.js/tratamientos.js, solo que acá son
// tres FKs en vez de una.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('turnos'));

const ESTADOS_VALIDOS = ['programado', 'en_curso', 'completado', 'cancelado'];

async function resolverConductor(empresaId, id) {
  const { rows } = await pool.query(`SELECT nombre FROM conductores WHERE id=$1 AND empresa_id=$2`, [id, empresaId]);
  return rows[0]?.nombre || null;
}
async function resolverFlota(empresaId, id) {
  const { rows } = await pool.query(`SELECT placa, marca, modelo FROM flota WHERE id=$1 AND empresa_id=$2`, [id, empresaId]);
  return rows[0] ? `${rows[0].placa} · ${rows[0].marca} ${rows[0].modelo}` : null;
}
async function resolverRuta(empresaId, id) {
  const { rows } = await pool.query(`SELECT nombre FROM rutas WHERE id=$1 AND empresa_id=$2`, [id, empresaId]);
  return rows[0]?.nombre || null;
}

router.post('/', verificarPermiso('turnos.crear'), async (req, res) => {
  const { fecha, conductor_id, flota_id, ruta_id, hora_salida, hora_llegada_estimada, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!conductor_id) return res.status(400).json({ error: 'Selecciona un conductor.' });
  if (!flota_id) return res.status(400).json({ error: 'Selecciona una unidad.' });
  if (!ruta_id) return res.status(400).json({ error: 'Selecciona una ruta.' });
  if (!hora_salida) return res.status(400).json({ error: 'hora_salida es requerido' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'programado';

  try {
    const conductorNombre = await resolverConductor(empresaId, conductor_id);
    if (!conductorNombre) return res.status(404).json({ error: 'El conductor seleccionado no existe.' });
    const flotaDescripcion = await resolverFlota(empresaId, flota_id);
    if (!flotaDescripcion) return res.status(404).json({ error: 'La unidad seleccionada no existe.' });
    const rutaNombre = await resolverRuta(empresaId, ruta_id);
    if (!rutaNombre) return res.status(404).json({ error: 'La ruta seleccionada no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO turnos (fecha, conductor_id, conductor_nombre, flota_id, flota_descripcion, ruta_id, ruta_nombre, hora_salida, hora_llegada_estimada, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [fecha, conductor_id, conductorNombre, flota_id, flotaDescripcion, ruta_id, rutaNombre,
       hora_salida, hora_llegada_estimada || null, estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'turnos', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el turno.' });
  }
});

router.put('/:id', verificarPermiso('turnos.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, conductor_id, flota_id, ruta_id, hora_salida, hora_llegada_estimada, estado, notas } = req.body;

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM turnos WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
    const antes = antesRows[0];

    let conductorId = antes.conductor_id, conductorNombre = antes.conductor_nombre;
    if (conductor_id !== undefined && conductor_id !== '' && Number(conductor_id) !== antes.conductor_id) {
      const nombre = await resolverConductor(empresaId, conductor_id);
      if (!nombre) return res.status(404).json({ error: 'El conductor seleccionado no existe.' });
      conductorId = conductor_id; conductorNombre = nombre;
    }

    let flotaId = antes.flota_id, flotaDescripcion = antes.flota_descripcion;
    if (flota_id !== undefined && flota_id !== '' && Number(flota_id) !== antes.flota_id) {
      const desc = await resolverFlota(empresaId, flota_id);
      if (!desc) return res.status(404).json({ error: 'La unidad seleccionada no existe.' });
      flotaId = flota_id; flotaDescripcion = desc;
    }

    let rutaId = antes.ruta_id, rutaNombre = antes.ruta_nombre;
    if (ruta_id !== undefined && ruta_id !== '' && Number(ruta_id) !== antes.ruta_id) {
      const nombre = await resolverRuta(empresaId, ruta_id);
      if (!nombre) return res.status(404).json({ error: 'La ruta seleccionada no existe.' });
      rutaId = ruta_id; rutaNombre = nombre;
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    const { rows } = await pool.query(
      `UPDATE turnos SET
         fecha = COALESCE($1, fecha), conductor_id = $2, conductor_nombre = $3,
         flota_id = $4, flota_descripcion = $5, ruta_id = $6, ruta_nombre = $7,
         hora_salida = COALESCE($8, hora_salida), hora_llegada_estimada = $9,
         estado = $10, notas = $11, actualizado_el = now()
       WHERE id=$12 AND empresa_id=$13 RETURNING *`,
      [fecha || null, conductorId, conductorNombre, flotaId, flotaDescripcion, rutaId, rutaNombre,
       hora_salida || null, hora_llegada_estimada !== undefined ? hora_llegada_estimada : antes.hora_llegada_estimada,
       estadoFinal, notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Turno no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'turnos', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el turno.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'turnos',
  modulo: 'turnos',
  columnas: ['fecha', 'conductor_id', 'conductor_nombre', 'flota_id', 'flota_descripcion', 'ruta_id', 'ruta_nombre', 'hora_salida', 'hora_llegada_estimada', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'conductor_id', 'conductor_nombre', 'flota_id', 'flota_descripcion', 'ruta_id', 'ruta_nombre', 'hora_salida'],
  camposNumericos: ['conductor_id', 'flota_id', 'ruta_id'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { estado: 'programado' }
}));

export default router;
