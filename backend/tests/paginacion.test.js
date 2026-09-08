// tests/paginacion.test.js
// Fase 3, Eje A -- Sub-bloque A3: paginación opt-in en GET /.
//
// El contrato es intencionalmente asimétrico: SIN ?pagina=/?page=, la
// respuesta debe ser BIT A BIT la de siempre (array plano) -- es lo que
// asume js/modoBackend.js en las ~30 pantallas del frontend actual. Con
// ?pagina= presente, cambia a { datos, meta }. Se prueban los dos caminos
// de código que implementan esto: el genérico (crudFactory.js, vía
// clientes.js) y uno bespoke (ventas.js) para confirmar que ambos siguen
// el mismo contrato.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente, login, limpiarContexto } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
let token;
let empresaId;
const ctx = nuevoContexto();

before(async () => {
  servidor = await iniciarServidorTest();
  empresaId = await crearEmpresa(ctx, 'paginacion');
  const cuenta = await crearUsuario(ctx, { empresaId });
  token = await login(servidor.baseUrl, cuenta.email, cuenta.password);
});
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

const authHeaders = () => ({ Authorization: `Bearer ${token}` });

test('GET /api/clientes (crudFactory genérico): sin ?pagina=, sigue devolviendo un array plano, byte a byte igual que siempre', async () => {
  for (let i = 0; i < 3; i++) await crearCliente(ctx, empresaId, `paginacion ${i}`);

  const r = await fetch(`${servidor.baseUrl}/api/clientes`, { headers: authHeaders() });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body), 'sin ?pagina=, el body debe ser un array -- nunca { datos, meta }');
  assert.equal(body.length, 3);
});

test('GET /api/clientes?pagina=1&limite=2 (crudFactory genérico): activa el modo paginado con { datos, meta }', async () => {
  // Ya hay 3 clientes del test anterior en esta misma empresa -- se agregan
  // 2 más para tener 5 en total y poder probar 3 páginas de a 2.
  await crearCliente(ctx, empresaId, 'paginacion extra 1');
  await crearCliente(ctx, empresaId, 'paginacion extra 2');

  const r1 = await fetch(`${servidor.baseUrl}/api/clientes?pagina=1&limite=2`, { headers: authHeaders() });
  assert.equal(r1.status, 200);
  const body1 = await r1.json();
  assert.ok(!Array.isArray(body1), 'con ?pagina=, el body debe ser { datos, meta }, nunca un array plano');
  assert.equal(body1.datos.length, 2);
  assert.equal(body1.meta.total, 5);
  assert.equal(body1.meta.pagina, 1);
  assert.equal(body1.meta.limite, 2);
  assert.equal(body1.meta.paginasTotales, 3);

  const r2 = await fetch(`${servidor.baseUrl}/api/clientes?pagina=2&limite=2`, { headers: authHeaders() });
  const body2 = await r2.json();
  assert.equal(body2.datos.length, 2);
  assert.equal(body2.meta.pagina, 2);

  const r3 = await fetch(`${servidor.baseUrl}/api/clientes?pagina=3&limite=2`, { headers: authHeaders() });
  const body3 = await r3.json();
  assert.equal(body3.datos.length, 1, 'la última página trae el resto (5 - 2 - 2 = 1), no se pide más de lo que hay');

  // Las 3 páginas juntas cubren cada registro exactamente una vez -- ni
  // duplicados ni huecos entre páginas.
  const idsPaginados = new Set([...body1.datos, ...body2.datos, ...body3.datos].map(f => f.id));
  assert.equal(idsPaginados.size, 5);
});

test('GET /api/clientes: ?limite= sin ?pagina= sigue siendo el límite del autocomplete de siempre, no el de paginación', async () => {
  // ?limite= por sí solo (sin ?pagina= y sin ?buscar=) no activa nada nuevo
  // -- el módulo no declaró columnasBusqueda != null acá pero igual debe
  // devolver el array plano completo, el ?limite= de paginación NUNCA se
  // usa a menos que haya ?pagina=/?page= presente.
  const r = await fetch(`${servidor.baseUrl}/api/clientes?limite=2`, { headers: authHeaders() });
  const body = await r.json();
  assert.ok(Array.isArray(body));
  assert.equal(body.length, 5, '?limite= sin ?pagina= no debe recortar el array plano de siempre');
});

test('GET /api/ventas (bespoke): mismo contrato opt-in que el genérico -- array plano por default, { datos, meta } con ?pagina=', async () => {
  const producto = await crearProducto(ctx, empresaId, { nombre: 'paginacion producto', stock: 100, precio_unitario: 10 });
  const cliente = await crearCliente(ctx, empresaId, 'paginacion cliente ventas');

  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ fecha: '2026-01-01', producto_id: producto, cliente_id: cliente, categoria: 'general', cantidad: 1, precio_unitario: 10 })
    });
    const venta = await r.json();
    ctx.ventaIds.push(venta.id);
  }

  const rPlano = await fetch(`${servidor.baseUrl}/api/ventas`, { headers: authHeaders() });
  const bodyPlano = await rPlano.json();
  assert.ok(Array.isArray(bodyPlano), 'sin ?pagina=, ventas.js también debe seguir devolviendo un array plano');
  assert.equal(bodyPlano.length, 3);

  const rPaginado = await fetch(`${servidor.baseUrl}/api/ventas?pagina=1&limite=2`, { headers: authHeaders() });
  const bodyPaginado = await rPaginado.json();
  assert.ok(!Array.isArray(bodyPaginado));
  assert.equal(bodyPaginado.datos.length, 2);
  assert.equal(bodyPaginado.meta.total, 3);
  assert.equal(bodyPaginado.meta.paginasTotales, 2);
});

test('GET /api/clientes?pagina=abc (valor no numérico): cae a la página 1 en vez de romper', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes?pagina=abc`, { headers: authHeaders() });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.meta.pagina, 1);
});

test('GET /api/clientes?pagina=1&limite=500: el límite se topea en 100, nunca deja pedir de más', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes?pagina=1&limite=500`, { headers: authHeaders() });
  const body = await r.json();
  assert.equal(body.meta.limite, 100);
});
