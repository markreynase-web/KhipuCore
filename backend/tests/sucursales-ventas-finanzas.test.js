// tests/sucursales-ventas-finanzas.test.js
// Sub-fase C (roadmap competitivo, Nivel 2): ventas.js y finanzas.js quedan
// "sucursal-aware". sucursal_id de una venta se DERIVA del producto vendido
// (nunca lo manda el cliente, ver ventas.js POST) -- por eso ningún test acá
// abajo lo manda en el body, solo lo verifica en la respuesta/en la base.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente,
  crearSucursal, login, limpiarContexto, PASSWORD_QA
} from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();
let empresa, admin, token, headers, sucursalPrincipal, sucursalB;

before(async () => {
  servidor = await iniciarServidorTest();
  empresa = await crearEmpresa(ctx, 'sucursales-ventas-finanzas');
  admin = await crearUsuario(ctx, { empresaId: empresa });
  token = await login(servidor.baseUrl, admin.email, admin.password);
  headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const { rows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1 AND principal = true', [empresa]);
  sucursalPrincipal = rows[0].id;
  sucursalB = await crearSucursal(ctx, empresa, 'Sede B');
});

after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

// El body de un Response solo se puede leer una vez -- armar el mensaje de
// assert.equal con un `await r.text()` inline lo consumía SIEMPRE (el
// template literal se evalúa antes de llamar a assert.equal, pase o no la
// aserción), y el r.json() de la línea siguiente fallaba incluso en el
// camino feliz con "Body is unusable: Body has already been read". Por eso
// acá se lee el body una sola vez, y recién después se decide qué hacer con él.
async function venderProducto({ productoId, clienteId, cantidad = 1, precio_unitario = 100 }) {
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-02-01', producto_id: productoId, cliente_id: clienteId, cantidad, precio_unitario })
  });
  const body = await r.json();
  assert.equal(r.status, 201, `la venta debería crearse (${JSON.stringify(body)})`);
  return body;
}

test('la venta hereda sucursal_id del producto vendido, y el ingreso en finanzas también', async () => {
  const ctxTest = nuevoContexto();
  const producto = await crearProducto(ctxTest, empresa, { stock: 20, precio_unitario: 100, sucursalId: sucursalB });
  const cliente = await crearCliente(ctxTest, empresa);

  const venta = await venderProducto({ productoId: producto, clienteId: cliente });
  ctxTest.ventaIds.push(venta.id);
  assert.equal(venta.sucursal_id, sucursalB);

  const { rows: finanzasRows } = await pool.query(
    `SELECT sucursal_id FROM finanzas WHERE origen_modulo = 'ventas' AND origen_id = $1 AND empresa_id = $2`,
    [venta.id, empresa]
  );
  assert.equal(finanzasRows[0].sucursal_id, sucursalB);

  await limpiarContexto(ctxTest);
});

test('dos productos en sucursales distintas generan ventas con sucursal_id distintos', async () => {
  const ctxTest = nuevoContexto();
  const productoPrincipal = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalPrincipal });
  const productoB = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalB });
  const cliente = await crearCliente(ctxTest, empresa);

  const ventaPrincipal = await venderProducto({ productoId: productoPrincipal, clienteId: cliente });
  const ventaB = await venderProducto({ productoId: productoB, clienteId: cliente });
  ctxTest.ventaIds.push(ventaPrincipal.id, ventaB.id);

  assert.equal(ventaPrincipal.sucursal_id, sucursalPrincipal);
  assert.equal(ventaB.sucursal_id, sucursalB);
  assert.notEqual(ventaPrincipal.sucursal_id, ventaB.sucursal_id);

  await limpiarContexto(ctxTest);
});

test('GET /api/ventas?sucursal_id=: filtra opt-in; sin el parámetro trae todo (incluidas ventas sin sucursal)', async () => {
  const ctxTest = nuevoContexto();
  const producto = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalB });
  const cliente = await crearCliente(ctxTest, empresa);
  const venta = await venderProducto({ productoId: producto, clienteId: cliente });
  ctxTest.ventaIds.push(venta.id);

  // Simula una venta histórica de antes de esta sub-fase (sucursal_id null)
  // -- inserción directa, no hay forma de producir esto vía la API a
  // propósito (ver comentario en ventas.js POST).
  const { rows: historicaRows } = await pool.query(
    `INSERT INTO ventas (fecha, cliente, cliente_id, producto, producto_id, cantidad, precio_unitario, monto, empresa_id, sucursal_id)
     VALUES ('2020-01-01', 'QA-TEST (borrar) histórico', $1, 'QA-TEST (borrar) producto histórico', $2, 1, 10, 10, $3, NULL) RETURNING id`,
    [cliente, producto, empresa]
  );
  ctxTest.ventaIds.push(historicaRows[0].id);

  const rFiltrado = await fetch(`${servidor.baseUrl}/api/ventas?sucursal_id=${sucursalB}`, { headers });
  const filtradas = await rFiltrado.json();
  assert.ok(filtradas.some(v => v.id === venta.id));
  assert.ok(!filtradas.some(v => v.id === historicaRows[0].id), 'la venta histórica (sin sucursal) no debe salir en el filtro');

  const rTodo = await fetch(`${servidor.baseUrl}/api/ventas`, { headers });
  const todas = await rTodo.json();
  assert.ok(todas.some(v => v.id === venta.id));
  assert.ok(todas.some(v => v.id === historicaRows[0].id), 'sin filtro, la histórica sigue apareciendo como siempre');

  await limpiarContexto(ctxTest);
});

test('GET /api/finanzas?sucursal_id=: filtra el detalle línea por línea', async () => {
  const ctxTest = nuevoContexto();
  const producto = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalB });
  const cliente = await crearCliente(ctxTest, empresa);
  const venta = await venderProducto({ productoId: producto, clienteId: cliente });
  ctxTest.ventaIds.push(venta.id);

  const rFiltrado = await fetch(`${servidor.baseUrl}/api/finanzas?sucursal_id=${sucursalB}`, { headers });
  const filtrado = await rFiltrado.json();
  assert.ok(filtrado.some(f => f.origen_modulo === 'ventas' && f.origen_id === venta.id));

  const rOtra = await fetch(`${servidor.baseUrl}/api/finanzas?sucursal_id=${sucursalPrincipal}`, { headers });
  const otra = await rOtra.json();
  assert.ok(!otra.some(f => f.origen_id === venta.id));

  await limpiarContexto(ctxTest);
});

// sucursalPrincipal/sucursalB y la fecha '2026-02-01' se comparten con OTROS
// tests de este mismo archivo (misma empresa, creada una sola vez en
// before()) -- comparar contra valores absolutos rompería apenas otro test
// vendiera algo ese mismo día en esa misma sucursal. Por eso este test mide
// por DELTA: una foto del resumen antes de sus propias operaciones, y otra
// después -- la diferencia es lo único que le pertenece a este test.
async function resumenEn(desde, hasta) {
  const r = await fetch(`${servidor.baseUrl}/api/finanzas/resumen-sucursales?desde=${desde}&hasta=${hasta}`, { headers });
  assert.equal(r.status, 200);
  return r.json();
}
function filaDe(resumen, sucursalId) {
  return resumen.porSucursal.find(s => s.sucursal_id === sucursalId) || { ingresos: 0, egresos: 0, ganancia: 0 };
}

test('GET /api/finanzas/resumen-sucursales: ganancia por sucursal + bucket sin asignar + total general', async () => {
  const ctxTest = nuevoContexto();
  const productoPrincipal = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalPrincipal });
  const productoB = await crearProducto(ctxTest, empresa, { stock: 20, sucursalId: sucursalB });
  const cliente = await crearCliente(ctxTest, empresa);

  const antes = await resumenEn('2026-02-01', '2026-02-01');
  const antesPrincipal = filaDe(antes, sucursalPrincipal);
  const antesB = filaDe(antes, sucursalB);

  // Principal: ingreso de 300 (venta) - egreso manual de 50 (insertado
  // directo, simulando un costo ya cargado con sucursal -- POST /finanzas
  // a propósito no acepta sucursal_id todavía, ver comentario en finanzas.js).
  const ventaPrincipal = await venderProducto({ productoId: productoPrincipal, clienteId: cliente, cantidad: 3, precio_unitario: 100 });
  ctxTest.ventaIds.push(ventaPrincipal.id);
  await pool.query(
    `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, empresa_id, sucursal_id) VALUES ('2026-02-01', 'egreso', 'Test', 'QA-TEST (borrar) egreso principal', 50, $1, $2)`,
    [empresa, sucursalPrincipal]
  );

  // Sede B: ingreso de 200 (venta), sin egresos.
  const ventaB = await venderProducto({ productoId: productoB, clienteId: cliente, cantidad: 2, precio_unitario: 100 });
  ctxTest.ventaIds.push(ventaB.id);

  // Sin sucursal: un egreso manual real, vía API (POST /finanzas no manda
  // sucursal_id) -- debe caer en el bucket sinSucursal, no perderse.
  const rEgresoManual = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-02-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) egreso sin sucursal', monto: 20 })
  });
  assert.equal(rEgresoManual.status, 201);

  const despues = await resumenEn('2026-02-01', '2026-02-01');
  const despuesPrincipal = filaDe(despues, sucursalPrincipal);
  const despuesB = filaDe(despues, sucursalB);

  assert.equal(despuesPrincipal.ingresos - antesPrincipal.ingresos, 300);
  assert.equal(despuesPrincipal.egresos - antesPrincipal.egresos, 50);
  assert.equal(despuesPrincipal.ganancia - antesPrincipal.ganancia, 250);
  assert.equal(despuesB.ingresos - antesB.ingresos, 200);
  assert.equal(despuesB.egresos - antesB.egresos, 0);
  assert.equal(despuesB.ganancia - antesB.ganancia, 200);

  assert.equal(despues.sinSucursal.ingresos - antes.sinSucursal.ingresos, 0);
  assert.equal(despues.sinSucursal.egresos - antes.sinSucursal.egresos, 20);
  assert.equal(despues.sinSucursal.ganancia - antes.sinSucursal.ganancia, -20);

  assert.equal(despues.total.ingresos - antes.total.ingresos, 500);
  assert.equal(despues.total.egresos - antes.total.egresos, 70);
  assert.equal(despues.total.ganancia - antes.total.ganancia, 430);

  // Fuera del rango de fecha (un día sin ningún movimiento de nadie, ni de
  // este test ni de otros): todo en 0, pero la sucursal sigue apareciendo
  // (LEFT JOIN, no desaparece solo porque no tuvo movimientos ese día).
  const resumenFuera = await resumenEn('2020-01-01', '2020-01-02');
  assert.ok(resumenFuera.porSucursal.some(s => s.sucursal_id === sucursalPrincipal));
  assert.equal(filaDe(resumenFuera, sucursalPrincipal).ganancia, 0);

  await limpiarContexto(ctxTest);
});

// El pedido explícito del usuario: alguien con acceso SOLO a Finanzas (sin
// sucursales.ver) tiene que poder ver este resumen igual -- ningún rol
// sembrado hoy tiene esa combinación exacta (administrador/gerente/
// supervisor, los 3 únicos con finanzas.ver, también tienen sucursales.ver
// desde la migración 037), así que se arma un rol ad-hoc con SOLO
// finanzas.ver para probarlo de verdad, no por casualidad.
test('GET /api/finanzas/resumen-sucursales: un usuario con SOLO finanzas.ver (sin sucursales.ver) puede verlo igual', async () => {
  const { rows: rolRows } = await pool.query(`INSERT INTO roles (nombre) VALUES ($1) RETURNING id`, [`QA-TEST-solo-finanzas-${Date.now()}`]);
  const rolId = rolRows[0].id;
  const { rows: permisoRows } = await pool.query(`SELECT id FROM permisos WHERE nombre = 'finanzas.ver'`);
  await pool.query(`INSERT INTO rol_permiso (rol_id, permiso_id) VALUES ($1, $2)`, [rolId, permisoRows[0].id]);

  const email = `qa-test-solo-finanzas-${Date.now()}@example.invalid`;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows: usuarioRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo) VALUES ('QA-TEST (borrar) solo finanzas', $1, $2, true) RETURNING id`,
    [email, hash]
  );
  ctx.usuarioIds.push(usuarioRows[0].id);
  await pool.query(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES ($1,$2,$3,true)`, [usuarioRows[0].id, empresa, rolId]);

  const tokenSoloFinanzas = await login(servidor.baseUrl, email, PASSWORD_QA);
  const r = await fetch(`${servidor.baseUrl}/api/finanzas/resumen-sucursales`, { headers: { Authorization: `Bearer ${tokenSoloFinanzas}` } });
  assert.equal(r.status, 200);
  const resumen = await r.json();
  assert.ok(Array.isArray(resumen.porSucursal));

  // Confirmación negativa: este mismo usuario NO puede ver /api/sucursales
  // (no tiene sucursales.ver) -- si esto diera 200, el endpoint de resumen
  // no estaría probando nada distinto de "tiene los dos permisos".
  const rSucursales = await fetch(`${servidor.baseUrl}/api/sucursales`, { headers: { Authorization: `Bearer ${tokenSoloFinanzas}` } });
  assert.equal(rSucursales.status, 403);

  await pool.query(`DELETE FROM usuario_empresa WHERE usuario_id = $1`, [usuarioRows[0].id]);
  await pool.query(`DELETE FROM rol_permiso WHERE rol_id = $1`, [rolId]);
  await pool.query(`DELETE FROM roles WHERE id = $1`, [rolId]);
});
