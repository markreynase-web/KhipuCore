// src/routes/planesTratamiento.js
// Planes de tratamiento: descripción (fases, en texto -- no hay carrito de
// líneas en ningún módulo todavía), presupuesto y aprobación del paciente.
// POST/PUT manuales por el mismo motivo que tratamientos.js (snapshot de
// cliente_nombre) + una regla propia: fecha_aprobacion se completa sola,
// del lado del servidor, la primera vez que el estado pasa a 'aprobado' --
// no se confía en lo que mande el cliente para esa fecha.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('planes_tratamiento'));

const ESTADOS_VALIDOS = ['propuesto', 'aprobado', 'rechazado', 'en_progreso', 'completado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('planes_tratamiento.crear'), async (req, res) => {
  const { fecha, cliente_id, descripcion, presupuesto_total, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un paciente.' });
  if (!descripcion) return res.status(400).json({ error: 'Describe el plan de tratamiento.' });
  if (presupuesto_total !== undefined && presupuesto_total !== '' && numeroOCero(presupuesto_total) < 0) {
    return res.status(400).json({ error: 'El presupuesto no puede ser negativo.' });
  }
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'propuesto';
  const fechaAprobacion = estadoFinal === 'aprobado' ? fecha : null;

  try {
    const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO planes_tratamiento (fecha, cliente_id, cliente_nombre, descripcion, presupuesto_total, estado, fecha_aprobacion, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, descripcion, numeroOCero(presupuesto_total), estadoFinal, fechaAprobacion, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'planes_tratamiento', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el plan de tratamiento.' });
  }
});

router.put('/:id', verificarPermiso('planes_tratamiento.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, cliente_id, descripcion, presupuesto_total, estado, notas } = req.body;
  if (presupuesto_total !== undefined && presupuesto_total !== '' && numeroOCero(presupuesto_total) < 0) {
    return res.status(400).json({ error: 'El presupuesto no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM planes_tratamiento WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Plan de tratamiento no encontrado.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado;
    // Solo se completa la primera vez que llega a 'aprobado' -- si ya tenía
    // fecha_aprobacion (ej. se aprobó, se corrigió otro campo después), no
    // se vuelve a pisar con la fecha de hoy.
    const fechaAprobacion = estadoFinal === 'aprobado' && !antes.fecha_aprobacion
      ? (fecha || antes.fecha)
      : (estadoFinal === 'aprobado' ? antes.fecha_aprobacion : null);

    const { rows } = await pool.query(
      `UPDATE planes_tratamiento SET
         fecha = COALESCE($1, fecha), cliente_id = $2, cliente_nombre = $3,
         descripcion = COALESCE($4, descripcion), presupuesto_total = COALESCE($5, presupuesto_total),
         estado = $6, fecha_aprobacion = $7, notas = COALESCE($8, notas), actualizado_el = now()
       WHERE id=$9 AND empresa_id=$10 RETURNING *`,
      [fecha || null, clienteId, clienteNombre, descripcion || null,
       presupuesto_total !== undefined && presupuesto_total !== '' ? numeroOCero(presupuesto_total) : null,
       estadoFinal, fechaAprobacion, notas !== undefined ? notas : null, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Plan de tratamiento no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'planes_tratamiento', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el plan de tratamiento.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'planes_tratamiento',
  modulo: 'planes_tratamiento',
  columnas: ['fecha', 'cliente_id', 'cliente_nombre', 'descripcion', 'presupuesto_total', 'estado', 'fecha_aprobacion', 'notas'],
  camposRequeridos: ['fecha', 'cliente_id', 'cliente_nombre', 'descripcion'],
  camposNumericos: ['cliente_id', 'presupuesto_total'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { presupuesto_total: 0, estado: 'propuesto' }
}));

export default router;
