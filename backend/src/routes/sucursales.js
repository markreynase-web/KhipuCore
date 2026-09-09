// src/routes/sucursales.js
// CRUD de sucursales. A propósito NO pasa por crudFactory.js: ese helper
// exige requireModulo(modulo) en cada verbo, pensado para módulos vendibles
// (ventas, inventario, ...) que una empresa puede tener contratados o no.
// Sucursales es transversal -- lo usan inventario, ventas y cajas por igual,
// así que sigue el mismo criterio que usuarios.js (gestión de cuenta): solo
// auth() + requireEmpresa() + verificarPermiso(), sin candado de módulo.
//
// "principal" NO es editable ni asignable por API: es la marca interna que
// dejó el backfill de la migración 036 (la sucursal automática creada para
// no perder el inventario existente al lanzar esta feature) -- ni el body
// de POST ni el de PUT la tocan, y DELETE la protege explícitamente más
// abajo para que nunca quede una empresa sin ninguna sucursal marcada.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { resolverRestriccionSucursal } from '../middleware/sucursal.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
// Sub-fase D (hallazgo tardío, corregido acá): este archivo se escribió en
// la Sub-fase B, antes de que existiera la restricción usuario-por-sucursal
// -- se había quedado sin este middleware, así que un usuario restringido
// veía TODAS las sucursales de la empresa en vez de solo la suya. La propia
// tabla ES la de sucursales, así que "restringido" acá significa "solo la
// fila cuyo id es la suya", no un WHERE sucursal_id=... como en el resto.
router.use(auth, requireEmpresa, resolverRestriccionSucursal);

function limpiar(body) {
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const direccion = typeof body.direccion === 'string' ? body.direccion.trim() : (body.direccion ?? null);
  return { nombre, direccion: direccion || null };
}

// GET / -- toda sucursal de la empresa (activas e inactivas; el frontend
// decide si oculta las inactivas, igual que hace con otros catálogos).
// Restringido (Sub-fase D): solo su propia fila -- no tiene "otras
// sucursales" que ver, aunque existan en la empresa.
router.get('/', verificarPermiso('sucursales.ver'), async (req, res) => {
  const valores = req.sucursalRestringida != null
    ? [req.usuario.empresa_id, req.sucursalRestringida]
    : [req.usuario.empresa_id];
  const condId = req.sucursalRestringida != null ? ' AND id = $2' : '';
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sucursales WHERE empresa_id = $1${condId} ORDER BY principal DESC, nombre ASC`,
      valores
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer las sucursales.' });
  }
});

// POST / -- nueva sucursal, siempre con principal=false (una empresa solo
// tiene la que dejó el backfill como principal; reasignarla no es parte de
// esta sub-fase).
router.post('/', verificarPermiso('sucursales.crear'), async (req, res) => {
  const { nombre, direccion } = limpiar(req.body);
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO sucursales (empresa_id, nombre, direccion) VALUES ($1,$2,$3) RETURNING *`,
      [req.usuario.empresa_id, nombre, direccion]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'sucursales', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la sucursal.' });
  }
});

// PUT /:id -- nombre/dirección/activo. "principal" ausente a propósito de
// la lista de columnas: aunque venga en el body, se ignora.
router.put('/:id', verificarPermiso('sucursales.editar'), async (req, res) => {
  const bodyTieneNombre = Object.prototype.hasOwnProperty.call(req.body || {}, 'nombre');
  const bodyTieneDireccion = Object.prototype.hasOwnProperty.call(req.body || {}, 'direccion');
  const bodyTieneActivo = Object.prototype.hasOwnProperty.call(req.body || {}, 'activo');
  const { nombre, direccion } = limpiar(req.body);
  if (bodyTieneNombre && !nombre) return res.status(400).json({ error: 'nombre no puede quedar vacío' });

  // Restringido: acceso indirecto por id -- 404 si intenta editar una
  // sucursal que no es la suya, mismo criterio que el resto del proyecto.
  // Consultas con su propia numeración de parámetros cada una (nunca
  // comparten posiciones entre el SELECT y el UPDATE).
  const restringido = req.sucursalRestringida != null;
  const condSelect = restringido ? ' AND id = $3' : '';
  const valoresSelect = restringido
    ? [req.params.id, req.usuario.empresa_id, req.sucursalRestringida]
    : [req.params.id, req.usuario.empresa_id];
  try {
    const { rows: antesRows } = await pool.query(
      `SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2${condSelect}`,
      valoresSelect
    );
    if (!antesRows.length) return res.status(404).json({ error: 'Sucursal no encontrada.' });

    const valoresUpdate = [req.params.id, req.usuario.empresa_id, bodyTieneNombre, nombre, bodyTieneDireccion, direccion, bodyTieneActivo, req.body?.activo];
    if (restringido) valoresUpdate.push(req.sucursalRestringida);
    const { rows } = await pool.query(
      `UPDATE sucursales SET
         nombre = CASE WHEN $3 THEN $4 ELSE nombre END,
         direccion = CASE WHEN $5 THEN $6 ELSE direccion END,
         activo = CASE WHEN $7 THEN $8 ELSE activo END,
         actualizado_el = now()
       WHERE id = $1 AND empresa_id = $2${restringido ? ' AND id = $9' : ''} RETURNING *`,
      // El valor crudo se manda tal cual (sin forzarlo con !!) -- Postgres ya
      // sabe interpretar tanto un boolean real como el texto "true"/"false"
      // para una columna BOOLEAN; un !! acá convertiría por error el string
      // "false" (JS lo ve truthy, por ser un string no vacío) en `true`
      // antes de que la query siquiera lo viera. Sin bodyTieneActivo, este
      // valor ni se usa (el CASE lo descarta), así que un undefined acá es inofensivo.
      valoresUpdate
    );
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'sucursales', registroId: req.params.id, detalle: { antes: antesRows[0], despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la sucursal.' });
  }
});

// DELETE /:id -- nunca la principal (una empresa siempre necesita al menos
// una sucursal "de caída" para inventario/ventas históricos), y nunca una
// que ya tenga inventario, ventas o cajas apuntándole -- las columnas
// sucursal_id de esas tablas referencian sucursales(id) sin ON DELETE
// CASCADE (a propósito), así que Postgres ya lo rechazaría solo; acá se
// adelanta con un mensaje claro en vez de un 500 genérico de FK violation.
router.delete('/:id', verificarPermiso('sucursales.eliminar'), async (req, res) => {
  // Restringido: acceso indirecto por id -- 404 antes de siquiera llegar a
  // "es la principal" o "está en uso", mismo criterio que el resto.
  const restringido = req.sucursalRestringida != null;
  const condSelect = restringido ? ' AND id = $3' : '';
  const valoresSelect = restringido
    ? [req.params.id, req.usuario.empresa_id, req.sucursalRestringida]
    : [req.params.id, req.usuario.empresa_id];
  try {
    const { rows: antesRows } = await pool.query(
      `SELECT * FROM sucursales WHERE id = $1 AND empresa_id = $2${condSelect}`,
      valoresSelect
    );
    if (!antesRows.length) return res.status(404).json({ error: 'Sucursal no encontrada.' });
    if (antesRows[0].principal) {
      return res.status(400).json({ error: 'No se puede eliminar la sucursal principal.' });
    }

    const { rows: enUso } = await pool.query(
      `SELECT
         (SELECT count(*) FROM inventario WHERE sucursal_id = $1)::int AS inventario,
         (SELECT count(*) FROM ventas WHERE sucursal_id = $1)::int AS ventas,
         (SELECT count(*) FROM cajas WHERE sucursal_id = $1)::int AS cajas`,
      [req.params.id]
    );
    const { inventario, ventas, cajas } = enUso[0];
    if (inventario || ventas || cajas) {
      return res.status(409).json({ error: 'No se puede eliminar: la sucursal todavía tiene inventario, ventas o cajas asociadas.' });
    }

    await pool.query(`DELETE FROM sucursales WHERE id = $1 AND empresa_id = $2${condSelect}`, valoresSelect);
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'sucursales', registroId: req.params.id, detalle: { eliminado: antesRows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo eliminar la sucursal.' });
  }
});

export default router;
