// tests/cajas.test.js
// Sub-fase E (roadmap competitivo, Nivel 2): módulo de Cajas/Turno.
//
// Arqueo: el sistema HOY no distingue medio de pago (ver comentario al
// inicio de src/routes/cajas.js y la migración 040) -- estos tests asumen,
// a propósito, que toda venta/movimiento manual del turno es efectivo. Eso
// es justo lo que se está probando: que la matemática del arqueo (apertura
// + ingresos - egresos = esperado) es exacta contra datos reales, no una
// aproximación.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente,
  crearSucursal, crearCaja, login, limpiarContexto
} from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();
let empresa, sucursalPrincipal, sucursalB;
let headersAdmin;              // administrador, sin restricción
let headersRestringido;        // rol 'ventas', restringido a sucursalPrincipal
let cliente;

before(async () => {
  servidor = await iniciarServidorTest();
  empresa = await crearEmpresa(ctx, 'cajas');
  const { rows } = await pool.query('SELECT id FROM sucursales WHERE empresa_id = $1 AND principal = true', [empresa]);
  sucursalPrincipal = rows[0].id;
  sucursalB = await crearSucursal(ctx, empresa, 'Sede B');

  const admin = await crearUsuario(ctx, { empresaId: empresa });
  const tokenAdmin = await login(servidor.baseUrl, admin.email, admin.password);
  headersAdmin = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` };

  const restringido = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'ventas', sucursalId: sucursalPrincipal });
  const tokenRestringido = await login(servidor.baseUrl, restringido.email, restringido.password);
  headersRestringido = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRestringido}` };

  cliente = await crearCliente(ctx, empresa);
});

after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

async function abrirTurno(headers, cajaId, montoApertura = 100) {
  const r = await fetch(`${servidor.baseUrl}/api/cajas/${cajaId}/turnos`, {
    method: 'POST', headers, body: JSON.stringify({ monto_apertura: montoApertura })
  });
  const body = await r.json();
  return { status: r.status, body };
}

async function cerrarTurno(headers, turnoId, montoDeclarado, notas) {
  const r = await fetch(`${servidor.baseUrl}/api/cajas/turnos/${turnoId}/cerrar`, {
    method: 'PUT', headers, body: JSON.stringify({ monto_cierre_declarado: montoDeclarado, notas })
  });
  const body = await r.json();
  return { status: r.status, body };
}

async function venderProducto(headers, { productoId, turnoCajaId, cantidad = 1, precio_unitario = 100 }) {
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-04-01', producto_id: productoId, cliente_id: cliente, cantidad, precio_unitario, turno_caja_id: turnoCajaId })
  });
  const body = await r.json();
  return { status: r.status, body };
}

// ---------- CRUD de cajas ----------

test('POST /api/cajas: crea una caja en la sucursal indicada', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/cajas`, {
    method: 'POST', headers: headersAdmin,
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) Caja 1', sucursal_id: sucursalPrincipal })
  });
  assert.equal(r.status, 201);
  const caja = await r.json();
  assert.equal(caja.sucursal_id, sucursalPrincipal);
  assert.equal(caja.empresa_id, empresa);
  ctx.cajaIds.push(caja.id);
});

test('GET /api/cajas?sucursal_id=: filtra opt-in', async () => {
  const cajaA = await crearCaja(ctx, empresa, { sucursalId: sucursalPrincipal, nombre: 'Filtro A' });
  const cajaB = await crearCaja(ctx, empresa, { sucursalId: sucursalB, nombre: 'Filtro B' });

  const rA = await fetch(`${servidor.baseUrl}/api/cajas?sucursal_id=${sucursalPrincipal}`, { headers: headersAdmin });
  const listaA = await rA.json();
  assert.ok(listaA.some(c => c.id === cajaA));
  assert.ok(!listaA.some(c => c.id === cajaB));
});

test('DELETE /api/cajas/:id: bloqueada con historial, permitida sin historial', async () => {
  const cajaConHistorial = await crearCaja(ctx, empresa, { nombre: 'Con historial' });
  const { body: turno } = await abrirTurno(headersAdmin, cajaConHistorial, 50);
  await cerrarTurno(headersAdmin, turno.id, 50);

  const rBloqueada = await fetch(`${servidor.baseUrl}/api/cajas/${cajaConHistorial}`, { method: 'DELETE', headers: headersAdmin });
  assert.equal(rBloqueada.status, 409);

  const cajaSinHistorial = await crearCaja(ctx, empresa, { nombre: 'Sin historial' });
  const rOk = await fetch(`${servidor.baseUrl}/api/cajas/${cajaSinHistorial}`, { method: 'DELETE', headers: headersAdmin });
  assert.equal(rOk.status, 204);
});

// ---------- Apertura de turno ----------

test('Abrir turno: 201, estado abierto; abrir un segundo turno en la misma caja: 409', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Apertura simple' });
  const { status, body: turno } = await abrirTurno(headersAdmin, caja, 100);
  assert.equal(status, 201);
  assert.equal(turno.estado, 'abierto');
  assert.equal(Number(turno.monto_apertura), 100);

  const segundo = await abrirTurno(headersAdmin, caja, 50);
  assert.equal(segundo.status, 409);

  await cerrarTurno(headersAdmin, turno.id, 100); // limpio, no queda un turno abierto colgado
});

test('Concurrencia: 3 intentos simultáneos de abrir turno en la misma caja -- exactamente 1 gana', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Concurrencia' });
  const resultados = await Promise.allSettled(
    Array.from({ length: 3 }, () => abrirTurno(headersAdmin, caja, 10))
  );
  const statuses = resultados.map(r => r.status === 'fulfilled' ? r.value.status : 'error');
  assert.equal(statuses.filter(s => s === 201).length, 1, `exactamente 1 debe ganar (statuses: ${statuses})`);
  assert.equal(statuses.filter(s => s === 409).length, 2, `las otras 2 deben rechazarse (statuses: ${statuses})`);

  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM turnos_caja WHERE caja_id = $1 AND estado = 'abierto'`, [caja]);
  assert.equal(rows[0].n, 1, 'nunca debe quedar más de un turno abierto en la base, ni bajo concurrencia');

  const ganador = resultados.find(r => r.status === 'fulfilled' && r.value.status === 201);
  await cerrarTurno(headersAdmin, ganador.value.body.id, 10);
});

// ---------- Ventas + turno_caja_id ----------

test('Venta con turno_caja_id válido: la venta y el ingreso en finanzas quedan atados al turno', async () => {
  const ctxTest = nuevoContexto();
  // precio_unitario del producto = 50, para que vender a 50 quede DENTRO del
  // rango ±30% de catálogo que ya exige ventas.js (V-06) -- el default de
  // crearProducto() es 100, vender a 50 contra eso lo rechazaría con 400.
  const producto = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal, precio_unitario: 50 });
  const caja = await crearCaja(ctx, empresa, { nombre: 'Venta con turno' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);

  const { status, body: venta } = await venderProducto(headersAdmin, { productoId: producto, turnoCajaId: turno.id, cantidad: 2, precio_unitario: 50 });
  assert.equal(status, 201, `la venta debería crearse (${JSON.stringify(venta)})`);
  ctxTest.ventaIds.push(venta.id);
  assert.equal(venta.turno_caja_id, turno.id);

  const { rows: finanzasRows } = await pool.query(
    `SELECT turno_caja_id FROM finanzas WHERE origen_modulo='ventas' AND origen_id=$1`, [venta.id]
  );
  assert.equal(finanzasRows[0].turno_caja_id, turno.id);

  await cerrarTurno(headersAdmin, turno.id, 100);
  await limpiarContexto(ctxTest);
});

test('Venta con turno_caja_id de otra sucursal: 400', async () => {
  const ctxTest = nuevoContexto();
  const productoPrincipal = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal });
  const cajaB = await crearCaja(ctx, empresa, { sucursalId: sucursalB, nombre: 'Turno en sede B' });
  const { body: turnoB } = await abrirTurno(headersAdmin, cajaB, 0);

  const { status } = await venderProducto(headersAdmin, { productoId: productoPrincipal, turnoCajaId: turnoB.id });
  assert.equal(status, 400);

  await cerrarTurno(headersAdmin, turnoB.id, 0);
  await limpiarContexto(ctxTest);
});

test('Venta con turno_caja_id de un turno ya cerrado: 400', async () => {
  const ctxTest = nuevoContexto();
  const producto = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal });
  const caja = await crearCaja(ctx, empresa, { nombre: 'Turno cerrado' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);
  await cerrarTurno(headersAdmin, turno.id, 0);

  const { status } = await venderProducto(headersAdmin, { productoId: producto, turnoCajaId: turno.id });
  assert.equal(status, 400);
  await limpiarContexto(ctxTest);
});

test('Venta SIN turno_caja_id: se comporta exactamente igual que antes de esta sub-fase', async () => {
  const ctxTest = nuevoContexto();
  const producto = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal });
  const { status, body: venta } = await venderProducto(headersAdmin, { productoId: producto });
  assert.equal(status, 201);
  ctxTest.ventaIds.push(venta.id);
  assert.equal(venta.turno_caja_id, null);
  await limpiarContexto(ctxTest);
});

// ---------- Finanzas + turno_caja_id ----------

test('POST /api/finanzas con turno_caja_id: la sucursal se deriva del turno (gana sobre sucursal_id mandado)', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Finanzas con turno' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);

  const r = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersAdmin,
    body: JSON.stringify({ fecha: '2026-04-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) retiro de caja', monto: 20, turno_caja_id: turno.id, sucursal_id: sucursalB })
  });
  assert.equal(r.status, 201);
  const movimiento = await r.json();
  assert.equal(movimiento.turno_caja_id, turno.id);
  assert.equal(movimiento.sucursal_id, sucursalPrincipal, 'la sucursal del turno debe ganar sobre el sucursal_id mandado (sucursalB)');

  await cerrarTurno(headersAdmin, turno.id, -20);
});

test('POST /api/finanzas con turno_caja_id que no está abierto: 400', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Finanzas turno cerrado' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);
  await cerrarTurno(headersAdmin, turno.id, 0);

  const r = await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersAdmin,
    body: JSON.stringify({ fecha: '2026-04-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) intento tarde', monto: 5, turno_caja_id: turno.id })
  });
  assert.equal(r.status, 400);
});

// ---------- Cierre de turno: arqueo ----------

test('Cerrar turno: monto_cierre_sistema y diferencia calculados exactos (apertura + ventas - egresos)', async () => {
  const ctxTest = nuevoContexto();
  // Dos productos, cada uno con precio de catálogo IGUAL al precio al que se
  // vende -- así ninguna venta cae fuera del rango ±30% que ya exige
  // ventas.js (V-06), sin importar el precio elegido para este test.
  const productoA = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal, precio_unitario: 60 });
  const productoB = await crearProducto(ctxTest, empresa, { stock: 10, sucursalId: sucursalPrincipal, precio_unitario: 40 });
  const caja = await crearCaja(ctx, empresa, { nombre: 'Arqueo exacto' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 100); // apertura: 100

  // Venta de 60 (ingreso) + venta de 40 (ingreso) = 100 en ventas.
  const v1 = await venderProducto(headersAdmin, { productoId: productoA, turnoCajaId: turno.id, cantidad: 1, precio_unitario: 60 });
  assert.equal(v1.status, 201, `venta 1 debería crearse (${JSON.stringify(v1.body)})`);
  ctxTest.ventaIds.push(v1.body.id);
  const v2 = await venderProducto(headersAdmin, { productoId: productoB, turnoCajaId: turno.id, cantidad: 1, precio_unitario: 40 });
  assert.equal(v2.status, 201, `venta 2 debería crearse (${JSON.stringify(v2.body)})`);
  ctxTest.ventaIds.push(v2.body.id);

  // Egreso manual de 25 (retiro).
  await fetch(`${servidor.baseUrl}/api/finanzas`, {
    method: 'POST', headers: headersAdmin,
    body: JSON.stringify({ fecha: '2026-04-01', tipo: 'egreso', concepto: 'QA-TEST (borrar) retiro', monto: 25, turno_caja_id: turno.id })
  });

  // Esperado: 100 (apertura) + 100 (ventas) - 25 (egreso) = 175.
  const { status, body: cerrado } = await cerrarTurno(headersAdmin, turno.id, 175, 'Cuadró exacto');
  assert.equal(status, 200);
  assert.equal(Number(cerrado.monto_cierre_sistema), 175);
  assert.equal(Number(cerrado.diferencia), 0);
  assert.equal(cerrado.estado, 'cerrado');

  await limpiarContexto(ctxTest);
});

test('Cerrar turno con un faltante real: diferencia negativa correcta', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Arqueo con faltante' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 50);
  // Sin ventas ni egresos: esperado = 50. Declara 45 -> faltan 5.
  const { body: cerrado } = await cerrarTurno(headersAdmin, turno.id, 45);
  assert.equal(Number(cerrado.monto_cierre_sistema), 50);
  assert.equal(Number(cerrado.diferencia), -5);
});

test('Cerrar un turno ya cerrado: 409', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Doble cierre' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);
  await cerrarTurno(headersAdmin, turno.id, 0);
  const segundo = await cerrarTurno(headersAdmin, turno.id, 0);
  assert.equal(segundo.status, 409);
});

test('Cerrar sin monto_cierre_declarado: 400', async () => {
  const caja = await crearCaja(ctx, empresa, { nombre: 'Sin monto declarado' });
  const { body: turno } = await abrirTurno(headersAdmin, caja, 0);
  const r = await fetch(`${servidor.baseUrl}/api/cajas/turnos/${turno.id}/cerrar`, {
    method: 'PUT', headers: headersAdmin, body: JSON.stringify({})
  });
  assert.equal(r.status, 400);
  await cerrarTurno(headersAdmin, turno.id, 0);
});

test('Cualquiera con cajas.editar puede cerrar un turno que abrió otra persona', async () => {
  const caja = await crearCaja(ctx, empresa, { sucursalId: sucursalPrincipal, nombre: 'Cambio de turno' });
  // Lo abre el usuario restringido (rol ventas, tiene cajas.editar).
  const { body: turno } = await abrirTurno(headersRestringido, caja, 20);
  // Lo cierra el admin -- distinta persona.
  const { status, body: cerrado } = await cerrarTurno(headersAdmin, turno.id, 20);
  assert.equal(status, 200);
  assert.notEqual(cerrado.usuario_apertura_id, cerrado.usuario_cierre_id);
});

// ---------- Restricción D aplicada a cajas/turnos ----------

test('Restricción D: usuario restringido no puede abrir turno de una caja de otra sucursal (404)', async () => {
  const cajaB = await crearCaja(ctx, empresa, { sucursalId: sucursalB, nombre: 'Ajena para restringido' });
  const r = await abrirTurno(headersRestringido, cajaB, 10);
  assert.equal(r.status, 404);
});

test('Restricción D: usuario restringido no puede crear una caja en otra sucursal explícita (403)', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/cajas`, {
    method: 'POST', headers: headersRestringido,
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) intento ajeno', sucursal_id: sucursalB })
  });
  assert.equal(r.status, 403);
});

test('Restricción D: GET /api/cajas?sucursal_id=<otra> restringido: 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/cajas?sucursal_id=${sucursalB}`, { headers: headersRestringido });
  assert.equal(r.status, 403);
});

test('Restricción D: usuario restringido puede abrir/cerrar turno de una caja de SU sucursal', async () => {
  const cajaPropia = await crearCaja(ctx, empresa, { sucursalId: sucursalPrincipal, nombre: 'Propia para restringido' });
  const { status, body: turno } = await abrirTurno(headersRestringido, cajaPropia, 30);
  assert.equal(status, 201);

  const cierre = await cerrarTurno(headersRestringido, turno.id, 30);
  assert.equal(cierre.status, 200);
  assert.equal(cierre.body.estado, 'cerrado');
});
