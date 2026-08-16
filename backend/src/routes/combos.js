// src/routes/combos.js
// La RECETA del combo: qué productos de inventario lo componen y en qué
// cantidad (columna `items`, JSONB -- ver 026_polleria.sql). Es 100% manual
// (no pasa por crudFactory.js) porque `items` necesita su propia
// validación: cada producto_id debe existir de verdad en el inventario de
// esta empresa, y producto_nombre se resuelve del lado del servidor
// (snapshot), nunca se confía en el nombre que mande el cliente -- mismo
// criterio de "nunca confiar en lo que manda el body" que el resto de la
// app, aplicado a cada elemento de la lista en vez de a un solo campo.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('combos'));

const ESTADOS_VALIDOS = ['activo', 'inactivo'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Valida la forma de `items` y resuelve producto_nombre para cada uno
// contra el inventario real de la empresa. Devuelve { error } si algo no
// cuadra, o { items } ya con los nombres resueltos.
async function resolverItems(empresaId, itemsCrudos) {
  if (!Array.isArray(itemsCrudos) || !itemsCrudos.length) {
    return { error: 'El combo necesita al menos un producto.' };
  }
  const items = [];
  for (const item of itemsCrudos) {
    const productoId = Number(item?.producto_id);
    const cantidad = numeroOCero(item?.cantidad);
    if (!productoId) return { error: 'Cada elemento del combo necesita un producto_id válido.' };
    if (cantidad <= 0) return { error: 'La cantidad de cada producto del combo debe ser mayor a 0.' };
    const { rows } = await pool.query(`SELECT id, nombre FROM inventario WHERE id=$1 AND empresa_id=$2`, [productoId, empresaId]);
    if (!rows.length) return { error: `Uno de los productos del combo ya no existe en inventario (id ${productoId}).` };
    items.push({ producto_id: productoId, producto_nombre: rows[0].nombre, cantidad });
  }
  return { items };
}

router.get('/', verificarPermiso('combos.ver'), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM combos WHERE empresa_id=$1 ORDER BY nombre`, [req.usuario.empresa_id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los combos.' });
  }
});

router.post('/', verificarPermiso('combos.crear'), async (req, res) => {
  const { nombre, descripcion, precio, items, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  const precioNum = numeroOCero(precio);
  if (precioNum <= 0) return res.status(400).json({ error: 'El precio debe ser mayor a 0.' });
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'activo';

  const { error, items: itemsResueltos } = await resolverItems(empresaId, items);
  if (error) return res.status(400).json({ error });

  try {
    const { rows } = await pool.query(
      `INSERT INTO combos (nombre, descripcion, precio, items, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [String(nombre).trim(), descripcion || null, precioNum, JSON.stringify(itemsResueltos), estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'combos', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el combo.' });
  }
});

router.put('/:id', verificarPermiso('combos.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { nombre, descripcion, precio, items, estado, notas } = req.body;
  if (estado && !ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });
  if (precio !== undefined && precio !== '' && numeroOCero(precio) <= 0) return res.status(400).json({ error: 'El precio debe ser mayor a 0.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM combos WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Combo no encontrado.' });
    const antes = antesRows[0];

    let itemsFinal = antes.items;
    if (items !== undefined) {
      const { error, items: itemsResueltos } = await resolverItems(empresaId, items);
      if (error) return res.status(400).json({ error });
      itemsFinal = itemsResueltos;
    }

    const { rows } = await pool.query(
      `UPDATE combos SET nombre = COALESCE($1, nombre), descripcion = $2, precio = COALESCE($3, precio),
         items = $4, estado = $5, notas = $6, actualizado_el = now()
       WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [nombre || null, descripcion !== undefined ? descripcion : antes.descripcion,
       precio !== undefined && precio !== '' ? numeroOCero(precio) : null,
       JSON.stringify(itemsFinal), ESTADOS_VALIDOS.includes(estado) ? estado : antes.estado,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Combo no encontrado.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'combos', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el combo.' });
  }
});

router.delete('/:id', verificarPermiso('combos.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  try {
    const { rows: enUso } = await pool.query(`SELECT count(*)::int AS n FROM combo_ventas WHERE combo_id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (enUso[0].n > 0) return res.status(400).json({ error: `No se puede borrar: hay ${enUso[0].n} venta(s) registradas de este combo.` });

    const { rows } = await pool.query(`DELETE FROM combos WHERE id=$1 AND empresa_id=$2 RETURNING *`, [req.params.id, empresaId]);
    if (!rows.length) return res.status(404).json({ error: 'Combo no encontrado.' });
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'combos', registroId: req.params.id, detalle: { eliminado: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el combo.' });
  }
});

export default router;
