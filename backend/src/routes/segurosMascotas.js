// src/routes/segurosMascotas.js
// Reclamos de seguro de mascota -- mismo rol que segurosDentales.js.
// mascota_id es NOT NULL (a diferencia de seguros_dentales.cliente_id, un
// seguro de mascota siempre es sobre una mascota concreta, no hay caso
// "general" del dueño); atencion_id sí queda opcional, igual criterio que
// tratamiento_id allá.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('seguros_mascotas'));

const ESTADOS_VALIDOS = ['enviado', 'en_revision', 'aprobado', 'rechazado', 'pagado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('seguros_mascotas.crear'), async (req, res) => {
  const { fecha, mascota_id, aseguradora, numero_poliza, atencion_id, monto_reclamado, monto_cubierto, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!mascota_id) return res.status(400).json({ error: 'Selecciona una mascota.' });
  if (!aseguradora) return res.status(400).json({ error: 'Indica la aseguradora.' });
  if (monto_reclamado !== undefined && monto_reclamado !== '' && numeroOCero(monto_reclamado) < 0) {
    return res.status(400).json({ error: 'El monto reclamado no puede ser negativo.' });
  }
  if (monto_cubierto !== undefined && monto_cubierto !== '' && numeroOCero(monto_cubierto) < 0) {
    return res.status(400).json({ error: 'El monto cubierto no puede ser negativo.' });
  }
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'enviado';

  try {
    const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
    if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });

    let atencionDescripcion = null;
    if (atencion_id) {
      const { rows: atRows } = await pool.query(`SELECT procedimiento FROM atenciones_veterinarias WHERE id=$1 AND empresa_id=$2`, [atencion_id, empresaId]);
      if (!atRows.length) return res.status(404).json({ error: 'La atención seleccionada no existe.' });
      atencionDescripcion = atRows[0].procedimiento;
    }

    const { rows } = await pool.query(
      `INSERT INTO seguros_mascotas (fecha, mascota_id, mascota_nombre, aseguradora, numero_poliza, atencion_id, atencion_descripcion, monto_reclamado, monto_cubierto, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [fecha, mascota_id, mascRows[0].nombre, aseguradora, numero_poliza || null, atencion_id || null, atencionDescripcion,
       numeroOCero(monto_reclamado), numeroOCero(monto_cubierto), estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'seguros_mascotas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el reclamo.' });
  }
});

router.put('/:id', verificarPermiso('seguros_mascotas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, mascota_id, aseguradora, numero_poliza, atencion_id, monto_reclamado, monto_cubierto, estado, notas } = req.body;
  if (monto_reclamado !== undefined && monto_reclamado !== '' && numeroOCero(monto_reclamado) < 0) {
    return res.status(400).json({ error: 'El monto reclamado no puede ser negativo.' });
  }
  if (monto_cubierto !== undefined && monto_cubierto !== '' && numeroOCero(monto_cubierto) < 0) {
    return res.status(400).json({ error: 'El monto cubierto no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM seguros_mascotas WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });
    const antes = antesRows[0];

    let mascotaId = antes.mascota_id, mascotaNombre = antes.mascota_nombre;
    if (mascota_id !== undefined && mascota_id !== '' && Number(mascota_id) !== antes.mascota_id) {
      const { rows: mascRows } = await pool.query(`SELECT nombre FROM mascotas WHERE id=$1 AND empresa_id=$2`, [mascota_id, empresaId]);
      if (!mascRows.length) return res.status(404).json({ error: 'La mascota seleccionada no existe.' });
      mascotaId = mascota_id; mascotaNombre = mascRows[0].nombre;
    }

    let atencionId = antes.atencion_id, atencionDescripcion = antes.atencion_descripcion;
    if (atencion_id !== undefined && Number(atencion_id || null) !== antes.atencion_id) {
      if (!atencion_id) {
        atencionId = null; atencionDescripcion = null;
      } else {
        const { rows: atRows } = await pool.query(`SELECT procedimiento FROM atenciones_veterinarias WHERE id=$1 AND empresa_id=$2`, [atencion_id, empresaId]);
        if (!atRows.length) return res.status(404).json({ error: 'La atención seleccionada no existe.' });
        atencionId = atencion_id; atencionDescripcion = atRows[0].procedimiento;
      }
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    const { rows } = await pool.query(
      `UPDATE seguros_mascotas SET
         fecha = COALESCE($1, fecha), mascota_id = $2, mascota_nombre = $3,
         aseguradora = COALESCE($4, aseguradora), numero_poliza = $5,
         atencion_id = $6, atencion_descripcion = $7,
         monto_reclamado = COALESCE($8, monto_reclamado), monto_cubierto = COALESCE($9, monto_cubierto),
         estado = $10, notas = $11, actualizado_el = now()
       WHERE id=$12 AND empresa_id=$13 RETURNING *`,
      [fecha || null, mascotaId, mascotaNombre, aseguradora || null,
       numero_poliza !== undefined ? numero_poliza : antes.numero_poliza,
       atencionId, atencionDescripcion,
       monto_reclamado !== undefined && monto_reclamado !== '' ? numeroOCero(monto_reclamado) : null,
       monto_cubierto !== undefined && monto_cubierto !== '' ? numeroOCero(monto_cubierto) : null,
       estadoFinal, notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'seguros_mascotas', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el reclamo.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'seguros_mascotas',
  modulo: 'seguros_mascotas',
  columnas: ['fecha', 'mascota_id', 'mascota_nombre', 'aseguradora', 'numero_poliza', 'atencion_id', 'atencion_descripcion', 'monto_reclamado', 'monto_cubierto', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'mascota_id', 'mascota_nombre', 'aseguradora'],
  camposNumericos: ['mascota_id', 'atencion_id', 'monto_reclamado', 'monto_cubierto'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { monto_reclamado: 0, monto_cubierto: 0, estado: 'enviado' }
}));

export default router;
