// src/routes/vehiculos.js
// Vehículos de CLIENTES (para dar seguimiento en Postventa) -- no es el
// inventario de venta propio de la concesionaria; eso seguiría usando el
// módulo genérico Inventario si algún día hace falta.
//
// POST y PUT son manuales porque necesitan resolver cliente_nombre (la
// "foto" del nombre del cliente -- crudFactory no hace JOIN en su SELECT
// genérico, ver 014_vertical_automotriz.sql). GET, DELETE y POST /import no
// tienen ese problema, se quedan en el CRUD genérico.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../auditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('vehiculos.crear'), async (req, res) => {
  const { fecha_registro, cliente_id, placa, marca, modelo, anio, vin, color, kilometraje_actual, notas } = req.body;
  if (!fecha_registro || !cliente_id || !placa || !marca || !modelo) {
    return res.status(400).json({ error: 'fecha_registro, cliente_id, placa, marca y modelo son requeridos.' });
  }
  if (kilometraje_actual !== undefined && kilometraje_actual !== '' && numeroOCero(kilometraje_actual) < 0) {
    return res.status(400).json({ error: 'El kilometraje no puede ser negativo.' });
  }
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows: cliRows } = await pool.query(
      `SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]
    );
    if (!cliRows.length) return res.status(404).json({ error: 'El cliente seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO vehiculos (fecha_registro, cliente_id, cliente_nombre, placa, marca, modelo, anio, vin, color, kilometraje_actual, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [fecha_registro, cliente_id, cliRows[0].nombre, String(placa).trim(), String(marca).trim(), String(modelo).trim(),
       anio || null, vin || null, color || null, numeroOCero(kilometraje_actual), notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'vehiculos', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar el vehículo.' });
  }
});

// A diferencia de postventa.js, cliente_id SÍ se puede cambiar aquí (un
// vehículo puede cambiar de dueño) -- si viene y es distinto, se re-resuelve
// cliente_nombre; si no viene, se conserva el dueño actual.
router.put('/:id', verificarPermiso('vehiculos.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha_registro, cliente_id, placa, marca, modelo, anio, vin, color, kilometraje_actual, notas } = req.body;
  if (kilometraje_actual !== undefined && kilometraje_actual !== '' && numeroOCero(kilometraje_actual) < 0) {
    return res.status(400).json({ error: 'El kilometraje no puede ser negativo.' });
  }

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM vehiculos WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Vehículo no encontrado.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id;
    let clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El cliente seleccionado no existe.' });
      clienteId = cliente_id;
      clienteNombre = cliRows[0].nombre;
    }

    const { rows } = await pool.query(
      `UPDATE vehiculos SET
         fecha_registro = COALESCE($1, fecha_registro),
         cliente_id = $2, cliente_nombre = $3,
         placa = COALESCE($4, placa), marca = COALESCE($5, marca), modelo = COALESCE($6, modelo),
         anio = COALESCE($7, anio), vin = COALESCE($8, vin), color = COALESCE($9, color),
         kilometraje_actual = COALESCE($10, kilometraje_actual), notas = COALESCE($11, notas),
         actualizado_el = now()
       WHERE id=$12 AND empresa_id=$13 RETURNING *`,
      [fecha_registro || null, clienteId, clienteNombre, placa || null, marca || null, modelo || null,
       anio || null, vin || null, color || null,
       kilometraje_actual !== undefined && kilometraje_actual !== '' ? numeroOCero(kilometraje_actual) : null,
       notas !== undefined ? notas : null, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vehículo no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'vehiculos', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el vehículo.' });
  }
});

// GET, DELETE y POST /import: sin efectos secundarios, se quedan en el CRUD
// genérico. Como este router ya definió su propio POST y PUT arriba,
// Express nunca llega a los de acá abajo para esos dos verbos -- por eso es
// seguro incluir "cliente_nombre" en `columnas` aquí (solo importa para el
// import de CSV, que no puede resolverlo por su cuenta): el formulario de
// la UI pasa por el POST/PUT de arriba, que SIEMPRE lo resuelve del lado
// del servidor y jamás confía en lo que mande el body. Un CSV de vehículos
// debe traer su propia columna "cliente_nombre" con el nombre exacto del
// cliente ya registrado -- sin eso, el import falla con NOT NULL.
router.use(crearRouterCRUD({
  tabla: 'vehiculos',
  modulo: 'vehiculos',
  columnas: ['fecha_registro', 'cliente_id', 'cliente_nombre', 'placa', 'marca', 'modelo', 'anio', 'vin', 'color', 'kilometraje_actual', 'notas'],
  camposRequeridos: ['fecha_registro', 'cliente_id', 'cliente_nombre', 'placa', 'marca', 'modelo'],
  camposNumericos: ['cliente_id', 'anio', 'kilometraje_actual'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { kilometraje_actual: 0 }
}));

export default router;
