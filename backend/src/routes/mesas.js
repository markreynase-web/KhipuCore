// src/routes/mesas.js
// Catálogo de mesas del local. Sin FK que resolver -- POST/PUT son
// manuales solo para devolver un 400 claro si estado no es válido (mismo
// criterio que flota.js/conductores.js).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('mesas'));

const ESTADOS_VALIDOS = ['libre', 'ocupada', 'reservada', 'en_limpieza'];

router.post('/', verificarPermiso('mesas.crear'), async (req, res) => {
  const { numero, zona, capacidad, estado, notas } = req.body;
  if (!numero) return res.status(400).json({ error: 'numero es requerido.' });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO mesas (numero, zona, capacidad, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [numero, zona || null, capacidad || null, ESTADOS_VALIDOS.includes(estado) ? estado : 'libre', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'mesas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la mesa.' });
  }
});

router.put('/:id', verificarPermiso('mesas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { numero, zona, capacidad, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM mesas WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Mesa no encontrada.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE mesas SET numero = COALESCE($1, numero), zona = $2, capacidad = $3, estado = $4, notas = $5, actualizado_el = now()
       WHERE id=$6 AND empresa_id=$7 RETURNING *`,
      [numero || null, zona !== undefined ? zona : antes.zona, capacidad !== undefined ? capacidad : antes.capacidad,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mesa no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'mesas', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la mesa.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'mesas',
  modulo: 'mesas',
  columnas: ['numero', 'zona', 'capacidad', 'estado', 'notas'],
  camposRequeridos: ['numero'],
  camposNumericos: ['numero', 'capacidad'],
  columnaFecha: 'creado_el',
  valoresPorDefecto: { estado: 'libre' }
}));

export default router;
