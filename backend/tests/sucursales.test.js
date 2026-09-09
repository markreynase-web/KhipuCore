// tests/sucursales.test.js
// Sub-fase B (roadmap competitivo, Nivel 2): CRUD de sucursales
// (src/routes/sucursales.js) + inventario.js exigiendo sucursal_id en cada
// producto nuevo. Cubre lo que la Sub-fase A dejó sin probar todavía: nada
// en la suite existente golpeaba estas rutas por HTTP directo (todo pasaba
// por el fixture crearProducto(), que inserta directo en la base).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearSucursal, login } from './helpers/fixtures.js';
import { limpiarContexto } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

before(async () => { servidor = await iniciarServidorTest(); });
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

async function setupEmpresaAdmin(sufijo) {
  const empresaId = await crearEmpresa(ctx, sufijo);
  const admin = await crearUsuario(ctx, { empresaId });
  const token = await login(servidor.baseUrl, admin.email, admin.password);
  return { empresaId, token };
}

test('GET /api/sucursales: trae la Sucursal Principal que crearEmpresa() ya garantiza', async () => {
  const { token } = await setupEmpresaAdmin('sucursales-get');
  const r = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const sucursales = await r.json();
  assert.equal(sucursales.length, 1);
  assert.equal(sucursales[0].nombre, 'Sucursal Principal');
  assert.equal(sucursales[0].principal, true);
});

test('POST /api/sucursales: crea una nueva sucursal (no principal); nombre es requerido', async () => {
  const { empresaId, token } = await setupEmpresaAdmin('sucursales-post');

  const rSinNombre = await fetch(`${servidor.baseUrl}/api/sucursales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ direccion: 'Av. Siempre Viva 123' })
  });
  assert.equal(rSinNombre.status, 400);

  const r = await fetch(`${servidor.baseUrl}/api/sucursales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) Sucursal Miraflores', direccion: 'Av. Larco 123' })
  });
  assert.equal(r.status, 201);
  const nueva = await r.json();
  assert.equal(nueva.principal, false);
  assert.equal(nueva.empresa_id, empresaId);
  ctx.sucursalIds.push(nueva.id);

  const rLista = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await rLista.json()).length, 2);
});

test('PUT /api/sucursales/:id: edita nombre/dirección/activo; "principal" no se puede tocar por API', async () => {
  const { token } = await setupEmpresaAdmin('sucursales-put');
  const rLista = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  const [principal] = await rLista.json();

  // Intento de "secuestrar" el flag principal desde el body -- debe ignorarse.
  const r = await fetch(`${servidor.baseUrl}/api/sucursales/${principal.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) Sede Central', principal: false })
  });
  assert.equal(r.status, 200);
  const editada = await r.json();
  assert.equal(editada.nombre, 'QA-TEST (borrar) Sede Central');
  assert.equal(editada.principal, true, 'principal debe seguir en true: el body no puede tocarlo');
});

// Regresión: la primera versión de este PUT mandaba el valor de "activo" a
// la query envuelto en `!!req.body?.activo` -- para un boolean real eso es
// inofensivo, pero para el string "false" (que JS ve truthy, por ser un
// string no vacío) lo convertía en `true` ANTES de que Postgres pudiera
// interpretar el texto "false" como corresponde. Un frontend que mande
// activo como string (ej. desde un <select>) habría reactivado sucursales
// por accidente al intentar desactivarlas.
test('PUT /api/sucursales/:id: activo como string "false" desactiva de verdad (no lo invierte)', async () => {
  const { token } = await setupEmpresaAdmin('sucursales-activo-string');
  const rLista = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  const [principal] = await rLista.json();

  const r = await fetch(`${servidor.baseUrl}/api/sucursales/${principal.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ activo: 'false' })
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).activo, false);
});

test('DELETE /api/sucursales/:id: nunca la principal, y nunca una con inventario asociado', async () => {
  const { empresaId, token } = await setupEmpresaAdmin('sucursales-delete');
  const rLista = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  const [principal] = await rLista.json();

  const rBorrarPrincipal = await fetch(`${servidor.baseUrl}/api/sucursales/${principal.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(rBorrarPrincipal.status, 400);

  const otraSucursalId = await crearSucursal(ctx, empresaId, 'Con inventario');
  await crearProducto(ctx, empresaId, { nombre: 'Producto con sucursal', sucursalId: otraSucursalId });

  const rBorrarConStock = await fetch(`${servidor.baseUrl}/api/sucursales/${otraSucursalId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(rBorrarConStock.status, 409);

  const sucursalVaciaId = await crearSucursal(ctx, empresaId, 'Vacía');
  const rBorrarVacia = await fetch(`${servidor.baseUrl}/api/sucursales/${sucursalVaciaId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(rBorrarVacia.status, 204);
});

test('rol "consulta" (sin permisos de sucursales): 403 en ver y en crear', async () => {
  const empresaId = await crearEmpresa(ctx, 'sucursales-permisos');
  const usuarioConsulta = await crearUsuario(ctx, { empresaId, rolNombre: 'consulta' });
  const token = await login(servidor.baseUrl, usuarioConsulta.email, usuarioConsulta.password);

  const rVer = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(rVer.status, 403);

  const rCrear = await fetch(`${servidor.baseUrl}/api/sucursales`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) No debería crearse' })
  });
  assert.equal(rCrear.status, 403);
});

test('POST /api/inventario: sucursal_id es requerido, y debe pertenecer a la propia empresa', async () => {
  const { empresaId, token } = await setupEmpresaAdmin('inventario-sucursal-post');
  const { empresaId: otraEmpresaId } = await setupEmpresaAdmin('inventario-sucursal-otra');
  const { rows: sucursalOtraRows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1', [otraEmpresaId]);
  const sucursalDeOtraEmpresa = sucursalOtraRows[0].id;
  const { rows: sucursalPropiaRows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1', [empresaId]);
  const sucursalPropia = sucursalPropiaRows[0].id;

  const base = { fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) Producto sucursal', stock: 5, precio_unitario: 10 };

  const rSinSucursal = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(base)
  });
  assert.equal(rSinSucursal.status, 400);

  const rSucursalAjena = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...base, sucursal_id: sucursalDeOtraEmpresa })
  });
  assert.equal(rSucursalAjena.status, 404);

  const rOk = await fetch(`${servidor.baseUrl}/api/inventario`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...base, sucursal_id: sucursalPropia })
  });
  assert.equal(rOk.status, 201);
  const producto = await rOk.json();
  assert.equal(producto.sucursal_id, sucursalPropia);
  ctx.productoIds.push(producto.id);
});

test('GET /api/inventario?sucursal_id=: filtra opt-in; sin el parámetro, sigue trayendo todo', async () => {
  const { empresaId, token } = await setupEmpresaAdmin('inventario-sucursal-get');
  const sucursalB = await crearSucursal(ctx, empresaId, 'Sede B');
  const { rows: sucursalPrincipalRows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1 AND principal = true', [empresaId]);
  const sucursalA = sucursalPrincipalRows[0].id;

  await crearProducto(ctx, empresaId, { nombre: 'Producto en A', sucursalId: sucursalA });
  await crearProducto(ctx, empresaId, { nombre: 'Producto en B', sucursalId: sucursalB });

  const rTodo = await fetch(`${servidor.baseUrl}/api/inventario`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await rTodo.json()).length, 2);

  const rFiltradoA = await fetch(`${servidor.baseUrl}/api/inventario?sucursal_id=${sucursalA}`, { headers: { Authorization: `Bearer ${token}` } });
  const productosA = await rFiltradoA.json();
  assert.equal(productosA.length, 1);
  assert.equal(productosA[0].sucursal_id, sucursalA);

  const rFiltradoB = await fetch(`${servidor.baseUrl}/api/inventario?sucursal_id=${sucursalB}`, { headers: { Authorization: `Bearer ${token}` } });
  const productosB = await rFiltradoB.json();
  assert.equal(productosB.length, 1);
  assert.equal(productosB[0].sucursal_id, sucursalB);
});

test('POST /api/inventario/import (CSV): sin columna sucursal_id cae en la principal; con una inválida, esa fila se reporta como error sin abortar el resto', async () => {
  const { empresaId, token } = await setupEmpresaAdmin('inventario-import-sucursal');
  const sucursalB = await crearSucursal(ctx, empresaId, 'Sede importada');

  const csv = [
    'fecha_registro,nombre,stock,precio_unitario,sucursal_id',
    `2026-01-01,QA-TEST (borrar) Import sin sucursal,3,20,`,
    `2026-01-01,QA-TEST (borrar) Import con sucursal B,5,15,${sucursalB}`,
    `2026-01-01,QA-TEST (borrar) Import sucursal inexistente,2,10,999999`
  ].join('\n');

  const form = new FormData();
  form.append('archivo', new Blob([csv], { type: 'text/csv' }), 'productos.csv');

  const r = await fetch(`${servidor.baseUrl}/api/inventario/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  });
  assert.equal(r.status, 200);
  const resultado = await r.json();
  assert.equal(resultado.insertadas, 2);
  assert.equal(resultado.errores, 1);
  assert.match(resultado.detalle[0], /sucursal_id "999999"/);

  const { rows: productos } = await pool.query(
    `SELECT id, nombre, sucursal_id FROM inventario WHERE empresa_id = $1 ORDER BY nombre`,
    [empresaId]
  );
  productos.forEach(p => ctx.productoIds.push(p.id));
  const sinSucursal = productos.find(p => p.nombre.includes('sin sucursal'));
  const conSucursalB = productos.find(p => p.nombre.includes('sucursal B'));
  const { rows: principalRows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1 AND principal = true', [empresaId]);
  assert.equal(sinSucursal.sucursal_id, principalRows[0].id);
  assert.equal(conSucursalB.sucursal_id, sucursalB);
});
