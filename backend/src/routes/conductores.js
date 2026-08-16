// src/routes/conductores.js
// Personal que maneja la flota. Sin FK que resolver -- POST/PUT son
// manuales solo para devolver un 400 claro si estado no es válido (mismo
// criterio que rrhh.js/flota.js).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('conductores'));

const ESTADOS_VALIDOS = ['activo', 'inactivo', 'de_baja'];

router.post('/', verificarPermiso('conductores.crear'), async (req, res) => {
  const { nombre, documento_identidad, telefono, licencia_categoria, licencia_numero, licencia_vencimiento, fecha_ingreso, estado, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO conductores (nombre, documento_identidad, telefono, licencia_categoria, licencia_numero, licencia_vencimiento, fecha_ingreso, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [String(nombre).trim(), documento_identidad || null, telefono || null, licencia_categoria || null,
       licencia_numero || null, licencia_vencimiento || null, fecha_ingreso || null,
       ESTADOS_VALIDOS.includes(estado) ? estado : 'activo', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'conductores', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el conductor.' });
  }
});

router.put('/:id', verificarPermiso('conductores.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { nombre, documento_identidad, telefono, licencia_categoria, licencia_numero, licencia_vencimiento, fecha_ingreso, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM conductores WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Conductor no encontrado.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE conductores SET
         nombre = COALESCE($1, nombre), documento_identidad = $2, telefono = $3,
         licencia_categoria = $4, licencia_numero = $5, licencia_vencimiento = $6,
         fecha_ingreso = $7, estado = $8, notas = $9, actualizado_el = now()
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [nombre || null,
       documento_identidad !== undefined ? documento_identidad : antes.documento_identidad,
       telefono !== undefined ? telefono : antes.telefono,
       licencia_categoria !== undefined ? licencia_categoria : antes.licencia_categoria,
       licencia_numero !== undefined ? licencia_numero : antes.licencia_numero,
       licencia_vencimiento !== undefined ? licencia_vencimiento : antes.licencia_vencimiento,
       fecha_ingreso !== undefined ? fecha_ingreso : antes.fecha_ingreso,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conductor no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'conductores', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el conductor.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'conductores',
  modulo: 'conductores',
  columnas: ['nombre', 'documento_identidad', 'telefono', 'licencia_categoria', 'licencia_numero', 'licencia_vencimiento', 'fecha_ingreso', 'estado', 'notas'],
  camposRequeridos: ['nombre'],
  camposNumericos: [],
  columnaFecha: 'creado_el',
  valoresPorDefecto: { estado: 'activo' }
}));

export default router;
