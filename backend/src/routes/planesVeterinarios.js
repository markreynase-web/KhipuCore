// src/routes/planesVeterinarios.js
// Planes veterinarios: procedimientos de varias sesiones o costo alto
// (cirugías, tratamientos prolongados), con presupuesto y aprobación del
// dueño -- mismo rol que planesTratamiento.js en Dentista. POST/PUT
// manuales para resolver mascota_nombre + la misma regla de
// fecha_aprobacion server-side (se completa sola la primera vez que el
// estado pasa a 'aprobado', nunca se confía en lo que mande el cliente).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('planes_veterinarios'));

const ESTADOS_VALIDOS = ['propuesto', 'aprobado', 'rechazado', 'en_progreso', 'completado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('planes_veterinarios.crear'), async (req, res) => {
  const { fecha, mascota_id, descripcion, presupuesto_total, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!mascota_id) return res.status(400).json({ error: 'Selecciona una mascota.' });
  if (!descripcion) return res.status(400).json({ error: 'Describe el plan.' });
  if (presupuesto_total !== undefined && presupuesto_total !== '' && numeroOCero(presupuesto_total) < 0) {
    return res.status(400).json({ error: 'El presupuesto no puede ser negativo.' });
  }
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'propuesto';
  const fechaAprobacion = estadoFinal === 'aprobado' ? fecha : null;

  try {
    const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
    if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO planes_veterinarios (fecha, mascota_id, mascota_nombre, descripcion, presupuesto_total, estado, fecha_aprobacion, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [fecha, mascota_id, mascRows[0].nombre, descripcion, numeroOCero(presupuesto_total), estadoFinal, fechaAprobacion, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'planes_veterinarios', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el plan.' });
  }
});

router.put('/:id', verificarPermiso('planes_veterinarios.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, mascota_id, descripcion, presupuesto_total, estado, notas } = req.body;
  if (presupuesto_total !== undefined && presupuesto_total !== '' && numeroOCero(presupuesto_total) < 0) {
    return res.status(400).json({ error: 'El presupuesto no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM planes_veterinarios WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
    const antes = antesRows[0];

    let mascotaId = antes.mascota_id, mascotaNombre = antes.mascota_nombre;
    if (mascota_id !== undefined && mascota_id !== '' && Number(mascota_id) !== antes.mascota_id) {
      const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
      if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });
      mascotaId = mascota_id; mascotaNombre = mascRows[0].nombre;
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;
    const fechaAprobacion = estadoFinal === 'aprobado' && !antes.fecha_aprobacion
      ? (fecha || antes.fecha)
      : (estadoFinal === 'aprobado' ? antes.fecha_aprobacion : null);

    const { rows } = await pool.query(
      `UPDATE planes_veterinarios SET
         fecha = COALESCE($1, fecha), mascota_id = $2, mascota_nombre = $3,
         descripcion = COALESCE($4, descripcion), presupuesto_total = COALESCE($5, presupuesto_total),
         estado = $6, fecha_aprobacion = $7, notas = $8, actualizado_el = now()
       WHERE id=$9 AND empresa_id=$10 RETURNING *`,
      [fecha || null, mascotaId, mascotaNombre, descripcion || null,
       presupuesto_total !== undefined && presupuesto_total !== '' ? numeroOCero(presupuesto_total) : null,
       estadoFinal, fechaAprobacion, notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'planes_veterinarios', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el plan.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'planes_veterinarios',
  modulo: 'planes_veterinarios',
  columnas: ['fecha', 'mascota_id', 'mascota_nombre', 'descripcion', 'presupuesto_total', 'estado', 'fecha_aprobacion', 'notas'],
  camposRequeridos: ['fecha', 'mascota_id', 'mascota_nombre', 'descripcion'],
  camposNumericos: ['mascota_id', 'presupuesto_total'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { presupuesto_total: 0, estado: 'propuesto' }
}));

export default router;
