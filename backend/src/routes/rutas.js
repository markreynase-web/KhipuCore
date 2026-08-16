// src/routes/rutas.js
// Trayectos que ofrece la empresa. Sin FK que resolver -- POST/PUT son
// manuales solo para devolver un 400 claro si estado no es válido o la
// tarifa es negativa (mismo criterio que flota.js/conductores.js).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('rutas'));

const ESTADOS_VALIDOS = ['activa', 'inactiva'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('rutas.crear'), async (req, res) => {
  const { nombre, origen, destino, distancia_km, tarifa, estado, notas } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (tarifa !== undefined && tarifa !== '' && numeroOCero(tarifa) < 0) return res.status(400).json({ error: 'La tarifa no puede ser negativa.' });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows } = await pool.query(
      `INSERT INTO rutas (nombre, origen, destino, distancia_km, tarifa, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [String(nombre).trim(), origen || null, destino || null, distancia_km || null,
       numeroOCero(tarifa), ESTADOS_VALIDOS.includes(estado) ? estado : 'activa', notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'rutas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la ruta.' });
  }
});

router.put('/:id', verificarPermiso('rutas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { nombre, origen, destino, distancia_km, tarifa, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (tarifa !== undefined && tarifa !== '' && numeroOCero(tarifa) < 0) return res.status(400).json({ error: 'La tarifa no puede ser negativa.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM rutas WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Ruta no encontrada.' });
    const antes = antesRows[0];

    const { rows } = await pool.query(
      `UPDATE rutas SET
         nombre = COALESCE($1, nombre), origen = $2, destino = $3, distancia_km = $4,
         tarifa = COALESCE($5, tarifa), estado = $6, notas = $7, actualizado_el = now()
       WHERE id=$8 AND empresa_id=$9 RETURNING *`,
      [nombre || null, origen !== undefined ? origen : antes.origen, destino !== undefined ? destino : antes.destino,
       distancia_km !== undefined ? distancia_km : antes.distancia_km,
       tarifa !== undefined && tarifa !== '' ? numeroOCero(tarifa) : null,
       ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ruta no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'rutas', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la ruta.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'rutas',
  modulo: 'rutas',
  columnas: ['nombre', 'origen', 'destino', 'distancia_km', 'tarifa', 'estado', 'notas'],
  camposRequeridos: ['nombre'],
  camposNumericos: ['distancia_km', 'tarifa'],
  columnaFecha: 'creado_el',
  valoresPorDefecto: { tarifa: 0, estado: 'activa' }
}));

export default router;
