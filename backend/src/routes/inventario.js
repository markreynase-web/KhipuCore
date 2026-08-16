// src/routes/inventario.js
// GET, PUT y el import de CSV siguen siendo el CRUD genérico (crudFactory) --
// no tienen efectos secundarios en otras tablas. POST y DELETE sí son
// personalizados: cada producto nuevo con stock inicial deja un egreso
// automático en Finanzas (el costo de surtir ese stock), y borrar el
// producto borra ese mismo egreso -- mismo patrón que ventas.js con sus
// ingresos, para que Finanzas nunca quede con movimientos "huérfanos".
//
// Fase A (multi-tenant): POST/DELETE son manuales (no pasan por
// crudFactory.js), así que agregan "empresa_id" a mano en cada consulta.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('inventario'));

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// POST / -- crea el producto y, si entra con stock, un egreso en Finanzas
// por ese stock inicial. Va todo en una transacción: o se crea el producto
// y su egreso juntos, o no se crea nada.
router.post('/', verificarPermiso('inventario.crear'), async (req, res) => {
  const { fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, costo_unitario, fecha_vencimiento, notas } = req.body;
  if (!fecha_registro || !nombre) return res.status(400).json({ error: 'fecha_registro y nombre son requeridos' });

  const stockNum = numeroOCero(stock);
  const stockMinNum = numeroOCero(stock_minimo);
  const precioNum = numeroOCero(precio_unitario);
  const costoNum = numeroOCero(costo_unitario);
  const empresaId = req.usuario.empresa_id;

  // El PUT genérico (crudFactory.js -> limpiarYValidar) ya rechaza campos
  // numéricos negativos, pero este POST es manual y no pasaba por ahí --
  // sin este candado se podía crear un producto con stock negativo, lo que
  // además hacía que el egreso automático de abajo (stock*costo) saliera
  // negativo y el guard `montoEgreso > 0` lo saltara en silencio.
  if (stockNum < 0 || stockMinNum < 0 || precioNum < 0 || costoNum < 0) {
    return res.status(400).json({ error: 'Stock, stock mínimo, precio y costo no pueden ser negativos.' });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `INSERT INTO inventario (fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, costo_unitario, fecha_vencimiento, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fecha_registro, String(nombre).trim(), categoria || null, stockNum, stockMinNum, precioNum, costoNum, fecha_vencimiento || null, notas || null, empresaId]
    );
    const producto = rows[0];

    // El egreso es lo que costó COMPRAR el stock, no lo que va a costar
    // venderlo -- por eso usa costo_unitario (precio de compra) y no
    // precio_unitario (precio de venta). Si no se indica costo (0 o vacío),
    // no se genera egreso -- no hay forma de saber cuánto gastó sin ese dato.
    const montoEgreso = +(stockNum * costoNum).toFixed(2);
    if (montoEgreso > 0) {
      await cliente.query(
        `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, origen_modulo, origen_id, empresa_id)
         VALUES ($1, 'egreso', 'Inventario', $2, $3, 'inventario', $4, $5)`,
        [fecha_registro, `Stock inicial: ${producto.nombre} (${stockNum} unidad(es))`, montoEgreso, producto.id, empresaId]
      );
    }

    await registrarAuditoria(cliente, {
      usuario: req.usuario, accion: 'crear', modulo: 'inventario', registroId: producto.id,
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
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM inventario WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado.' }); }
    const producto = rows[0];

    await cliente.query(`DELETE FROM finanzas WHERE origen_modulo = 'inventario' AND origen_id = $1 AND empresa_id = $2`, [producto.id, empresaId]);
    await cliente.query(`DELETE FROM inventario WHERE id = $1 AND empresa_id = $2`, [producto.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'inventario', registroId: producto.id, detalle: { eliminado: producto } });
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
// quedan en el CRUD genérico (que ya scoped por empresa_id, ver
// crudFactory.js). Como este router ya definió su propio POST y DELETE
// arriba, Express nunca llega a los de acá abajo para esos dos verbos.
router.use(crearRouterCRUD({
  tabla: 'inventario',
  modulo: 'inventario',
  columnas: ['fecha_registro', 'nombre', 'categoria', 'stock', 'stock_minimo', 'precio_unitario', 'costo_unitario', 'fecha_vencimiento', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['stock', 'stock_minimo', 'precio_unitario', 'costo_unitario'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { stock: 0, stock_minimo: 0 }
}));

export default router;
