// src/routes/repuestos.js
// GET, PUT y el import de CSV son el CRUD genérico (crudFactory) -- sin
// efectos secundarios en otras tablas. POST y DELETE son personalizados:
// mismo patrón que inventario.js -- un repuesto nuevo con stock inicial
// deja un egreso automático en Finanzas (el costo de surtir ese stock), y
// borrarlo borra ese mismo egreso, para que Finanzas nunca quede con
// movimientos huérfanos.

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

router.post('/', verificarPermiso('repuestos.crear'), async (req, res) => {
  const { fecha_registro, nombre, codigo_oem, compatibilidad, ubicacion, proveedor, tiempo_reposicion_dias, equivalencias, stock, stock_minimo, costo_unitario, precio_unitario, notas } = req.body;
  if (!fecha_registro || !nombre) return res.status(400).json({ error: 'fecha_registro y nombre son requeridos' });

  const empresaId = req.usuario.empresa_id;
  const stockNum = numeroOCero(stock);
  const stockMinNum = numeroOCero(stock_minimo);
  const costoNum = numeroOCero(costo_unitario);
  const precioNum = numeroOCero(precio_unitario);
  const tiempoNum = tiempo_reposicion_dias !== undefined && tiempo_reposicion_dias !== '' ? Math.round(numeroOCero(tiempo_reposicion_dias)) : null;

  // Mismo candado que inventario.js POST -- este POST es manual y no pasa
  // por crudFactory.js, que es el único lugar que hoy rechaza negativos.
  if (stockNum < 0 || stockMinNum < 0 || costoNum < 0 || precioNum < 0 || (tiempoNum !== null && tiempoNum < 0)) {
    return res.status(400).json({ error: 'Stock, stock mínimo, costo, precio y tiempo de reposición no pueden ser negativos.' });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `INSERT INTO repuestos (fecha_registro, nombre, codigo_oem, compatibilidad, ubicacion, proveedor, tiempo_reposicion_dias, equivalencias, stock, stock_minimo, costo_unitario, precio_unitario, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [fecha_registro, String(nombre).trim(), codigo_oem || null, compatibilidad || null, ubicacion || null, proveedor || null,
       tiempoNum, equivalencias || null, stockNum, stockMinNum, costoNum, precioNum, notas || null, empresaId]
    );
    const repuesto = rows[0];

    // Igual que inventario.js: el egreso es lo que costó COMPRAR el stock
    // inicial (costo_unitario), no lo que va a costar venderlo. Si no se
    // indica costo, no se genera egreso -- no hay forma de saber cuánto
    // gastó sin ese dato.
    const montoEgreso = +(stockNum * costoNum).toFixed(2);
    if (montoEgreso > 0) {
      await cliente.query(
        `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, origen_modulo, origen_id, empresa_id)
         VALUES ($1, 'egreso', 'Repuestos', $2, $3, 'repuestos', $4, $5)`,
        [fecha_registro, `Stock inicial: ${repuesto.nombre} (${stockNum} unidad(es))`, montoEgreso, repuesto.id, empresaId]
      );
    }

    await registrarAuditoria(cliente, {
      usuario: req.usuario, accion: 'crear', modulo: 'repuestos', registroId: repuesto.id,
      detalle: { ...repuesto, egresoGenerado: montoEgreso > 0 ? montoEgreso : null }
    });
    await cliente.query('COMMIT');
    res.status(201).json(repuesto);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el repuesto.' });
  } finally {
    cliente.release();
  }
});

router.delete('/:id', verificarPermiso('repuestos.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM repuestos WHERE id = $1 AND empresa_id = $2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Repuesto no encontrado.' }); }
    const repuesto = rows[0];

    await cliente.query(`DELETE FROM finanzas WHERE origen_modulo = 'repuestos' AND origen_id = $1 AND empresa_id = $2`, [repuesto.id, empresaId]);
    await cliente.query(`DELETE FROM repuestos WHERE id = $1 AND empresa_id = $2`, [repuesto.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'repuestos', registroId: repuesto.id, detalle: { eliminado: repuesto } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el repuesto.' });
  } finally {
    cliente.release();
  }
});

// GET, PUT y POST /import: sin efectos secundarios en otras tablas, se
// quedan en el CRUD genérico (ya scoped por empresa_id y, desde el arreglo
// de la Etapa 0, ya no borra en silencio compatibilidad/ubicacion/
// tiempo_reposicion_dias/equivalencias/notas en una edición inline parcial).
router.use(crearRouterCRUD({
  tabla: 'repuestos',
  modulo: 'repuestos',
  columnas: ['fecha_registro', 'nombre', 'codigo_oem', 'compatibilidad', 'ubicacion', 'proveedor', 'tiempo_reposicion_dias', 'equivalencias', 'stock', 'stock_minimo', 'costo_unitario', 'precio_unitario', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['tiempo_reposicion_dias', 'stock', 'stock_minimo', 'costo_unitario', 'precio_unitario'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { stock: 0, stock_minimo: 0 }
}));

export default router;
