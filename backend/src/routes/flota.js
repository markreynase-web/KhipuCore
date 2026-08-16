// src/routes/flota.js
// Unidades propias de la empresa de transporte (bus/combi/van). Sin FK que
// resolver -- POST/PUT son manuales solo para devolver un 400 claro si
// tipo_vehiculo/estado no son válidos, en vez de que la CHECK constraint de
// la base lo rebote como un 500 genérico (mismo criterio que rrhh.js).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('flota'));

const TIPOS_VALIDOS = ['bus', 'minibus', 'combi', 'van'];
const ESTADOS_VALIDOS = ['operativo', 'mantenimiento', 'fuera_de_servicio'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('flota.crear'), async (req, res) => {
  const { placa, marca, modelo, anio, tipo_vehiculo, capacidad_pasajeros, kilometraje_actual, estado, notas } = req.body;
  if (!placa || !marca || !modelo) return res.status(400).json({ error: 'placa, marca y modelo son requeridos.' });
  if (tipo_vehiculo && !TIPOS_VALIDOS.includes(tipo_vehiculo)) return res.status(400).json({ error: `tipo_vehiculo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (kilometraje_actual !== undefined && kilometraje_actual !== '' && numeroOCero(kilometraje_actual) < 0) {
    return res.status(400).json({ error: 'El kilometraje no puede ser negativo.' });
  }
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO flota (placa, marca, modelo, anio, tipo_vehiculo, capacidad_pasajeros, kilometraje_actual, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [String(placa).trim(), String(marca).trim(), String(modelo).trim(), anio || null,
       TIPOS_VALIDOS.includes(tipo_vehiculo) ? tipo_vehiculo : null,
       capacidad_pasajeros || null, numeroOCero(kilometraje_actual),
       ESTADOS_VALIDOS.includes(estado) ? estado : 'operativo', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'flota', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la unidad.' });
  }
});

router.put('/:id', verificarPermiso('flota.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { placa, marca, modelo, anio, tipo_vehiculo, capacidad_pasajeros, kilometraje_actual, estado, notas } = req.body;
  if (tipo_vehiculo && !TIPOS_VALIDOS.includes(tipo_vehiculo)) return res.status(400).json({ error: `tipo_vehiculo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (kilometraje_actual !== undefined && kilometraje_actual !== '' && numeroOCero(kilometraje_actual) < 0) {
    return res.status(400).json({ error: 'El kilometraje no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM flota WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Unidad no encontrada.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE flota SET
         placa = COALESCE($1, placa), marca = COALESCE($2, marca), modelo = COALESCE($3, modelo),
         anio = $4, tipo_vehiculo = $5, capacidad_pasajeros = $6,
         kilometraje_actual = COALESCE($7, kilometraje_actual), estado = $8, notas = $9, actualizado_el = now()
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [placa || null, marca || null, modelo || null,
       anio !== undefined ? anio : antes.anio,
       TIPOS_VALIDOS.includes(tipo_vehiculo) ? tipo_vehiculo : antes.tipo_vehiculo,
       capacidad_pasajeros !== undefined ? capacidad_pasajeros : antes.capacidad_pasajeros,
       kilometraje_actual !== undefined && kilometraje_actual !== '' ? numeroOCero(kilometraje_actual) : null,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Unidad no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'flota', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la unidad.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'flota',
  modulo: 'flota',
  columnas: ['placa', 'marca', 'modelo', 'anio', 'tipo_vehiculo', 'capacidad_pasajeros', 'kilometraje_actual', 'estado', 'notas'],
  camposRequeridos: ['placa', 'marca', 'modelo'],
  camposNumericos: ['anio', 'capacidad_pasajeros', 'kilometraje_actual'],
  columnaFecha: 'creado_el',
  valoresPorDefecto: { kilometraje_actual: 0, estado: 'operativo' }
}));

export default router;
