// tests/crud-critico.test.js
// Suite de regresión — Sub-bloque 4: CRUDs críticos y validaciones base.
//
// Objetivo: probar el CONTRATO de crudFactory.js (src/crudFactory.js) una
// sola vez, a fondo, en vez de repetir casi el mismo test ~21 veces (una
// por cada módulo que lo usa). Representante elegido: clientes.js -- es el
// único candidato simple que es 100% crearRouterCRUD() SIN overrides en
// ningún verbo (a diferencia de inventario.js, que sobreescribe POST y
// DELETE con lógica propia ligada a Finanzas -- probar el contrato del
// factory ahí estaría probando código bespoke, no el genérico).
//
// aislamiento.test.js ya probó, vía crudFactory, que A nunca ve/toca datos
// de B -- acá se prueba la otra mitad del contrato: la corrección del CRUD
// DENTRO de una sola empresa (validación de entrada, update parcial, 404
// real, snapshot de auditoría, import CSV).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, login, limpiarContexto } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
let token;
let empresaId;
const ctx = nuevoContexto();

before(async () => {
  servidor = await iniciarServidorTest();
  empresaId = await crearEmpresa(ctx, 'crud-critico');
  const cuenta = await crearUsuario(ctx, { empresaId });
  token = await login(servidor.baseUrl, cuenta.email, cuenta.password);
});
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

// registrarAuditoria() en crudFactory.js se llama SIN await (fire-and-forget,
// a propósito, para no demorar la respuesta al usuario) -- mismo hallazgo y
// misma solución que en impersonacion.test.js: reintentar con margen corto
// en vez de asumir que la fila ya está escrita apenas llega la respuesta HTTP.
async function esperarFilaAuditLog(consulta, params, { intentos = 20, esperaMs = 100 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const { rows } = await pool.query(consulta, params);
    if (rows.length) return rows;
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
  return [];
}

test('POST /api/clientes: campo requerido faltante y campo numérico negativo se rechazan con 400', async () => {
  const rSinNombre = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ fecha_registro: '2026-01-01' })
  });
  assert.equal(rSinNombre.status, 400);
  assert.match((await rSinNombre.json()).error, /nombre es requerido/);

  const rNegativo = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) negativo', compras_totales: -50 })
  });
  assert.equal(rNegativo.status, 400);
  assert.match((await rNegativo.json()).error, /compras_totales no puede ser negativo/);

  // Control: con datos válidos, el mismo endpoint sí crea el registro --
  // confirma que los 400 de arriba son por la validación puntual, no porque
  // el endpoint esté roto en general.
  const rValido = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) valido', compras_totales: 50 })
  });
  assert.equal(rValido.status, 201);
  ctx.clienteIds.push((await rValido.json()).id);
});

test('PUT /api/clientes/:id: un campo no enviado en el body conserva su valor en la base (no se pisa con null)', async () => {
  const rCrear = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) put parcial', email: 'qa-put-parcial@example.invalid', telefono: '555-0000' })
  });
  const cliente = await rCrear.json();
  ctx.clienteIds.push(cliente.id);

  // Solo se envía "notas" -- email y telefono NO viajan en el body.
  const rEditar = await fetch(`${servidor.baseUrl}/api/clientes/${cliente.id}`, {
    method: 'PUT', headers: authHeaders(),
    body: JSON.stringify({ notas: 'nota agregada en el PUT parcial' })
  });
  assert.equal(rEditar.status, 200);
  const editado = await rEditar.json();
  assert.equal(editado.notas, 'nota agregada en el PUT parcial');
  assert.equal(editado.email, 'qa-put-parcial@example.invalid', 'un campo no enviado debe conservar su valor -- nunca pisarse con null');
  assert.equal(editado.telefono, '555-0000');

  const { rows } = await pool.query('SELECT email, telefono, notas FROM clientes WHERE id = $1', [cliente.id]);
  assert.equal(rows[0].email, 'qa-put-parcial@example.invalid');
  assert.equal(rows[0].telefono, '555-0000');
  assert.equal(rows[0].notas, 'nota agregada en el PUT parcial');
});

test('PUT y DELETE sobre un id inexistente responden 404', async () => {
  const idInexistente = 999999999;
  const rPut = await fetch(`${servidor.baseUrl}/api/clientes/${idInexistente}`, {
    method: 'PUT', headers: authHeaders(), body: JSON.stringify({ nombre: 'no importa' })
  });
  assert.equal(rPut.status, 404);
  assert.equal((await rPut.json()).error, 'Registro no encontrado.');

  const rDelete = await fetch(`${servidor.baseUrl}/api/clientes/${idInexistente}`, {
    method: 'DELETE', headers: authHeaders()
  });
  assert.equal(rDelete.status, 404);
  assert.equal((await rDelete.json()).error, 'Registro no encontrado.');
});

test('DELETE /api/clientes/:id: deja una "foto" completa del registro eliminado en audit_log.detalle', async () => {
  const rCrear = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) para eliminar', email: 'qa-delete-snapshot@example.invalid' })
  });
  const cliente = await rCrear.json();

  const rDelete = await fetch(`${servidor.baseUrl}/api/clientes/${cliente.id}`, { method: 'DELETE', headers: authHeaders() });
  assert.equal(rDelete.status, 204);

  const filas = await esperarFilaAuditLog(
    `SELECT accion, modulo, registro_id, detalle FROM audit_log WHERE empresa_id = $1 AND accion = 'eliminar' AND modulo = 'clientes' AND registro_id = $2 ORDER BY id DESC LIMIT 1`,
    [empresaId, String(cliente.id)]
  );
  assert.equal(filas.length, 1, 'debe existir una fila de auditoría para este DELETE');
  assert.ok(filas[0].detalle.eliminado, 'el detalle debe traer la clave "eliminado" con la foto completa del registro');
  assert.equal(filas[0].detalle.eliminado.id, cliente.id);
  assert.equal(filas[0].detalle.eliminado.nombre, 'QA-TEST (borrar) para eliminar');
  assert.equal(filas[0].detalle.eliminado.email, 'qa-delete-snapshot@example.invalid');

  // Ya no puede volver a leerse -- el DELETE fue real, no un soft-delete.
  const { rows } = await pool.query('SELECT 1 FROM clientes WHERE id = $1', [cliente.id]);
  assert.equal(rows.length, 0);
});

test('POST /api/clientes/import: un lote con filas válidas e inválidas inserta las válidas y reporta el detalle de las que fallaron', async () => {
  const csv = [
    'fecha_registro,nombre,email,telefono,direccion,compras_totales,notas',
    '2026-01-01,QA-TEST (borrar) import A,,,,,',
    '2026-01-01,,,,,,',                            // fila 3: nombre faltante -> inválida
    '2026-01-01,QA-TEST (borrar) import B,,,,150.5,'
  ].join('\n');

  const form = new FormData();
  form.append('archivo', new Blob([csv], { type: 'text/csv' }), 'clientes.csv');

  const r = await fetch(`${servidor.baseUrl}/api/clientes/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // sin Content-Type manual: fetch arma el boundary de multipart solo
    body: form
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.insertadas, 2, 'las 2 filas válidas deben insertarse');
  assert.equal(body.errores, 1, 'la fila sin nombre debe reportarse como error, sin abortar el resto del lote');
  assert.match(body.detalle[0], /Fila 3.*nombre es requerido/);

  const { rows } = await pool.query(
    `SELECT id FROM clientes WHERE empresa_id = $1 AND nombre IN ('QA-TEST (borrar) import A', 'QA-TEST (borrar) import B')`,
    [empresaId]
  );
  assert.equal(rows.length, 2);
  rows.forEach(f => ctx.clienteIds.push(f.id));
});
