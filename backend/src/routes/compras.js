// src/routes/compras.js
// Órdenes de compra a proveedores, para UN producto existente de Inventario
// (sin carrito de líneas, mismo criterio del resto de la app). Pedirla no
// mueve nada; RECIBIRLA es lo que suma stock a Inventario y deja un egreso
// real en Finanzas (origen_modulo='compras') -- mismo patrón que
// inventario.js con el stock inicial, pero disparado por un cambio de
// estado en vez de la creación del producto.
//
// Una vez 'recibido' el estado queda fijo (no se puede volver a 'pedido' ni
// a 'cancelado') -- deshacerlo significaría revertir stock Y el egreso de
// Finanzas a la vez, con el riesgo de que ese stock ya se haya usado/vendido
// mientras tanto. Corregir una recepción equivocada es borrar la compra
// (el DELETE de abajo sí revierte todo de forma segura) y volver a crear.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

const ESTADOS_VALIDOS = ['pedido', 'recibido', 'cancelado'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('compras.crear'), async (req, res) => {
  const { fecha, proveedor, producto_id, cantidad, costo_unitario, estado, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!proveedor) return res.status(400).json({ error: 'Indica el proveedor.' });
  if (!producto_id) return res.status(400).json({ error: 'Selecciona un producto.' });
  const cantidadNum = numeroOCero(cantidad) || 1;
  const costoNum = numeroOCero(costo_unitario);
  if (cantidadNum <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' });
  if (costoNum < 0) return res.status(400).json({ error: 'El costo unitario no puede ser negativo.' });
  // 'recibido' NO se acepta al crear -- tiene que pasar por el flujo de PUT
  // para que el efecto de stock/Finanzas se dispare siempre por el mismo
  // camino (evita duplicar la lógica de recepción en dos lugares distintos).
  const estadoFinal = estado === 'cancelado' ? 'cancelado' : 'pedido';

  try {
    const { rows: prodRows } = await pool.query(`SELECT nombre FROM inventario WHERE id=$1 AND empresa_id=$2`, [producto_id, empresaId]);
    if (!prodRows.length) return res.status(404).json({ error: 'El producto seleccionado no existe.' });

    const total = +(cantidadNum * costoNum).toFixed(2);
    const { rows } = await pool.query(
      `INSERT INTO compras (fecha, proveedor, producto_id, producto_nombre, cantidad, costo_unitario, total, estado, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [fecha, proveedor, producto_id, prodRows[0].nombre, cantidadNum, costoNum, total, estadoFinal, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'compras', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la compra.' });
  }
});

router.put('/:id', verificarPermiso('compras.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, proveedor, cantidad, costo_unitario, estado, notas } = req.body;

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: antesRows } = await cliente.query(`SELECT * FROM compras WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!antesRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Compra no encontrada.' }); }
    const antes = antesRows[0];

    if (antes.estado === 'recibido') {
      // Ya se sumó al stock y se posteó el egreso -- solo se dejan tocar
      // campos informativos (proveedor/notas), nunca cantidad/costo/estado,
      // para no desincronizar el stock/Finanzas ya movidos.
      const { rows } = await cliente.query(
        `UPDATE compras SET proveedor = COALESCE($1, proveedor), notas = COALESCE($2, notas), actualizado_el = now()
         WHERE id=$3 AND empresa_id=$4 RETURNING *`,
        [proveedor || null, notas !== undefined ? notas : null, req.params.id, empresaId]
      );
      await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'editar', modulo: 'compras', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
      await cliente.query('COMMIT');
      return res.json(rows[0]);
    }

    if (estado && !ESTADOS_VALIDOS.includes(estado)) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: `estado debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` }); }

    const cantidadFinal = cantidad !== undefined && cantidad !== '' ? numeroOCero(cantidad) : Number(antes.cantidad);
    const costoFinal = costo_unitario !== undefined && costo_unitario !== '' ? numeroOCero(costo_unitario) : Number(antes.costo_unitario);
    if (cantidadFinal <= 0) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: 'La cantidad debe ser mayor a 0.' }); }
    if (costoFinal < 0) { await cliente.query('ROLLBACK'); return res.status(400).json({ error: 'El costo unitario no puede ser negativo.' }); }
    const total = +(cantidadFinal * costoFinal).toFixed(2);
    const estadoFinal = estado || antes.estado;

    let fechaRecibido = antes.fecha_recibido;
    if (estadoFinal === 'recibido') {
      fechaRecibido = fecha || antes.fecha;
      // FOR UPDATE: mismo motivo que ventas.js con inventario -- evita que
      // dos recepciones simultáneas de la misma compra sumen el stock dos veces.
      await cliente.query(`SELECT id FROM inventario WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [antes.producto_id, empresaId]);
      await cliente.query(
        `UPDATE inventario SET stock = stock + $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`,
        [cantidadFinal, antes.producto_id, empresaId]
      );
      if (total > 0) {
        await cliente.query(
          `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, origen_modulo, origen_id, empresa_id)
           VALUES ($1, 'egreso', 'Compras', $2, $3, 'compras', $4, $5)`,
          [fechaRecibido, `Compra recibida: ${antes.producto_nombre} (${cantidadFinal} unidad(es)) · ${antes.proveedor}`, total, antes.id, empresaId]
        );
      }
    }

    const { rows } = await cliente.query(
      `UPDATE compras SET
         fecha = COALESCE($1, fecha), proveedor = COALESCE($2, proveedor),
         cantidad = $3, costo_unitario = $4, total = $5, estado = $6, fecha_recibido = $7,
         notas = COALESCE($8, notas), actualizado_el = now()
       WHERE id=$9 AND empresa_id=$10 RETURNING *`,
      [fecha || null, proveedor || null, cantidadFinal, costoFinal, total, estadoFinal, fechaRecibido,
       notas !== undefined ? notas : null, req.params.id, empresaId]
    );

    await registrarAuditoria(cliente, {
      usuario: req.usuario, accion: 'editar', modulo: 'compras', registroId: req.params.id,
      detalle: { antes, despues: rows[0], stockSumado: estadoFinal === 'recibido' && antes.estado !== 'recibido' ? cantidadFinal : null }
    });
    await cliente.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la compra.' });
  } finally {
    cliente.release();
  }
});

// DELETE: si ya estaba 'recibido', revierte el stock sumado y borra el
// egreso de Finanzas antes de borrar la compra -- mismo patrón que
// inventario.js con el egreso de stock inicial, para no dejar nada huérfano
// ni un stock inflado por una compra que ya no existe.
router.delete('/:id', verificarPermiso('compras.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM compras WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Compra no encontrada.' }); }
    const compra = rows[0];

    if (compra.estado === 'recibido') {
      await cliente.query(`UPDATE inventario SET stock = stock - $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`, [compra.cantidad, compra.producto_id, empresaId]);
      await cliente.query(`DELETE FROM finanzas WHERE origen_modulo = 'compras' AND origen_id = $1 AND empresa_id = $2`, [compra.id, empresaId]);
    }
    await cliente.query(`DELETE FROM compras WHERE id = $1 AND empresa_id = $2`, [compra.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'compras', registroId: compra.id, detalle: { eliminado: compra } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar la compra.' });
  } finally {
    cliente.release();
  }
});

router.use(crearRouterCRUD({
  tabla: 'compras',
  modulo: 'compras',
  columnas: ['fecha', 'proveedor', 'producto_id', 'producto_nombre', 'cantidad', 'costo_unitario', 'total', 'estado', 'fecha_recibido', 'notas'],
  camposRequeridos: ['fecha', 'proveedor', 'producto_id', 'producto_nombre'],
  camposNumericos: ['producto_id', 'cantidad', 'costo_unitario', 'total'],
  columnaFecha: 'fecha',
  valoresPorDefecto: { cantidad: 1, estado: 'pedido' }
}));

export default router;
