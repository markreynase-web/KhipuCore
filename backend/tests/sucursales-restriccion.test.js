// tests/sucursales-restriccion.test.js
// Sub-fase D (roadmap competitivo, Nivel 2): restricción usuario-por-
// sucursal. Principio explícito de esta sub-fase: la seguridad real vive en
// backend/DB, el frontend solo refleja la restricción -- por eso este
// archivo prueba con requests HTTP reales (nunca llamando funciones
// internas) que un usuario restringido no puede ver ni operar en otra
// sucursal sin importar qué mande en el request. Nadie puede saltarse esto
// modificando el request desde DevTools.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente,
  crearSucursal, login, limpiarContexto, PASSWORD_QA
} from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();
let empresa, sucursalA, sucursalB;
let headersA;               // usuario restringido a sucursalA
let headersSinRestriccion;  // admin, sucursal_id null
let productoA, productoB, cliente;

before(async () => {
  servidor = await iniciarServidorTest();
  empresa = await crearEmpresa(ctx, 'restriccion-sucursal');
  const { rows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1 AND principal = true', [empresa]);
  sucursalA = rows[0].id;
  sucursalB = await crearSucursal(ctx, empresa, 'Sede B');

  const usuarioA = await crearUsuario(ctx, { empresaId: empresa, sucursalId: sucursalA });
  const tokenA = await login(servidor.baseUrl, usuarioA.email, usuarioA.password);
  headersA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };

  const admin = await crearUsuario(ctx, { empresaId: empresa }); // sucursal_id null -> sin restricción
  const tokenSinRestriccion = await login(servidor.baseUrl, admin.email, admin.password);
  headersSinRestriccion = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenSinRestriccion}` };

  productoA = await crearProducto(ctx, empresa, { nombre: 'Producto A', stock: 50, sucursalId: sucursalA });
  productoB = await crearProducto(ctx, empresa, { nombre: 'Producto B', stock: 50, sucursalId: sucursalB });
  cliente = await crearCliente(ctx, empresa);
});

after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

// ---------- INVENTARIO ----------

test('#1 GET /inventario restringido, sin filtro: solo su sucursal', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/inventario`, { headers: headersA });
  assert.equal(r.status, 200);
  const productos = await r.json();
  assert.ok(productos.some(p => p.id === productoA));
  assert.ok(!productos.some(p => p.id === productoB));
});

test('#2 GET /inventario?sucursal_id=<otra>: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/inventario?sucursal_id=${sucursalB}`, { headers: headersA });
  assert.equal(r.status, 403);
});

test('#3 GET /inventario?sucursal_id=<la suya>: 200, igual que sin filtro', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/inventario?sucursal_id=${sucursalA}`, { headers: headersA });
  assert.equal(r.status, 200);
  const productos = await r.json();
  assert.ok(productos.some(p => p.id === productoA));
});

test('#4 POST /inventario con sucursal_id de otra sede: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: headersA,
    body: JSON.stringify({ fecha_registro: '2026-03-01', nombre: 'QA-TEST (borrar) intento ajeno', stock: 1, sucursal_id: sucursalB })
  });
  assert.equal(r.status, 403);
});

test('#5 POST /inventario sin sucursal_id (restringido): 201, autocompletado con la suya', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: headersA,
    body: JSON.stringify({ fecha_registro: '2026-03-01', nombre: 'QA-TEST (borrar) autocompletado', stock: 1 })
  });
  assert.equal(r.status, 201);
  const producto = await r.json();
  assert.equal(producto.sucursal_id, sucursalA);
  ctx.productoIds.push(producto.id);
});

test('#6 PUT/DELETE /inventario/:id de producto de otra sede: 404', async () => {
  const rPut = await fetch(`${servidor.baseUrl}/api/inventario/${productoB}`, {
    method: 'PUT', headers: headersA, body: JSON.stringify({ nombre: 'QA-TEST (borrar) hackeado' })
  });
  assert.equal(rPut.status, 404);

  const rDelete = await fetch(`${servidor.baseUrl}/api/inventario/${productoB}`, { method: 'DELETE', headers: headersA });
  assert.equal(rDelete.status, 404);

  // Confirmación negativa: el producto sigue existiendo, intacto.
  const { rows } = await pool.query('SELECT nombre FROM inventario WHERE id = $1', [productoB]);
  assert.equal(rows[0].nombre, 'QA-TEST (borrar) Producto B');
});

test('#7 POST /inventario/import con una fila de otra sede: esa fila = error, el resto se importa', async () => {
  const csv = [
    'fecha_registro,nombre,stock,sucursal_id',
    `2026-03-01,QA-TEST (borrar) import propia,2,${sucursalA}`,
    `2026-03-01,QA-TEST (borrar) import ajena,3,${sucursalB}`,
    `2026-03-01,QA-TEST (borrar) import sin sucursal,4,`
  ].join('\n');
  const form = new FormData();
  form.append('archivo', new Blob([csv], { type: 'text/csv' }), 'productos.csv');

  const r = await fetch(`${servidor.baseUrl}/api/inventario/import`, { method: 'POST', headers: { Authorization: headersA.Authorization }, body: form });
  assert.equal(r.status, 200);
  const resultado = await r.json();
  assert.equal(resultado.insertadas, 2, 'la propia y la sin-sucursal (autocompletada) se importan; la ajena no');
  assert.equal(resultado.errores, 1);
  assert.match(resultado.detalle[0], /no tienes acceso/i);

  const { rows: importadas } = await pool.query(
    `SELECT id, nombre, sucursal_id FROM inventario WHERE empresa_id = $1 AND nombre LIKE 'QA-TEST (borrar) import%'`,
    [empresa]
  );
  importadas.forEach(p => ctx.productoIds.push(p.id));
  assert.ok(importadas.every(p => p.sucursal_id === sucursalA), 'todas las filas importadas (incl. la sin-sucursal) deben caer en la sucursal del usuario restringido');
});

// ---------- VENTAS ----------

test('#8 GET /ventas?sucursal_id=<otra>: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/ventas?sucursal_id=${sucursalB}`, { headers: headersA });
  assert.equal(r.status, 403);
});

test('#9 POST /ventas con producto de otra sede: 404', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers: headersA,
    body: JSON.stringify({ fecha: '2026-03-01', producto_id: productoB, cliente_id: cliente, cantidad: 1, precio_unitario: 100 })
  });
  assert.equal(r.status, 404);
});

test('#10 PUT/DELETE /ventas/:id de una venta de otra sede: 404', async () => {
  // La venta se crea SIN restricción, en sucursalB (a través del producto).
  const rVenta = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha: '2026-03-01', producto_id: productoB, cliente_id: cliente, cantidad: 1, precio_unitario: 100 })
  });
  assert.equal(rVenta.status, 201);
  const venta = await rVenta.json();
  ctx.ventaIds.push(venta.id);
  assert.equal(venta.sucursal_id, sucursalB);

  const rPut = await fetch(`${servidor.baseUrl}/api/ventas/${venta.id}`, {
    method: 'PUT', headers: headersA, body: JSON.stringify({ cantidad: 2 })
  });
  assert.equal(rPut.status, 404);

  const rDelete = await fetch(`${servidor.baseUrl}/api/ventas/${venta.id}`, { method: 'DELETE', headers: headersA });
  assert.equal(rDelete.status, 404);

  const { rows } = await pool.query('SELECT cantidad FROM ventas WHERE id = $1', [venta.id]);
  assert.equal(Number(rows[0].cantidad), 1, 'la venta ajena no debe haberse modificado ni borrado');
});

// ---------- FINANZAS ----------

test('#11 GET /finanzas?sucursal_id=<otra>: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/finanzas?sucursal_id=${sucursalB}`, { headers: headersA });
  assert.equal(r.status, 403);
});

test('#12 POST /finanzas con sucursal_id de otra sede: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersA,
    body: JSON.stringify({ fecha: '2026-03-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) intento ajeno', monto: 10, sucursal_id: sucursalB })
  });
  assert.equal(r.status, 403);
});

test('#13 PUT/DELETE /finanzas/:id de otra sede (incl. "sin asignar"): 404', async () => {
  const rAjeno = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha: '2026-03-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) de sede B', monto: 15, sucursal_id: sucursalB })
  });
  const movimientoAjeno = await rAjeno.json();

  const rSinAsignar = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha: '2026-03-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) sin asignar', monto: 5 })
  });
  const movimientoSinAsignar = await rSinAsignar.json();
  assert.equal(movimientoSinAsignar.sucursal_id, null);

  for (const mov of [movimientoAjeno, movimientoSinAsignar]) {
    const rPut = await fetch(`${servidor.baseUrl}/api/finanzas/${mov.id}`, {
      method: 'PUT', headers: headersA, body: JSON.stringify({ monto: 999 })
    });
    assert.equal(rPut.status, 404, `PUT sobre movimiento ${mov.id} (sucursal_id=${mov.sucursal_id}) debería ser 404`);

    const rDelete = await fetch(`${servidor.baseUrl}/api/finanzas/${mov.id}`, { method: 'DELETE', headers: headersA });
    assert.equal(rDelete.status, 404, `DELETE sobre movimiento ${mov.id} debería ser 404`);
  }
});

test('#14 GET /finanzas/resumen-sucursales restringido: solo su fila, total = su fila', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/finanzas/resumen-sucursales`, { headers: headersA });
  assert.equal(r.status, 200);
  const resumen = await r.json();
  assert.equal(resumen.porSucursal.length, 1);
  assert.equal(resumen.porSucursal[0].sucursal_id, sucursalA);
  assert.deepEqual(resumen.total, {
    ingresos: resumen.porSucursal[0].ingresos,
    egresos: resumen.porSucursal[0].egresos,
    ganancia: resumen.porSucursal[0].ganancia
  });
});

// ---------- USUARIOS ----------

test('#15 PUT /usuarios/:id con sucursal_id de otra empresa: 404', async () => {
  const otraEmpresa = await crearEmpresa(ctx, 'restriccion-otra-empresa');
  const { rows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1', [otraEmpresa]);
  const sucursalAjena = rows[0].id;

  const usuarioObjetivo = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'ventas' });
  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${usuarioObjetivo.usuarioId}`, {
    method: 'PUT', headers: headersSinRestriccion, body: JSON.stringify({ sucursal_id: sucursalAjena })
  });
  assert.equal(r.status, 404);

  const { rows: membresia } = await pool.query('SELECT sucursal_id FROM usuario_empresa WHERE usuario_id = $1 AND empresa_id = $2', [usuarioObjetivo.usuarioId, empresa]);
  assert.equal(membresia[0].sucursal_id, null, 'no debe haber quedado asignada la sucursal ajena');
});

// ---------- SESIONES ESPECIALES ----------

test('#16 Impersonación de super admin: sin restricción, ve ambas sucursales', async () => {
  const superEmail = `qa-test-superadmin-restriccion-${Date.now()}@example.invalid`;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows: suRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo, es_super_admin) VALUES ('QA-TEST (borrar) superadmin restriccion', $1, $2, true, true) RETURNING id`,
    [superEmail, hash]
  );
  ctx.usuarioIds.push(suRows[0].id);
  const superToken = await login(servidor.baseUrl, superEmail, PASSWORD_QA);

  const rImpersonar = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresa}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ motivo: 'Prueba automática de restricción de sucursal' })
  });
  assert.equal(rImpersonar.status, 200);
  const { token: tokenImpersonado } = await rImpersonar.json();

  const r = await fetch(`${servidor.baseUrl}/api/inventario`, { headers: { Authorization: `Bearer ${tokenImpersonado}` } });
  assert.equal(r.status, 200);
  const productos = await r.json();
  assert.ok(productos.some(p => p.id === productoA));
  assert.ok(productos.some(p => p.id === productoB));
});

test('#17 JWT emitido antes de la Sub-fase D (sin el campo sucursal_id): se trata como sin restricción', async () => {
  const payload = jwt.decode(headersSinRestriccion.Authorization.replace('Bearer ', ''));
  delete payload.sucursal_id;
  delete payload.iat;
  delete payload.exp;
  const tokenViejo = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

  const r = await fetch(`${servidor.baseUrl}/api/inventario`, { headers: { Authorization: `Bearer ${tokenViejo}` } });
  assert.equal(r.status, 200);
  const productos = await r.json();
  assert.ok(productos.some(p => p.id === productoA));
  assert.ok(productos.some(p => p.id === productoB));
});

// ---------- REGRESIÓN: sucursal_id = NULL sigue siendo un estado funcional completo ----------

test('#18 Usuario sin restricción: GET todas, POST/PUT/DELETE en cualquier sucursal, resumen completo, finanza con y sin sucursal', async () => {
  // GET todas.
  const rGet = await fetch(`${servidor.baseUrl}/api/inventario`, { headers: headersSinRestriccion });
  const productos = await rGet.json();
  assert.ok(productos.some(p => p.id === productoA));
  assert.ok(productos.some(p => p.id === productoB));

  // POST en cualquier sucursal (acá, sucursalB explícita).
  const rPost = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha_registro: '2026-03-01', nombre: 'QA-TEST (borrar) admin en sede B', stock: 1, sucursal_id: sucursalB })
  });
  assert.equal(rPost.status, 201);
  const nuevoProducto = await rPost.json();
  ctx.productoIds.push(nuevoProducto.id);
  assert.equal(nuevoProducto.sucursal_id, sucursalB);

  // PUT en cualquier sucursal.
  const rPut = await fetch(`${servidor.baseUrl}/api/inventario/${productoA}`, {
    method: 'PUT', headers: headersSinRestriccion, body: JSON.stringify({ stock_minimo: 3 })
  });
  assert.equal(rPut.status, 200);

  // DELETE en cualquier sucursal.
  const rDelete = await fetch(`${servidor.baseUrl}/api/inventario/${nuevoProducto.id}`, { method: 'DELETE', headers: headersSinRestriccion });
  assert.equal(rDelete.status, 204);
  ctx.productoIds = ctx.productoIds.filter(id => id !== nuevoProducto.id);

  // GET resumen completo (más de una fila -- ambas sucursales visibles).
  const rResumen = await fetch(`${servidor.baseUrl}/api/finanzas/resumen-sucursales`, { headers: headersSinRestriccion });
  const resumen = await rResumen.json();
  assert.ok(resumen.porSucursal.some(s => s.sucursal_id === sucursalA));
  assert.ok(resumen.porSucursal.some(s => s.sucursal_id === sucursalB));

  // POST finanza CON sucursal.
  const rFinanzaCon = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha: '2026-03-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) admin con sucursal', monto: 7, sucursal_id: sucursalA })
  });
  assert.equal(rFinanzaCon.status, 201);
  assert.equal((await rFinanzaCon.json()).sucursal_id, sucursalA);

  // POST finanza SIN sucursal (sigue pudiendo dejarlo sin asignar).
  const rFinanzaSin = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersSinRestriccion,
    body: JSON.stringify({ fecha: '2026-03-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) admin sin sucursal', monto: 3 })
  });
  assert.equal(rFinanzaSin.status, 201);
  assert.equal((await rFinanzaSin.json()).sucursal_id, null);
});
