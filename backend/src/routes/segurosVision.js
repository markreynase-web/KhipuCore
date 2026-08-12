// src/routes/segurosVision.js
// Reclamos de seguro de visión. Mismo patrón que segurosDentales.js:
// snapshot de cliente_nombre + snapshot opcional de orden_descripcion
// cuando el reclamo se linkea a una orden de laboratorio concreta.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['enviado', 'en_revision', 'aprobado', 'rechazado', 'pagado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function descripcionOrden(o) {
  return [o.armazon, o.tipo_lente].filter(Boolean).join(' · ') || 'Orden de laboratorio';
}

router.post('/', verificarPermiso('seguros_vision.crear'), async (req, res) => {
  const { fecha, cliente_id, aseguradora, numero_poliza, orden_id, monto_reclamado, monto_cubierto, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un paciente.' });
  if (!aseguradora) return res.status(400).json({ error: 'Indica la aseguradora.' });
  if (monto_reclamado !== undefined && monto_reclamado !== '' && numeroOCero(monto_reclamado) < 0) {
    return res.status(400).json({ error: 'El monto reclamado no puede ser negativo.' });
  }
  if (monto_cubierto !== undefined && monto_cubierto !== '' && numeroOCero(monto_cubierto) < 0) {
    return res.status(400).json({ error: 'El monto cubierto no puede ser negativo.' });
  }
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'enviado';

  try {
    const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });

    let ordenDescripcion = null;
    if (orden_id) {
      const { rows: ordRows } = await pool.query(`SELECT armazon, tipo_lente FROM ordenes_laboratorio WHERE id=$1 AND empresa_id=$2`, [orden_id, empresaId]);
      if (!ordRows.length) return res.status(404).json({ error: 'La orden seleccionada no existe.' });
      ordenDescripcion = descripcionOrden(ordRows[0]);
    }

    const { rows } = await pool.query(
      `INSERT INTO seguros_vision (fecha, cliente_id, cliente_nombre, aseguradora, numero_poliza, orden_id, orden_descripcion, monto_reclamado, monto_cubierto, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, aseguradora, numero_poliza || null, orden_id || null, ordenDescripcion,
       numeroOCero(monto_reclamado), numeroOCero(monto_cubierto), estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'seguros_vision', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el reclamo.' });
  }
});

router.put('/:id', verificarPermiso('seguros_vision.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, cliente_id, aseguradora, numero_poliza, orden_id, monto_reclamado, monto_cubierto, estado, notas } = req.body;
  if (monto_reclamado !== undefined && monto_reclamado !== '' && numeroOCero(monto_reclamado) < 0) {
    return res.status(400).json({ error: 'El monto reclamado no puede ser negativo.' });
  }
  if (monto_cubierto !== undefined && monto_cubierto !== '' && numeroOCero(monto_cubierto) < 0) {
    return res.status(400).json({ error: 'El monto cubierto no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM seguros_vision WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    let ordenId = antes.orden_id, ordenDescripcion = antes.orden_descripcion;
    if (orden_id !== undefined && Number(orden_id || null) !== antes.orden_id) {
      if (!orden_id) {
        ordenId = null; ordenDescripcion = null;
      } else {
        const { rows: ordRows } = await pool.query(`SELECT armazon, tipo_lente FROM ordenes_laboratorio WHERE id=$1 AND empresa_id=$2`, [orden_id, empresaId]);
        if (!ordRows.length) return res.status(404).json({ error: 'La orden seleccionada no existe.' });
        ordenId = orden_id; ordenDescripcion = descripcionOrden(ordRows[0]);
      }
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;

    const { rows } = await pool.query(
      `UPDATE seguros_vision SET
         fecha = COALESCE($1, fecha), cliente_id = $2, cliente_nombre = $3,
         aseguradora = COALESCE($4, aseguradora), numero_poliza = $5,
         orden_id = $6, orden_descripcion = $7,
         monto_reclamado = COALESCE($8, monto_reclamado), monto_cubierto = COALESCE($9, monto_cubierto),
         estado = $10, notas = COALESCE($11, notas), actualizado_el = now()
       WHERE id=$12 AND empresa_id=$13 RETURNING *`,
      [fecha || null, clienteId, clienteNombre, aseguradora || null,
       numero_poliza !== undefined ? numero_poliza : antes.numero_poliza,
       ordenId, ordenDescripcion,
       monto_reclamado !== undefined && monto_reclamado !== '' ? numeroOCero(monto_reclamado) : null,
       monto_cubierto !== undefined && monto_cubierto !== '' ? numeroOCero(monto_cubierto) : null,
       estadoFinal, notas !== undefined ? notas : null, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reclamo no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'seguros_vision', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el reclamo.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'seguros_vision',
  modulo: 'seguros_vision',
  columnas: ['fecha', 'cliente_id', 'cliente_nombre', 'aseguradora', 'numero_poliza', 'orden_id', 'orden_descripcion', 'monto_reclamado', 'monto_cubierto', 'estado', 'notas'],
  camposRequeridos: ['fecha', 'cliente_id', 'cliente_nombre', 'aseguradora'],
  camposNumericos: ['cliente_id', 'orden_id', 'monto_reclamado', 'monto_cubierto'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { monto_reclamado: 0, monto_cubierto: 0, estado: 'enviado' }
}));

export default router;
