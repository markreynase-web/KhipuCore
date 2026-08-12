// src/routes/tratamientos.js
// Historial clínico + facturación por procedimiento (vertical Dentista).
// POST y PUT son manuales por el mismo motivo que vehiculos.js: resolver
// cliente_nombre (el SELECT genérico de crudFactory no hace JOIN). GET,
// DELETE y POST /import se quedan en el CRUD genérico.
//
// A diferencia de ventas.js/inventario.js/repuestos.js, esto NO genera un
// ingreso automático en Finanzas -- mismo criterio que postventa.js: cuándo
// un tratamiento "cuenta como ingreso real" (¿al planificarlo? ¿al
// completarlo? ¿al cobrarlo?) es una decisión de negocio que se deja fuera
// de esta fase; un movimiento manual en Finanzas cubre el caso mientras tanto.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['planificado', 'en_progreso', 'completado', 'cancelado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('tratamientos.crear'), async (req, res) => {
  const { fecha, cliente_id, pieza_dental, diagnostico, procedimiento, codigo_procedimiento, costo, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un paciente.' });
  if (!procedimiento) return res.status(400).json({ error: 'Describe el procedimiento.' });
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'planificado';

  try {
    const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO tratamientos (fecha, cliente_id, cliente_nombre, pieza_dental, diagnostico, procedimiento, codigo_procedimiento, costo, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, pieza_dental || null, diagnostico || null, procedimiento,
       codigo_procedimiento || null, numeroOCero(costo), estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'tratamientos', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el tratamiento.' });
  }
});

router.put('/:id', verificarPermiso('tratamientos.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, cliente_id, pieza_dental, diagnostico, procedimiento, codigo_procedimiento, costo, estado, notas } = req.body;
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM tratamientos WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }
    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    const { rows } = await pool.query(
      `UPDATE tratamientos SET
         fecha = COALESCE($1, fecha), cliente_id = $2, cliente_nombre = $3,
         pieza_dental = $4, diagnostico = $5, procedimiento = COALESCE($6, procedimiento),
         codigo_procedimiento = $7, costo = COALESCE($8, costo), estado = $9,
         notas = COALESCE($10, notas), actualizado_el = now()
       WHERE id=$11 AND empresa_id=$12 RETURNING *`,
      [fecha || null, clienteId, clienteNombre, pieza_dental !== undefined ? pieza_dental : antes.pieza_dental,
       diagnostico !== undefined ? diagnostico : antes.diagnostico, procedimiento || null,
       codigo_procedimiento !== undefined ? codigo_procedimiento : antes.codigo_procedimiento,
       costo !== undefined && costo !== '' ? numeroOCero(costo) : null, estadoFinal,
       notas !== undefined ? notas : null, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Tratamiento no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'tratamientos', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el tratamiento.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'tratamientos',
  modulo: 'tratamientos',
  columnas: ['fecha', 'cliente_id', 'cliente_nombre', 'pieza_dental', 'diagnostico', 'procedimiento', 'codigo_procedimiento', 'costo', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'cliente_id', 'cliente_nombre', 'procedimiento'],
  camposNumericos: ['cliente_id', 'costo'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { costo: 0, estado: 'planificado' }
}));

export default router;
