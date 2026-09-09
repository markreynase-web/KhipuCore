// src/routes/inventario.js
// GET y PUT siguen siendo el CRUD genérico (crudFactory) -- no tienen
// efectos secundarios en otras tablas. POST, DELETE y POST /import son
// personalizados: cada producto nuevo con stock inicial deja un egreso
// automático en Finanzas (el costo de surtir ese stock), borrar el
// producto borra ese mismo egreso -- mismo patrón que ventas.js con sus
// ingresos, para que Finanzas nunca quede con movimientos "huérfanos" -- y
// (Sub-fase B) tanto POST como POST /import necesitan resolver un
// sucursal_id válido antes de insertar, algo que crudFactory.js no sabe
// hacer.
//
// Fase A (multi-tenant): POST/DELETE/import son manuales (no pasan por
// crudFactory.js), así que agregan "empresa_id" a mano en cada consulta.

import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
  const { fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, costo_unitario, fecha_vencimiento, notas, sucursal_id } = req.body;
  if (!fecha_registro || !nombre) return res.status(400).json({ error: 'fecha_registro y nombre son requeridos' });

  // Sub-fase B (sucursales): a partir de acá todo producto nuevo queda
  // asignado a una sucursal -- es el punto donde la columna (nullable desde
  // la migración 036, por el backfill) empieza a llenarse siempre. No
  // alcanza con "no vacío": tiene que ser un entero real, porque más abajo
  // se usa directo en una consulta a la tabla sucursales.
  const sucursalIdNum = Number(sucursal_id);
  if (!sucursal_id || !Number.isInteger(sucursalIdNum)) {
    return res.status(400).json({ error: 'sucursal_id es requerido y debe ser un número entero.' });
  }

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

    // 404 (no 400) si la sucursal no existe O es de otra empresa -- mismo
    // criterio de no confirmar existencia ajena que usa el resto del
    // proyecto (ver PUT genérico de crudFactory.js).
    const { rows: sucursalRows } = await cliente.query(
      `SELECT id FROM sucursales WHERE id = $1 AND empresa_id = $2`,
      [sucursalIdNum, empresaId]
    );
    if (!sucursalRows.length) {
      await cliente.query('ROLLBACK');
      return res.status(404).json({ error: 'La sucursal indicada no existe.' });
    }

    const { rows } = await cliente.query(
      `INSERT INTO inventario (fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, costo_unitario, fecha_vencimiento, notas, empresa_id, sucursal_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [fecha_registro, String(nombre).trim(), categoria || null, stockNum, stockMinNum, precioNum, costoNum, fecha_vencimiento || null, notas || null, empresaId, sucursalIdNum]
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

// POST /import (CSV) -- también manual, y por la misma razón que POST /:
// cada fila nueva necesita un sucursal_id válido. Ninguna plantilla de CSV
// que un cliente real tenga hoy incluye esa columna (no existía hasta esta
// sub-fase), así que sin este override, el primer import después de la
// migración 038 (sucursal_id NOT NULL) habría fallado entero con un 500 --
// la fila ni siquiera hubiera llegado a limpiarYValidar de crudFactory.js,
// que no sabe nada de sucursales. Acá: si la fila trae una columna
// "sucursal_id" válida (número entero, de ESTA empresa) se usa esa; si no
// trae nada, cae en la sucursal principal de la empresa; si trae algo que
// no es válido, esa fila puntual se reporta como error (mismo criterio que
// cualquier otro campo requerido faltante) sin abortar el resto del import.
router.post('/import', verificarPermiso('inventario.crear'), upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sube un archivo CSV en el campo "archivo".' });
  const texto = req.file.buffer.toString('utf8');
  const parsed = Papa.parse(texto, { header: true, skipEmptyLines: 'greedy' });
  const filas = parsed.data;
  if (!filas.length) return res.status(400).json({ error: 'El CSV no tiene filas con datos.' });

  const empresaId = req.usuario.empresa_id;
  const { rows: sucursalesEmpresa } = await pool.query('SELECT id, principal FROM sucursales WHERE empresa_id = $1', [empresaId]);
  const idsValidos = new Set(sucursalesEmpresa.map(s => s.id));
  const principal = sucursalesEmpresa.find(s => s.principal);
  if (!principal) {
    // No debería poder pasar (crearEmpresa/POST superadmin siempre crean
    // una) pero si pasara, mejor un error claro que un 500 a mitad del import.
    return res.status(400).json({ error: 'Esta empresa no tiene una sucursal principal configurada.' });
  }

  let insertadas = 0;
  const erroresDetalle = [];
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    for (let i = 0; i < filas.length; i++) {
      const cruda = {};
      Object.keys(filas[i]).forEach(k => { cruda[k.trim().toLowerCase()] = filas[i][k]; });

      const fecha_registro = cruda.fecha_registro;
      const nombre = typeof cruda.nombre === 'string' ? cruda.nombre.trim() : '';
      if (!fecha_registro || !nombre) {
        erroresDetalle.push(`Fila ${i + 2}: fecha_registro y nombre son requeridos`);
        continue;
      }

      let sucursalId = principal.id;
      const sucursalCruda = cruda.sucursal_id;
      if (sucursalCruda !== undefined && sucursalCruda !== '' && sucursalCruda !== null) {
        const n = Number(sucursalCruda);
        if (!Number.isInteger(n) || !idsValidos.has(n)) {
          erroresDetalle.push(`Fila ${i + 2}: sucursal_id "${sucursalCruda}" no corresponde a una sucursal de esta empresa`);
          continue;
        }
        sucursalId = n;
      }

      const stock = numeroOCero(cruda.stock);
      const stockMin = numeroOCero(cruda.stock_minimo);
      const precio = numeroOCero(cruda.precio_unitario);
      const costo = numeroOCero(cruda.costo_unitario);
      if (stock < 0 || stockMin < 0 || precio < 0 || costo < 0) {
        erroresDetalle.push(`Fila ${i + 2}: stock, stock_minimo, precio_unitario y costo_unitario no pueden ser negativos`);
        continue;
      }
      // Mismo trim que hacía limpiarYValidar() de crudFactory.js para
      // cualquier valor de texto -- categoria/notas/fecha_vencimiento no
      // deben quedar con espacios colgando solo porque este import ahora es
      // manual en vez de genérico.
      const categoria = typeof cruda.categoria === 'string' ? cruda.categoria.trim() : cruda.categoria;
      const notas = typeof cruda.notas === 'string' ? cruda.notas.trim() : cruda.notas;
      const fechaVencimiento = typeof cruda.fecha_vencimiento === 'string' ? cruda.fecha_vencimiento.trim() : cruda.fecha_vencimiento;

      await cliente.query(
        `INSERT INTO inventario (fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, costo_unitario, fecha_vencimiento, notas, empresa_id, sucursal_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [fecha_registro, nombre, categoria || null, stock, stockMin, precio, costo, fechaVencimiento || null, notas || null, empresaId, sucursalId]
      );
      insertadas++;
    }
    await cliente.query('COMMIT');
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Falló la importación; no se guardó ninguna fila (se revirtió todo).' });
  } finally {
    cliente.release();
  }

  res.json({ insertadas, errores: erroresDetalle.length, detalle: erroresDetalle.slice(0, 20) });
  registrarAuditoria(pool, { usuario: req.usuario, accion: 'importar', modulo: 'inventario', detalle: { insertadas, errores: erroresDetalle.length } });
});

// GET y PUT: sin efectos secundarios en otras tablas, se quedan en el CRUD
// genérico (que ya scoped por empresa_id, ver crudFactory.js). Como este
// router ya definió su propio POST, DELETE y POST /import arriba, Express
// nunca llega a los de acá abajo para esos tres verbos.
router.use(crearRouterCRUD({
  tabla: 'inventario',
  modulo: 'inventario',
  columnas: ['fecha_registro', 'nombre', 'categoria', 'stock', 'stock_minimo', 'precio_unitario', 'costo_unitario', 'fecha_vencimiento', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['stock', 'stock_minimo', 'precio_unitario', 'costo_unitario'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { stock: 0, stock_minimo: 0 },
  // Habilita GET /?buscar=texto para el buscador-mientras-escribís del
  // producto en Ventas (ver componentes/comboboxBusqueda.js). No hay columna
  // de código/SKU en este catálogo -- si se agrega alguna vez, sumarla acá.
  columnasBusqueda: ['nombre', 'categoria'],
  // Sub-fase B (sucursales): GET /?sucursal_id=3 filtra el catálogo a esa
  // sucursal. Sin el query param, sigue trayendo todo el inventario de la
  // empresa como siempre -- opt-in, ver crudFactory.js.
  columnasFiltroExacto: ['sucursal_id']
}));

export default router;
