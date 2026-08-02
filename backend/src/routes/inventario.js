// src/routes/inventario.js
// GET, PUT y el import de CSV siguen siendo el CRUD genérico (crudFactory) --
// no tienen efectos secundarios en otras tablas. POST y DELETE sí son
// personalizados: cada producto nuevo con stock inicial deja un egreso
// automático en Finanzas (el costo de surtir ese stock), y borrar el
// producto borra ese mismo egreso -- mismo patrón que ventas.js con sus
// ingresos, para que Finanzas nunca quede con movimientos "huérfanos".

import { Router } from 'express';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';

const router = Router();
router.use(auth);

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function registrarAuditoria(cliente, { usuario, accion, registroId, detalle }) {
  try {
    await cliente.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, modulo, registro_id, detalle)
       VALUES ($1, $2, $3, 'inventario', $4, $5)`,
      [usuario?.id ?? null, usuario?.nombre ?? 'Desconocido', accion, registroId ? String(registroId) : null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (err) {
    console.error('No se pudo escribir en audit_log:', err.message);
  }
}

// POST / -- crea el producto y, si entra con stock, un egreso en Finanzas
// por ese stock inicial. Va todo en una transacción: o se crea el producto
// y su egreso juntos, o no se crea nada.
router.post('/', verificarPermiso('inventario.crear'), async (req, res) => {
  const { fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, fecha_vencimiento, notas } = req.body;
  if (!fecha_registro || !nombre) return res.status(400).json({ error: 'fecha_registro y nombre son requeridos' });

  const stockNum = numeroOCero(stock);
  const stockMinNum = numeroOCero(stock_minimo);
  const precioNum = numeroOCero(precio_unitario);

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `INSERT INTO inventario (fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, fecha_vencimiento, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [fecha_registro, String(nombre).trim(), categoria || null, stockNum, stockMinNum, precioNum, fecha_vencimiento || null, notas || null]
    );
    const producto = rows[0];

    // Todavía no existe un campo de "costo" separado del precio de venta
    // (ver LEEME_FASE5.md, pendiente) -- por ahora el egreso usa
    // precio_unitario * stock como aproximación. Si en el futuro se agrega
    // un campo de costo real, este cálculo debería usar ese en vez de
    // precio_unitario. Con stock 0 (producto sin existencias todavía) no
    // se genera ningún movimiento -- no hay gasto que registrar.
    const montoEgreso = +(stockNum * precioNum).toFixed(2);
    if (montoEgreso > 0) {
      await cliente.query(
        `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, origen_modulo, origen_id)
         VALUES ($1, 'egreso', 'Inventario', $2, $3, 'inventario', $4)`,
        [fecha_registro, `Stock inicial: ${producto.nombre} (${stockNum} unidad(es))`, montoEgreso, producto.id]
      );
    }

    await registrarAuditoria(cliente, {
      usuario: req.usuario, accion: 'crear', registroId: producto.id,
      detalle: { ...producto, egresoGenerado: montoEgreso > 0 ? montoEgreso : null }
    });
    await cliente.query('COMMIT');
    res.status(201).json(producto);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el producto.' });
  } finally {
    cliente.release();
  }
});

// DELETE /:id -- borra el producto y, si tenía, su egreso de stock inicial
// en Finanzas (para no dejarlo huérfano apuntando a un producto que ya no existe).
router.delete('/:id', verificarPermiso('inventario.eliminar'), async (req, res) => {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM inventario WHERE id = $1 FOR UPDATE`, [req.params.id]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado.' }); }
    const producto = rows[0];

    await cliente.query(`DELETE FROM finanzas WHERE origen_modulo = 'inventario' AND origen_id = $1`, [producto.id]);
    await cliente.query(`DELETE FROM inventario WHERE id = $1`, [producto.id]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', registroId: producto.id, detalle: { eliminado: producto } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el producto.' });
  } finally {
    cliente.release();
  }
});

// GET, PUT y POST /import: sin efectos secundarios en otras tablas, se
// quedan en el CRUD genérico. Como este router ya definió su propio POST y
// DELETE arriba, Express nunca llega a los de acá abajo para esos dos verbos.
router.use(crearRouterCRUD({
  tabla: 'inventario',
  modulo: 'inventario',
  columnas: ['fecha_registro', 'nombre', 'categoria', 'stock', 'stock_minimo', 'precio_unitario', 'fecha_vencimiento', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['stock', 'stock_minimo', 'precio_unitario'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { stock: 0, stock_minimo: 0 }
}));

export default router;
