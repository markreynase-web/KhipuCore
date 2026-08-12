// src/routes/ordenesLaboratorio.js
// Seguimiento armazón/lente: pedido -> laboratorio -> listo -> entregado.
// POST/PUT manuales: snapshot de cliente_nombre + validación opcional de
// receta_id (si se linkea, debe existir Y pertenecer al mismo paciente --
// una receta de otro paciente sería un error de captura, no algo a permitir).

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['pedido', 'en_laboratorio', 'listo', 'entregado', 'cancelado'];
const TIPOS_LENTE_VALIDOS = ['monofocal', 'bifocal', 'progresivo', 'contacto'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function validarReceta(cliente, receta_id, empresaId, clienteId) {
  if (!receta_id) return { ok: true, valor: null };
  const { rows } = await cliente.query(`SELECT cliente_id FROM recetas_opticas WHERE id=$1 AND empresa_id=$2`, [receta_id, empresaId]);
  if (!rows.length) return { ok: false, error: 'La receta seleccionada no existe.' };
  if (rows[0].cliente_id !== Number(clienteId)) return { ok: false, error: 'Esa receta pertenece a otro paciente.' };
  return { ok: true, valor: receta_id };
}

router.post('/', verificarPermiso('ordenes_laboratorio.crear'), async (req, res) => {
  const { fecha, cliente_id, receta_id, armazon, tipo_lente, laboratorio, costo, estado, fecha_estimada_entrega, garantia_hasta, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un paciente.' });
  if (tipo_lente && !TIPOS_LENTE_VALIDOS.includes(tipo_lente)) return res.status(400).json({ error: `tipo_lente debe ser uno de: ${TIPOS_LENTE_VALIDOS.join(', ')}` });
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'pedido';

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El paciente seleccionado no existe.' }); }

    const receta = await validarReceta(cliente, receta_id, empresaId, cliente_id);
    if (!receta.ok) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: receta.error }); }

    const { rows } = await cliente.query(
      `INSERT INTO ordenes_laboratorio (fecha, cliente_id, cliente_nombre, receta_id, armazon, tipo_lente, laboratorio, costo, estado, fecha_estimada_entrega, garantia_hasta, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, receta.valor, armazon || null, tipo_lente || null, laboratorio || null,
       numeroOCero(costo), estadoFinal, fecha_estimada_entrega || null, garantia_hasta || null, notas || null, empresaId]
    );
    const orden = rows[0];
    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'crear', modulo: 'ordenes_laboratorio', registroId: orden.id, detalle: orden });
    await cliente.query('COMMIT');
    res.status(201).json(orden);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la orden de laboratorio.' });
  } finally {
    cliente.release();
  }
});

router.put('/:id', verificarPermiso('ordenes_laboratorio.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, cliente_id, receta_id, armazon, tipo_lente, laboratorio, costo, estado, fecha_estimada_entrega, garantia_hasta, notas } = req.body;
  if (tipo_lente && !TIPOS_LENTE_VALIDOS.includes(tipo_lente)) return res.status(400).json({ error: `tipo_lente debe ser uno de: ${TIPOS_LENTE_VALIDOS.join(', ')}` });
  if (costo !== undefined && costo !== '' && numeroOCero(costo) < 0) return res.status(400).json({ error: 'El costo no puede ser negativo.' });

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: antesRows } = await cliente.query(`SELECT * FROM ordenes_laboratorio WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!antesRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El paciente seleccionado no existe.' }); }
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    let recetaId = antes.receta_id;
    if (receta_id !== undefined && Number(receta_id || null) !== antes.receta_id) {
      if (!receta_id) {
        recetaId = null;
      } else {
        const receta = await validarReceta(cliente, receta_id, empresaId, clienteId);
        if (!receta.ok) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: receta.error }); }
        recetaId = receta.valor;
      }
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;
    const tipoLenteFinal = TIPOS_LENTE_VALIDOS.includes(tipo_lente) ? tipo_lente : antes.tipo_lente;

    const { rows } = await cliente.query(
      `UPDATE ordenes_laboratorio SET
         fecha = COALESCE($1, fecha), cliente_id = $2, cliente_nombre = $3, receta_id = $4,
         armazon = $5, tipo_lente = $6, laboratorio = $7,
         costo = COALESCE($8, costo), estado = $9,
         fecha_estimada_entrega = $10, garantia_hasta = $11, notas = $12, actualizado_el = now()
       WHERE id=$13 AND empresa_id=$14 RETURNING *`,
      [fecha || null, clienteId, clienteNombre, recetaId,
       armazon !== undefined ? armazon : antes.armazon, tipoLenteFinal, laboratorio !== undefined ? laboratorio : antes.laboratorio,
       costo !== undefined && costo !== '' ? numeroOCero(costo) : null, estadoFinal,
       fecha_estimada_entrega !== undefined ? fecha_estimada_entrega || null : antes.fecha_estimada_entrega,
       garantia_hasta !== undefined ? garantia_hasta || null : antes.garantia_hasta,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'editar', modulo: 'ordenes_laboratorio', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
    await cliente.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la orden de laboratorio.' });
  } finally {
    cliente.release();
  }
});

router.use(crearRouterCRUD({
  tabla: 'ordenes_laboratorio',
  modulo: 'ordenes_laboratorio',
  columnas: ['fecha', 'cliente_id', 'cliente_nombre', 'receta_id', 'armazon', 'tipo_lente', 'laboratorio', 'costo', 'estado', 'fecha_estimada_entrega', 'garantia_hasta', 'notas'],
  camposRequeridos: ['fecha', 'cliente_id', 'cliente_nombre'],
  camposNumericos: ['cliente_id', 'receta_id', 'costo'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { costo: 0, estado: 'pedido' }
}));

export default router;
