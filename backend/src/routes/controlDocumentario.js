// src/routes/controlDocumentario.js
// Vencimientos de documentos, de UN vehículo o UN conductor (nunca los
// dos) -- mismo patrón de fecha que garantia_hasta en Automotriz/Óptica,
// pero polimórfico. POST/PUT son manuales para: (a) resolver el snapshot
// entidad_descripcion desde flota o conductores según entidad_tipo, y
// (b) mantener la garantía "exactamente uno de flota_id/conductor_id" que
// también exige el CHECK de la base (ver 025_transporte.sql) -- se valida
// acá primero para devolver un 400 claro en vez de que la CHECK constraint
// lo rebote como 500.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('control_documentario'));

const ENTIDADES_VALIDAS = ['vehiculo', 'conductor'];
const ESTADOS_VALIDOS = ['vigente', 'vencido'];

async function resolverEntidad(empresaId, entidadTipo, flotaId, conductorId) {
  if (entidadTipo === 'vehiculo') {
    const { rows } = await pool.query(`SELECT placa, marca, modelo FROM flota WHERE id=$1 AND empresa_id=$2`, [flotaId, empresaId]);
    return rows[0] ? `${rows[0].placa} · ${rows[0].marca} ${rows[0].modelo}` : null;
  }
  const { rows } = await pool.query(`SELECT nombre FROM conductores WHERE id=$1 AND empresa_id=$2`, [conductorId, empresaId]);
  return rows[0]?.nombre || null;
}

router.post('/', verificarPermiso('control_documentario.crear'), async (req, res) => {
  const { entidad_tipo, flota_id, conductor_id, tipo_documento, numero_documento, fecha_emision, fecha_vencimiento, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!ENTIDADES_VALIDAS.includes(entidad_tipo)) return res.status(400).json({ error: `entidad_tipo debe ser uno de: ${ENTIDADES_VALIDAS.join(', ')}` });
  if (entidad_tipo === 'vehiculo' && !flota_id) return res.status(400).json({ error: 'Selecciona una unidad.' });
  if (entidad_tipo === 'conductor' && !conductor_id) return res.status(400).json({ error: 'Selecciona un conductor.' });
  if (!tipo_documento) return res.status(400).json({ error: 'Indica el tipo de documento.' });
  if (!fecha_vencimiento) return res.status(400).json({ error: 'fecha_vencimiento es requerido.' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'vigente';

  try {
    const descripcion = await resolverEntidad(empresaId, entidad_tipo, flota_id, conductor_id);
    if (!descripcion) return res.status(404).json({ error: entidad_tipo === 'vehiculo' ? 'La unidad seleccionada no existe.' : 'El conductor seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO control_documentario (entidad_tipo, flota_id, conductor_id, entidad_descripcion, tipo_documento, numero_documento, fecha_emision, fecha_vencimiento, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [entidad_tipo, entidad_tipo === 'vehiculo' ? flota_id : null, entidad_tipo === 'conductor' ? conductor_id : null,
       descripcion, String(tipo_documento).trim(), numero_documento || null, fecha_emision || null,
       fecha_vencimiento, estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'control_documentario', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el documento.' });
  }
});

// entidad_tipo NO se puede cambiar en una edición a propósito -- cambiar de
// "documento de vehículo" a "documento de conductor" a media edición no es
// una corrección de datos, es un registro distinto; se borra y se crea de
// nuevo si de verdad hace falta.
router.put('/:id', verificarPermiso('control_documentario.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { flota_id, conductor_id, tipo_documento, numero_documento, fecha_emision, fecha_vencimiento, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM control_documentario WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Documento no encontrado.' });
    const antes = antesRows[0];

    let descripcion = antes.entidad_descripcion;
    let flotaId = antes.flota_id, conductorId = antes.conductor_id;
    if (antes.entidad_tipo === 'vehiculo' && flota_id !== undefined && flota_id !== '' && Number(flota_id) !== antes.flota_id) {
      const desc = await resolverEntidad(empresaId, 'vehiculo', flota_id, null);
      if (!desc) return res.status(404).json({ error: 'La unidad seleccionada no existe.' });
      flotaId = flota_id; descripcion = desc;
    }
    if (antes.entidad_tipo === 'conductor' && conductor_id !== undefined && conductor_id !== '' && Number(conductor_id) !== antes.conductor_id) {
      const desc = await resolverEntidad(empresaId, 'conductor', null, conductor_id);
      if (!desc) return res.status(404).json({ error: 'El conductor seleccionado no existe.' });
      conductorId = conductor_id; descripcion = desc;
    }

    const { rows } = await pool.query(
      `UPDATE control_documentario SET
         flota_id = $1, conductor_id = $2, entidad_descripcion = $3,
         tipo_documento = COALESCE($4, tipo_documento), numero_documento = $5,
         fecha_emision = $6, fecha_vencimiento = COALESCE($7, fecha_vencimiento),
         estado = $8, notas = $9, actualizado_el = now()
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [flotaId, conductorId, descripcion, tipo_documento || null,
       numero_documento !== undefined ? numero_documento : antes.numero_documento,
       fecha_emision !== undefined ? fecha_emision : antes.fecha_emision,
       fecha_vencimiento || null, ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Documento no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'control_documentario', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el documento.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'control_documentario',
  modulo: 'control_documentario',
  columnas: ['entidad_tipo', 'flota_id', 'conductor_id', 'entidad_descripcion', 'tipo_documento', 'numero_documento', 'fecha_emision', 'fecha_vencimiento', 'estado', 'notas'],
  camposRequeridos: ['entidad_tipo', 'entidad_descripcion', 'tipo_documento', 'fecha_vencimiento'],
  camposNumericos: ['flota_id', 'conductor_id'],
  columnaFecha: 'fecha_vencimiento',
  valoresPorDefecto: { estado: 'vigente' }
}));

export default router;
