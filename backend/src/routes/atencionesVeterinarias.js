// src/routes/atencionesVeterinarias.js
// Historial clínico + cobro por atención (vertical Veterinaria) -- mismo
// rol que tratamientos.js en Dentista. POST/PUT manuales para resolver
// mascota_nombre (crudFactory no hace JOIN, ver 024_veterinaria.sql).
//
// Igual que tratamientos.js/postventa.js: esto NO genera un ingreso
// automático en Finanzas -- cuándo una atención "cuenta como ingreso real"
// es una decisión de negocio fuera de esta fase; un movimiento manual en
// Finanzas cubre el caso mientras tanto.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('atenciones_veterinarias'));

const ESTADOS_VALIDOS = ['planificado', 'en_progreso', 'completado', 'cancelado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('atenciones_veterinarias.crear'), async (req, res) => {
  const { fecha, mascota_id, diagnostico, procedimiento, costo, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!mascota_id) return res.status(400).json({ error: 'Selecciona una mascota.' });
  if (!procedimiento) return res.status(400).json({ error: 'Describe el procedimiento.' });
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'planificado';

  try {
    const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
    if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO atenciones_veterinarias (fecha, mascota_id, mascota_nombre, diagnostico, procedimiento, costo, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [fecha, mascota_id, mascRows[0].nombre, diagnostico || null, procedimiento, numeroOCero(costo), estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'atenciones_veterinarias', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la atención.' });
  }
});

router.put('/:id', verificarPermiso('atenciones_veterinarias.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, mascota_id, diagnostico, procedimiento, costo, estado, notas } = req.body;
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM atenciones_veterinarias WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Atención no encontrada.' });
    const antes = antesRows[0];

    let mascotaId = antes.mascota_id, mascotaNombre = antes.mascota_nombre;
    if (mascota_id !== undefined && mascota_id !== '' && Number(mascota_id) !== antes.mascota_id) {
      const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
      if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });
      mascotaId = mascota_id; mascotaNombre = mascRows[0].nombre;
    }
    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    const { rows } = await pool.query(
      `UPDATE atenciones_veterinarias SET
         fecha = COALESCE($1, fecha), mascota_id = $2, mascota_nombre = $3,
         diagnostico = $4, procedimiento = COALESCE($5, procedimiento),
         costo = COALESCE($6, costo), estado = $7, notas = $8, actualizado_el = now()
       WHERE id=$9 AND empresa_id=$10 RETURNING *`,
      [fecha || null, mascotaId, mascotaNombre, diagnostico !== undefined ? diagnostico : antes.diagnostico,
       procedimiento || null, costo !== undefined && costo !== '' ? numeroOCero(costo) : null, estadoFinal,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Atención no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'atenciones_veterinarias', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la atención.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'atenciones_veterinarias',
  modulo: 'atenciones_veterinarias',
  columnas: ['fecha', 'mascota_id', 'mascota_nombre', 'diagnostico', 'procedimiento', 'costo', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'mascota_id', 'mascota_nombre', 'procedimiento'],
  camposNumericos: ['mascota_id', 'costo'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { costo: 0, estado: 'planificado' }
}));

export default router;
