// src/routes/planesMembresia.js
// Catálogo de planes (mensual/trimestral/anual/lo que sea). Sin FK que
// resolver -- POST/PUT son manuales solo para devolver un 400 claro si
// estado/duracion_meses no son válidos (mismo criterio que mesas.js).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('planes_membresia'));

const ESTADOS_VALIDOS = ['activo', 'inactivo'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('planes_membresia.crear'), async (req, res) => {
  const { nombre, duracion_meses, precio, estado, notas } = req.body;
  const duracion = Math.round(numeroOCero(duracion_meses));
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (duracion <= 0) return res.status(400).json({ error: 'La duración debe ser mayor a 0 meses.' });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO planes_membresia (nombre, duracion_meses, precio, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [String(nombre).trim(), duracion, numeroOCero(precio), ESTADOS_VALIDOS.includes(estado) ? estado : 'activo', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'planes_membresia', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el plan.' });
  }
});

router.put('/:id', verificarPermiso('planes_membresia.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { nombre, duracion_meses, precio, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const duracion = duracion_meses !== undefined && duracion_meses !== '' ? Math.round(numeroOCero(duracion_meses)) : null;
  if (duracion !== null && duracion <= 0) return res.status(400).json({ error: 'La duración debe ser mayor a 0 meses.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM planes_membresia WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE planes_membresia SET nombre = COALESCE($1, nombre), duracion_meses = COALESCE($2, duracion_meses),
         precio = COALESCE($3, precio), estado = $4, notas = $5, actualizado_el = now()
       WHERE id=$6 AND empresa_id=$7 RETURNING *`,
      [nombre || null, duracion, precio !== undefined && precio !== '' ? numeroOCero(precio) : null,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'planes_membresia', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el plan.' });
  }
});

router.delete('/:id', verificarPermiso('planes_membresia.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  try {
    const { rows: enUso } = await pool.query(`SELECT count(*)::int AS n FROM membresias WHERE plan_id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (enUso[0].n > 0) return res.status(400).json({ error: `No se puede borrar: ${enUso[0].n} socio(s) tienen este plan.` });

    const { rows } = await pool.query(`DELETE FROM planes_membresia WHERE id=$1 AND empresa_id=$2 RETURNING *`, [req.params.id, empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'Plan no encontrado.' });
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'planes_membresia', registroId: req.params.id, detalle: { eliminado: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el plan.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'planes_membresia',
  modulo: 'planes_membresia',
  columnas: ['nombre', 'duracion_meses', 'precio', 'estado', 'notas'],
  camposRequeridos: ['nombre', 'duracion_meses'],
  camposNumericos: ['duracion_meses', 'precio'],
  columnaFecha: 'creado_el',
  valoresPorDefecto: { precio: 0, estado: 'activo' }
}));

export default router;
