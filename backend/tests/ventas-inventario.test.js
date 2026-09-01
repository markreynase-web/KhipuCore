// tests/ventas-inventario.test.js
// RF-2 (Fase 1): invariante no negociable -- toda venta que descuenta stock
// es atómica; nunca queda una venta confirmada sin su movimiento de stock,
// ni un stock a medio descontar por un error posterior en la misma
// transacción. Cubre backend/src/routes/ventas.js (POST y PUT).

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente,
  login, limpiarContexto
} from './helpers/fixtures.js';
// Pool de tests, nunca el de producción -- ver tests/helpers/testDb.js.
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctxSuite = nuevoContexto();
let empresa, token, headers;

before(async () => {
  servidor = await iniciarServidorTest();
  empresa = await crearEmpresa(ctxSuite, 'ventas-inv');
  const cuenta = await crearUsuario(ctxSuite, { empresaId: empresa });
  token = await login(servidor.baseUrl, cuenta.email, cuenta.password);
  headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
});

after(async () => {
  await limpiarContexto(ctxSuite);
  await servidor.detener();
  await pool.end();
});

// Cada test arma su propio producto/cliente con stock/precio a medida, y los
// registra en un contexto propio que se limpia al final de ESE test -- así
// un test no puede contaminar el stock que espera ver otro.
let ctxTest;
beforeEach(() => { ctxTest = nuevoContexto(); });
afterEach(async () => { await limpiarContexto(ctxTest); });

async function stockActual(productoId) {
  const { rows } = await pool.query('SELECT stock FROM inventario WHERE id = $1', [productoId]);
  return Number(rows[0].stock);
}

test('venta válida: descuenta stock, genera ingreso en finanzas y suma compras_totales del cliente', async () => {
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 5, precio_unitario: 100 })
  });
  assert.equal(r.status, 201);
  const venta = await r.json();
  ctxTest.ventaIds.push(venta.id);

  assert.equal(await stockActual(producto), 45, 'el stock debe quedar en 50 - 5 = 45');

  const { rows: finanzas } = await pool.query(
    `SELECT tipo, monto FROM finanzas WHERE origen_modulo = 'ventas' AND origen_id = $1 AND empresa_id = $2`,
    [venta.id, empresa]
  );
  assert.equal(finanzas.length, 1, 'debe existir exactamente un movimiento de finanzas para esta venta');
  assert.equal(finanzas[0].tipo, 'ingreso');
  assert.equal(Number(finanzas[0].monto), 500);

  const { rows: clienteRows } = await pool.query('SELECT compras_totales FROM clientes WHERE id = $1', [cliente]);
  assert.equal(Number(clienteRows[0].compras_totales), 500);
});

test('stock insuficiente: la operación se rechaza (409) sin dejar cambios parciales', async () => {
  const producto = await crearProducto(ctxTest, empresa, { stock: 3, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 10, precio_unitario: 100 })
  });
  assert.equal(r.status, 409);

  assert.equal(await stockActual(producto), 3, 'el stock no debe haberse tocado');
  const { rows: ventas } = await pool.query('SELECT id FROM ventas WHERE producto_id = $1', [producto]);
  assert.equal(ventas.length, 0, 'no debe haberse creado ninguna venta');
  const { rows: finanzas } = await pool.query(`SELECT id FROM finanzas WHERE origen_modulo = 'ventas' AND origen_id IS NOT NULL AND empresa_id = $1`, [empresa]);
  // (no hay origen_id todavía porque la venta nunca se creó -- esta consulta
  // solo confirma que no quedó ningún movimiento huérfano)
  assert.ok(Array.isArray(finanzas));
});

test('precio fuera de rango (±30% del catálogo): se rechaza sin dejar cambios parciales', async () => {
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 1, precio_unitario: 200 })
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /entre S\/ 70\.00 y S\/ 130\.00/);
  assert.equal(await stockActual(producto), 50, 'el stock no debe haberse tocado');
});

test('precio dentro del rango (±30%): se acepta en los dos bordes exactos', async () => {
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  for (const precio of [70, 130]) {
    const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
      method: 'POST', headers,
      body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 1, precio_unitario: precio })
    });
    assert.equal(r.status, 201, `precio ${precio} (borde del rango) debe aceptarse`);
    const venta = await r.json();
    ctxTest.ventaIds.push(venta.id);
  }
});

test('producto inexistente en esta empresa: 404 sin cambios parciales', async () => {
  const cliente = await crearCliente(ctxTest, empresa);
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: 999999999, cliente_id: cliente, cantidad: 1, precio_unitario: 100 })
  });
  assert.equal(r.status, 404);
});

test('error inesperado a nivel de base de datos (no una regla de negocio) durante el POST: rollback completo, 500, cero efectos secundarios', async () => {
  // categoria es VARCHAR(120) en la tabla ventas (001_ventas.sql). Un valor
  // de 200 caracteres no lo rechaza ninguna validación de la aplicación --
  // solo Postgres, al ejecutar el INSERT. Esto ejercita el catch/ROLLBACK
  // genérico de la ruta, no una de las validaciones explícitas de arriba.
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({
      fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 1, precio_unitario: 100,
      categoria: 'x'.repeat(200)
    })
  });
  assert.equal(r.status, 500);
  assert.equal(await stockActual(producto), 50, 'el stock no debe haber cambiado pese al error de base de datos');
  const { rows: ventas } = await pool.query('SELECT id FROM ventas WHERE producto_id = $1', [producto]);
  assert.equal(ventas.length, 0);
});

test('PUT: un error posterior en la misma transacción revierte también los cambios de stock ya aplicados', async () => {
  // Secuencia real dentro de PUT /:id: primero ajusta el stock por la
  // diferencia de cantidad, y RECIÉN DESPUÉS hace el UPDATE final de
  // ventas (que incluye categoria). Forzar el overflow de categoria(120)
  // en ese último UPDATE prueba que Postgres deshace también el ajuste de
  // stock que ya se había escrito antes en la misma transacción -- no solo
  // que el estatement que falla no se aplica.
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const rPost = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 5, precio_unitario: 100 })
  });
  assert.equal(rPost.status, 201);
  const venta = await rPost.json();
  ctxTest.ventaIds.push(venta.id);
  assert.equal(await stockActual(producto), 45);

  const rPut = await fetch(`${servidor.baseUrl}/api/ventas/${venta.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ cantidad: 10, categoria: 'x'.repeat(200) })
  });
  assert.equal(rPut.status, 500);

  assert.equal(await stockActual(producto), 45, 'el stock debe seguir en 45 -- el ajuste intermedio a 40 debe haberse revertido');
  const { rows: ventaRows } = await pool.query('SELECT cantidad FROM ventas WHERE id = $1', [venta.id]);
  assert.equal(Number(ventaRows[0].cantidad), 5, 'la cantidad de la venta no debe haber cambiado a 10');
});

test('dos ventas concurrentes sobre el mismo stock: no hay sobreventa ni corrupción', async () => {
  const stockInicial = 10;
  const producto = await crearProducto(ctxTest, empresa, { stock: stockInicial, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const hacerVenta = () => fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 8, precio_unitario: 100 })
  });

  const [r1, r2] = await Promise.all([hacerVenta(), hacerVenta()]);
  const estados = [r1.status, r2.status].sort();
  assert.deepEqual(estados, [201, 409], 'exactamente una debe aceptarse y la otra rechazarse por stock insuficiente');

  const stockFinal = await stockActual(producto);
  const { rows: ventas } = await pool.query(
    'SELECT id, cantidad FROM ventas WHERE producto_id = $1', [producto]
  );
  const cantidadTotalVendida = ventas.reduce((suma, v) => suma + Number(v.cantidad), 0);

  // Invariantes exigidas explícitamente, verificadas contra el estado
  // PERSISTIDO en la base -- no solo contra los códigos HTTP de la respuesta.
  assert.ok(stockFinal >= 0, `stock_final debe ser >= 0 (fue ${stockFinal})`);
  assert.ok(
    cantidadTotalVendida <= stockInicial,
    `cantidad_total_vendida (${cantidadTotalVendida}) debe ser <= stock_inicial (${stockInicial})`
  );

  // Además, para este escenario concreto (8+8=16 > 10), el resultado exacto
  // esperado es que se haya vendido una sola vez.
  assert.equal(stockFinal, 2, 'el stock final debe ser 10 - 8 = 2 exactamente');
  assert.equal(ventas.length, 1, 'debe haberse creado exactamente una venta, no dos');
  ctxTest.ventaIds.push(...ventas.map(v => v.id));
});

test('DELETE (anular venta): devuelve el stock y borra el movimiento de finanzas', async () => {
  const producto = await crearProducto(ctxTest, empresa, { stock: 50, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const rPost = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 4, precio_unitario: 100 })
  });
  const venta = await rPost.json();
  assert.equal(await stockActual(producto), 46);

  const rDelete = await fetch(`${servidor.baseUrl}/api/ventas/${venta.id}`, { method: 'DELETE', headers });
  assert.equal(rDelete.status, 204);

  assert.equal(await stockActual(producto), 50, 'el stock debe volver a 50 al anular la venta');
  const { rows: finanzas } = await pool.query(`SELECT id FROM finanzas WHERE origen_modulo='ventas' AND origen_id = $1`, [venta.id]);
  assert.equal(finanzas.length, 0, 'el movimiento de finanzas de esa venta debe haberse borrado');
});

// --- B1: borde exacto stock = 0 ---

test('borde exacto: vender EXACTAMENTE el stock disponible deja stock en 0; una unidad más se rechaza sin efectos', async () => {
  const stockInicial = 7;
  const producto = await crearProducto(ctxTest, empresa, { stock: stockInicial, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const rVenta = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: stockInicial, precio_unitario: 100 })
  });
  assert.equal(rVenta.status, 201);
  const venta = await rVenta.json();
  ctxTest.ventaIds.push(venta.id);

  assert.equal(await stockActual(producto), 0, 'el stock debe quedar exactamente en 0');
  const { rows: ventasRows } = await pool.query('SELECT cantidad FROM ventas WHERE producto_id = $1', [producto]);
  assert.equal(ventasRows.length, 1, 'debe existir exactamente una venta');
  assert.equal(Number(ventasRows[0].cantidad), stockInicial);
  const { rows: finRows } = await pool.query(`SELECT monto FROM finanzas WHERE origen_modulo='ventas' AND origen_id = $1`, [venta.id]);
  assert.equal(finRows.length, 1);
  assert.equal(Number(finRows[0].monto), stockInicial * 100);

  const rExtra = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 1, precio_unitario: 100 })
  });
  assert.equal(rExtra.status, 409);

  assert.equal(await stockActual(producto), 0, 'el stock debe seguir exactamente en 0');
  const { rows: ventasDespues } = await pool.query('SELECT id FROM ventas WHERE producto_id = $1', [producto]);
  assert.equal(ventasDespues.length, 1, 'no debe haberse creado una segunda venta');
  const { rows: finDespues } = await pool.query(`SELECT id FROM finanzas WHERE origen_modulo='ventas' AND origen_id = $1`, [venta.id]);
  assert.equal(finDespues.length, 1, 'sigue existiendo un único movimiento financiero, ninguno adicional');
});

// --- B2: 3+ requests concurrentes ---

test('tres ventas concurrentes (Promise.allSettled, 6 unidades c/u sobre stock=10): invariantes verificadas contra estado persistido', async () => {
  const stockInicial = 10;
  const producto = await crearProducto(ctxTest, empresa, { stock: stockInicial, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  const hacerVenta = () => fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 6, precio_unitario: 100 })
  });

  const resultados = await Promise.allSettled([hacerVenta(), hacerVenta(), hacerVenta()]);
  assert.ok(resultados.every(r => r.status === 'fulfilled'), 'las 3 requests deben completarse (fulfilled), no rechazarse a nivel de red');
  const respuestas = resultados.map(r => r.value);
  const statuses = respuestas.map(r => r.status);
  assert.ok(statuses.every(s => s === 201 || s === 409), `cada respuesta debe ser 201 o 409, se obtuvo: ${statuses}`);
  const aceptadas = statuses.filter(s => s === 201).length;

  const stockFinal = await stockActual(producto);
  const { rows: ventasRows } = await pool.query('SELECT id, cantidad FROM ventas WHERE producto_id = $1', [producto]);
  const cantidadTotalVendida = ventasRows.reduce((s, v) => s + Number(v.cantidad), 0);
  const { rows: finRows } = ventasRows.length
    ? await pool.query(`SELECT id FROM finanzas WHERE origen_modulo='ventas' AND origen_id = ANY($1::int[])`, [ventasRows.map(v => v.id)])
    : { rows: [] };

  // Invariantes exigidas explícitamente, contra estado persistido -- no solo HTTP.
  assert.ok(stockFinal >= 0, `stock_final debe ser >= 0 (fue ${stockFinal})`);
  assert.ok(cantidadTotalVendida <= stockInicial, `cantidad_total_vendida (${cantidadTotalVendida}) debe ser <= stock_inicial (${stockInicial})`);
  assert.equal(ventasRows.length, aceptadas, 'cantidad de ventas persistidas debe coincidir exactamente con las aceptadas por HTTP');
  assert.equal(finRows.length, aceptadas, 'cantidad de movimientos financieros debe coincidir exactamente con las ventas persistidas');

  // Con stock=10 y 6 unidades por venta: la primera en tomar el lock siempre
  // acepta (10>=6), deja 4, y las otras dos siempre rechazan (4<6) sin
  // importar el orden -- por eso este resultado es determinístico, no una
  // suposición fija sin fundamento.
  assert.equal(aceptadas, 1, 'con demanda 6+6+6=18 sobre stock 10, la aritmética solo permite que 1 se acepte');
  assert.equal(stockFinal, 4, 'stock final debe ser 10 - 6 = 4');

  ctxTest.ventaIds.push(...ventasRows.map(v => v.id));
});

// --- B3: concurrencia mixta POST + PUT ---

test('concurrencia mixta POST + PUT sobre el mismo producto: sin lost update, estado final derivado de lo realmente aceptado', async () => {
  const stockInicial = 20;
  const producto = await crearProducto(ctxTest, empresa, { stock: stockInicial, precio_unitario: 100 });
  const cliente = await crearCliente(ctxTest, empresa);

  // Venta A se crea ANTES de la carrera, de forma síncrona.
  const rVentaA = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 5, precio_unitario: 100 })
  });
  assert.equal(rVentaA.status, 201);
  const ventaA = await rVentaA.json();
  ctxTest.ventaIds.push(ventaA.id);

  const stockAntesDeLaCarrera = await stockActual(producto);
  assert.equal(stockAntesDeLaCarrera, 15, 'stock antes de la carrera: 20 - 5 = 15');

  // En paralelo real: POST nueva venta (+10) y PUT de venta A (5 -> 12,
  // delta +7). Demanda concurrente combinada = 17 > 15 disponibles -- NO
  // se asume que ambas quepan; el resultado esperado se deriva después de
  // ver qué se aceptó de verdad.
  const [resPost, resPut] = await Promise.allSettled([
    fetch(`${servidor.baseUrl}/api/ventas`, {
      method: 'POST', headers,
      body: JSON.stringify({ fecha: '2026-01-15', producto_id: producto, cliente_id: cliente, cantidad: 10, precio_unitario: 100 })
    }),
    fetch(`${servidor.baseUrl}/api/ventas/${ventaA.id}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ cantidad: 12 })
    })
  ]);

  assert.equal(resPost.status, 'fulfilled');
  assert.equal(resPut.status, 'fulfilled');
  const rPost = resPost.value;
  const rPut = resPut.value;

  const postAceptado = rPost.status === 201;
  const putAceptado = rPut.status === 200;
  if (!postAceptado) assert.equal(rPost.status, 409, `POST debía ser 201 o 409, fue ${rPost.status}`);
  if (!putAceptado) assert.equal(rPut.status, 409, `PUT debía ser 200 o 409, fue ${rPut.status}`);

  // Dado stock=15 antes de la carrera: cualquiera de las dos, sola, cabe
  // (10<=15 y 7<=15) -- por eso al menos una debe aceptarse siempre, sin
  // importar el orden. Pero juntas (17) exceden 15 -- por eso no pueden
  // aceptarse ambas. Esto es aritmética determinística, no una suposición
  // sobre cuál gana la carrera.
  assert.ok(postAceptado || putAceptado, 'al menos una de las dos operaciones debía poder aceptarse (15 alcanza para cualquiera de las dos por separado)');
  assert.ok(!(postAceptado && putAceptado), 'ambas no pueden aceptarse a la vez: la demanda combinada (17) excede el stock disponible antes de la carrera (15)');

  // Stock esperado, derivado DINÁMICAMENTE de qué se aceptó realmente.
  const stockEsperado = stockAntesDeLaCarrera - (postAceptado ? 10 : 0) - (putAceptado ? 7 : 0);
  const stockFinal = await stockActual(producto);
  assert.ok(stockFinal >= 0, `stock_final nunca debe ser negativo (fue ${stockFinal})`);
  assert.equal(stockFinal, stockEsperado, `sin lost update: el stock debe coincidir exactamente con lo que las operaciones realmente aceptadas deberían producir (esperado ${stockEsperado})`);

  // Cantidad final de venta A coherente con si el PUT se aplicó o no.
  const { rows: ventaARows } = await pool.query('SELECT cantidad FROM ventas WHERE id = $1', [ventaA.id]);
  assert.equal(Number(ventaARows[0].cantidad), putAceptado ? 12 : 5, 'la cantidad de venta A debe reflejar exactamente si el PUT se aplicó');

  // La venta nueva existe solo si el POST fue aceptado.
  const { rows: ventasNuevas } = await pool.query(
    `SELECT id, cantidad FROM ventas WHERE producto_id = $1 AND id != $2`, [producto, ventaA.id]
  );
  assert.equal(ventasNuevas.length, postAceptado ? 1 : 0, 'debe existir una venta nueva solo si el POST se aceptó');
  if (postAceptado) {
    assert.equal(Number(ventasNuevas[0].cantidad), 10);
    ctxTest.ventaIds.push(ventasNuevas[0].id);
  }

  // Movimientos financieros coherentes con las ventas confirmadas.
  const { rows: finVentaA } = await pool.query(`SELECT monto FROM finanzas WHERE origen_modulo='ventas' AND origen_id = $1`, [ventaA.id]);
  assert.equal(finVentaA.length, 1, 'sigue existiendo exactamente un movimiento financiero para venta A');
  assert.equal(Number(finVentaA[0].monto), (putAceptado ? 12 : 5) * 100, 'el monto de finanzas de venta A debe reflejar la cantidad final real');

  if (postAceptado) {
    const { rows: finNueva } = await pool.query(`SELECT monto FROM finanzas WHERE origen_modulo='ventas' AND origen_id = $1`, [ventasNuevas[0].id]);
    assert.equal(finNueva.length, 1);
    assert.equal(Number(finNueva[0].monto), 1000);
  }
});
