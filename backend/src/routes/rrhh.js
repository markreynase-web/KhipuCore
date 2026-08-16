// src/routes/rrhh.js
// Ficha de empleado (núcleo de RRHH). Sin efectos secundarios en otros
// módulos -- POST/PUT son manuales solo para devolver un error 400 claro
// si el estado no es válido, en vez de que la CHECK constraint de la base
// lo rebote como un 500 genérico. Nómina/asistencia/vacaciones quedan
// fuera a propósito (ver nota en 022_compras_rrhh_produccion.sql).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('rrhh'));

const ESTADOS_VALIDOS = ['activo', 'inactivo', 'vacaciones', 'licencia'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('rrhh.crear'), async (req, res) => {
  const { fecha_contratacion, nombre, puesto, departamento, salario, email, telefono, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha_contratacion) return res.status(400).json({ error: 'fecha_contratacion es requerido' });
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const salarioNum = numeroOCero(salario);
  if (salarioNum < 0) return res.status(400).json({ error: 'El salario no puede ser negativo.' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO empleados (fecha_contratacion, nombre, puesto, departamento, salario, email, telefono, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fecha_contratacion, String(nombre).trim(), puesto || null, departamento || null, salarioNum,
       email || null, telefono || null, ESTADOS_VALIDOS.includes(estado) ? estado : 'activo', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'rrhh', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el empleado.' });
  }
});

router.put('/:id', verificarPermiso('rrhh.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha_contratacion, nombre, puesto, departamento, salario, email, telefono, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (salario !== undefined && salario !== '' && numeroOCero(salario) < 0) return res.status(400).json({ error: 'El salario no puede ser negativo.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM empleados WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Empleado no encontrado.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE empleados SET
         fecha_contratacion = COALESCE($1, fecha_contratacion), nombre = COALESCE($2, nombre),
         puesto = $3, departamento = $4, salario = COALESCE($5, salario),
         email = $6, telefono = $7, estado = $8, notas = $9, actualizado_el = now()
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [fecha_contratacion || null, nombre || null,
       puesto !== undefined ? puesto : antes.puesto, departamento !== undefined ? departamento : antes.departamento,
       salario !== undefined && salario !== '' ? numeroOCero(salario) : null,
       email !== undefined ? email : antes.email, telefono !== undefined ? telefono : antes.telefono,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empleado no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'rrhh', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el empleado.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'empleados',
  modulo: 'rrhh',
  columnas: ['fecha_contratacion', 'nombre', 'puesto', 'departamento', 'salario', 'email', 'telefono', 'estado', 'notas'],
  camposRequeridos: ['fecha_contratacion', 'nombre'],
  camposNumericos: ['salario'],
  columnaFecha: 'fecha_contratacion',
  valoresPorDefecto: { salario: 0, estado: 'activo' }
}));

export default router;
