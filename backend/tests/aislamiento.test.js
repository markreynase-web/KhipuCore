// tests/aislamiento.test.js
// RF-1 (Fase 1): aislamiento horizontal entre empresas.
//
// Cobertura elegida a propósito, no exhaustiva por módulo:
//   - clientes.js: instancia lisa de crudFactory.js, el motor que sirve a
//     ~30 de los 35 módulos del catálogo. Probarlo una vez cubre el mismo
//     camino de código que usan todos los demás módulos genéricos.
//   - ventas.js: router manual con más superficie (valida producto_id Y
//     cliente_id contra la empresa antes de vender).
//   - usuarios.js: router manual de gobernanza, con su propio scoping vía
//     usuario_empresa.
//
// Nota: ni crudFactory.js ni ventas.js exponen GET /:id (solo GET / con
// lista completa). "No puede obtener por ID un registro de otra empresa" se
// prueba entonces por el camino real que sí existe: PUT/DELETE contra ese id
// (que hacen su propio SELECT scoped por empresa_id primero) responden 404,
// y el registro nunca aparece en GET /.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, crearProducto, crearCliente,
  crearMascota, login, limpiarContexto
} from './helpers/fixtures.js';
// Pool de tests, nunca el de producción -- ver tests/helpers/testDb.js.
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

let empresaA, empresaB;
let tokenA;
let productoB, clienteB, usuarioB, ventaB;

before(async () => {
  servidor = await iniciarServidorTest();

  empresaA = await crearEmpresa(ctx, 'A');
  empresaB = await crearEmpresa(ctx, 'B');

  const cuentaA = await crearUsuario(ctx, { empresaId: empresaA });
  tokenA = await login(servidor.baseUrl, cuentaA.email, cuentaA.password);

  const cuentaB = await crearUsuario(ctx, { empresaId: empresaB });
  usuarioB = cuentaB.usuarioId;

  productoB = await crearProducto(ctx, empresaB, { nombre: 'Producto de B', stock: 50, precio_unitario: 100 });
  clienteB = await crearCliente(ctx, empresaB, 'Cliente de B');

  // Se crea acá, en el setup compartido, y no dentro de un test individual
  // a propósito: dos tests distintos (PUT/DELETE de abajo, y "no ve en su
  // lista") necesitan una venta real de B. Si viviera dentro de uno de esos
  // tests, el otro pasaría vacíamente al correrse solo o en otro orden --
  // ver hallazgo de la revisión estática de Fase 1.
  const { rows } = await pool.query(
    `INSERT INTO ventas (fecha, cliente, cliente_id, producto, producto_id, cantidad, precio_unitario, monto, empresa_id)
     VALUES (CURRENT_DATE, 'Cliente de B', $1, 'Producto de B', $2, 1, 100, 100, $3) RETURNING id`,
    [clienteB, productoB, empresaB]
  );
  ventaB = rows[0].id;
  ctx.ventaIds.push(ventaB);
});

after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

function headersA() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
}

// --- clientes.js (representativo de crudFactory) ---

test('crudFactory: A no ve en su lista un cliente de B', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes`, { headers: headersA() });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.ok(!lista.some(c => c.id === clienteB), 'la lista de A no debe incluir un cliente de B');
});

test('crudFactory: A no puede editar (PUT) un cliente de B -> 404, no 403', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes/${clienteB}`, {
    method: 'PUT', headers: headersA(), body: JSON.stringify({ nombre: 'Hackeado' })
  });
  assert.equal(r.status, 404);
});

test('crudFactory: A no puede eliminar (DELETE) un cliente de B -> 404', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes/${clienteB}`, { method: 'DELETE', headers: headersA() });
  assert.equal(r.status, 404);
  const { rows } = await pool.query('SELECT id FROM clientes WHERE id = $1', [clienteB]);
  assert.equal(rows.length, 1, 'el cliente de B debe seguir existiendo intacto');
});

test('crudFactory: empresa_id inyectado en el body de un POST se ignora -- el registro queda en la empresa real del token', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: headersA(),
    body: JSON.stringify({ fecha_registro: '2026-01-15', nombre: 'QA-TEST (borrar) cliente con empresa_id falsificado', empresa_id: empresaB })
  });
  assert.equal(r.status, 201);
  const creado = await r.json();
  ctx.clienteIds.push(creado.id);
  const { rows } = await pool.query('SELECT empresa_id FROM clientes WHERE id = $1', [creado.id]);
  assert.equal(rows[0].empresa_id, empresaA, 'debe quedar en la empresa del token (A), no en la del body (B)');
});

test('crudFactory: empresa_id en el query string de un GET se ignora -- sigue devolviendo solo lo de A', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/clientes?empresa_id=${empresaB}`, { headers: headersA() });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.ok(!lista.some(c => c.id === clienteB), 'el query string no debe poder cambiar de empresa la consulta');
});

test('crudFactory: empresa_id inyectado en el body de un PUT sobre un recurso PROPIO no lo traslada de empresa', async () => {
  const clienteA = await crearCliente(ctx, empresaA, 'Cliente propio de A');
  const r = await fetch(`${servidor.baseUrl}/api/clientes/${clienteA}`, {
    method: 'PUT', headers: headersA(),
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) renombrado', empresa_id: empresaB })
  });
  assert.equal(r.status, 200);
  const { rows } = await pool.query('SELECT empresa_id FROM clientes WHERE id = $1', [clienteA]);
  assert.equal(rows[0].empresa_id, empresaA, 'el registro debe seguir siendo de A pese al empresa_id falsificado en el body');
});

test('crudFactory: no se filtra si un id ajeno "existe en otra empresa" -- mismo 404 y mismo mensaje que un id que no existe en absoluto', async () => {
  const rAjeno = await fetch(`${servidor.baseUrl}/api/clientes/${clienteB}`, {
    method: 'PUT', headers: headersA(), body: JSON.stringify({ nombre: 'x' })
  });
  const rInexistente = await fetch(`${servidor.baseUrl}/api/clientes/999999999`, {
    method: 'PUT', headers: headersA(), body: JSON.stringify({ nombre: 'x' })
  });
  assert.equal(rAjeno.status, rInexistente.status, 'mismo status para "de otra empresa" y "no existe"');
  const [cuerpoAjeno, cuerpoInexistente] = await Promise.all([rAjeno.json(), rInexistente.json()]);
  assert.deepEqual(cuerpoAjeno, cuerpoInexistente, 'mismo mensaje de error -- no debe distinguirse "existe en otro tenant" de "no existe"');
});

// --- ventas.js (router manual) ---

test('ventas: A no puede crear una venta usando un producto_id de B -> 404', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers: headersA(),
    body: JSON.stringify({
      fecha: new Date().toISOString().slice(0, 10),
      producto_id: productoB, cliente_id: clienteB, cantidad: 1, precio_unitario: 100
    })
  });
  assert.equal(r.status, 404);
  const cuerpo = await r.json();
  assert.match(cuerpo.error, /producto/i);
});

test('ventas: A no puede crear una venta usando un cliente_id de B (con producto propio) -> 404', async () => {
  const productoA = await crearProducto(ctx, empresaA, { nombre: 'Producto de A', stock: 50, precio_unitario: 100 });
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers: headersA(),
    body: JSON.stringify({
      fecha: new Date().toISOString().slice(0, 10),
      producto_id: productoA, cliente_id: clienteB, cantidad: 1, precio_unitario: 100
    })
  });
  assert.equal(r.status, 404);
  const cuerpo = await r.json();
  assert.match(cuerpo.error, /cliente/i);
});

test('ventas: A no puede editar (PUT) ni eliminar (DELETE) una venta de B -> 404', async () => {
  const rPut = await fetch(`${servidor.baseUrl}/api/ventas/${ventaB}`, {
    method: 'PUT', headers: headersA(), body: JSON.stringify({ notas: 'hackeado' })
  });
  assert.equal(rPut.status, 404);

  const rDelete = await fetch(`${servidor.baseUrl}/api/ventas/${ventaB}`, { method: 'DELETE', headers: headersA() });
  assert.equal(rDelete.status, 404);
});

test('ventas: A no ve en su lista una venta de B', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/ventas`, { headers: headersA() });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.ok(!lista.some(v => v.empresa_id === empresaB), 'la lista de A no debe incluir ventas de B');
});

// --- usuarios.js (gobernanza) ---

test('usuarios: A no ve en su lista un usuario que solo pertenece a B', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/usuarios`, { headers: headersA() });
  assert.equal(r.status, 200);
  const lista = await r.json();
  assert.ok(!lista.some(u => u.id === usuarioB), 'la lista de A no debe incluir usuarios de B');
});

test('usuarios: A no puede editar (PUT) un usuario de B -> 404', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${usuarioB}`, {
    method: 'PUT', headers: headersA(), body: JSON.stringify({ nombre: 'Hackeado' })
  });
  assert.equal(r.status, 404);
});

test('usuarios: A no puede eliminar (DELETE) la membresía de un usuario de B -> 404', async () => {
  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${usuarioB}`, { method: 'DELETE', headers: headersA() });
  assert.equal(r.status, 404);
  const { rows } = await pool.query(
    'SELECT 1 FROM usuario_empresa WHERE usuario_id = $1 AND empresa_id = $2',
    [usuarioB, empresaB]
  );
  assert.equal(rows.length, 1, 'la membresía de B debe seguir intacta');
});

// --- A1: mascotas.js (Veterinaria) -- híbrido manual (POST/PUT resuelven
// cliente_nombre) + crudFactory genérico (GET/DELETE). Setup propio e
// independiente del resto del archivo, a propósito -- ver el hallazgo de
// la revisión estática sobre dependencias de orden entre tests. ---

test('mascotas.js (híbrido manual+crudFactory): aislamiento horizontal completo', async () => {
  const empA = await crearEmpresa(ctx, 'mascotas-A', ['mascotas', 'clientes']);
  const empB = await crearEmpresa(ctx, 'mascotas-B', ['mascotas', 'clientes']);
  const cuentaA = await crearUsuario(ctx, { empresaId: empA });
  const token = await login(servidor.baseUrl, cuentaA.email, cuentaA.password);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const clienteA = await crearCliente(ctx, empA, 'Dueño A');
  const clienteB = await crearCliente(ctx, empB, 'Dueño B');

  // 1. Empresa A crea mascota A vía HTTP real.
  const rCrear = await fetch(`${servidor.baseUrl}/api/mascotas`, {
    method: 'POST', headers,
    body: JSON.stringify({ cliente_id: clienteA, nombre: 'QA-TEST (borrar) Mascota A', especie: 'gato' })
  });
  assert.equal(rCrear.status, 201);
  const mascotaA = (await rCrear.json()).id;
  ctx.mascotaIds.push(mascotaA);

  // 2. Empresa B crea mascota B (fixture, sin necesitar sesión de B).
  const mascotaB = await crearMascota(ctx, empB, clienteB, 'Mascota B');

  // 3. A no ve mascota B en su lista.
  const rLista = await fetch(`${servidor.baseUrl}/api/mascotas`, { headers });
  assert.equal(rLista.status, 200);
  assert.ok(!(await rLista.json()).some(m => m.id === mascotaB));

  // 4. GET individual: no aplica -- mascotas.js (crudFactory) no expone
  // GET /:id, mismo caso que clientes.js/ventas.js en la ronda anterior.

  // 5. A no puede editar (PUT) mascota B.
  const rPut = await fetch(`${servidor.baseUrl}/api/mascotas/${mascotaB}`, {
    method: 'PUT', headers, body: JSON.stringify({ nombre: 'Hackeada' })
  });
  assert.equal(rPut.status, 404);

  // 6. A no puede eliminar (DELETE) mascota B.
  const rDelete = await fetch(`${servidor.baseUrl}/api/mascotas/${mascotaB}`, { method: 'DELETE', headers });
  assert.equal(rDelete.status, 404);

  // 7. Verificación directa en PostgreSQL: B sigue intacta.
  const { rows } = await pool.query('SELECT empresa_id FROM mascotas WHERE id = $1', [mascotaB]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].empresa_id, empB);

  // 8. empresa_id falsificado en el body de un PUT sobre un recurso PROPIO
  // -- mascotas.js ni siquiera lo destructura de req.body, así que esto
  // también prueba que un campo no reconocido no rompe nada.
  const rTamper = await fetch(`${servidor.baseUrl}/api/mascotas/${mascotaA}`, {
    method: 'PUT', headers, body: JSON.stringify({ nombre: 'QA-TEST (borrar) renombrada', empresa_id: empB })
  });
  assert.equal(rTamper.status, 200);
  const { rows: rowsA } = await pool.query('SELECT empresa_id FROM mascotas WHERE id = $1', [mascotaA]);
  assert.equal(rowsA[0].empresa_id, empA, 'mascota A debe seguir en la empresa del token, no en la del body');
});

// --- A1: flota.js (Transporte) -- híbrido manual (solo validación de enum,
// sin relación con otra entidad) + crudFactory genérico. ---

test('flota.js (híbrido manual+crudFactory, validación de enum): aislamiento horizontal completo', async () => {
  const empA = await crearEmpresa(ctx, 'flota-A', ['flota']);
  const empB = await crearEmpresa(ctx, 'flota-B', ['flota']);
  const cuentaA = await crearUsuario(ctx, { empresaId: empA });
  const token = await login(servidor.baseUrl, cuentaA.email, cuentaA.password);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 1. Empresa A crea su unidad vía HTTP real.
  const rCrear = await fetch(`${servidor.baseUrl}/api/flota`, {
    method: 'POST', headers,
    body: JSON.stringify({ placa: 'QAT-A01', marca: 'QA-TEST (borrar)', modelo: 'Modelo A' })
  });
  assert.equal(rCrear.status, 201);
  const unidadA = (await rCrear.json()).id;
  ctx.flotaIds.push(unidadA);

  // 2. Empresa B crea su unidad (inserción directa).
  const { rows: insertB } = await pool.query(
    `INSERT INTO flota (placa, marca, modelo, empresa_id) VALUES ('QAT-B01', 'QA-TEST (borrar)', 'Modelo B', $1) RETURNING id`,
    [empB]
  );
  const unidadB = insertB[0].id;
  ctx.flotaIds.push(unidadB);

  // 3. A no ve la unidad de B en su lista.
  const rLista = await fetch(`${servidor.baseUrl}/api/flota`, { headers });
  assert.equal(rLista.status, 200);
  assert.ok(!(await rLista.json()).some(u => u.id === unidadB));

  // 4. GET individual: no aplica, mismo motivo que en mascotas.js.

  // 5. A no puede editar la unidad de B.
  const rPut = await fetch(`${servidor.baseUrl}/api/flota/${unidadB}`, {
    method: 'PUT', headers, body: JSON.stringify({ marca: 'Hackeada' })
  });
  assert.equal(rPut.status, 404);

  // 6. A no puede eliminar la unidad de B.
  const rDelete = await fetch(`${servidor.baseUrl}/api/flota/${unidadB}`, { method: 'DELETE', headers });
  assert.equal(rDelete.status, 404);

  // 7. Verificación directa en PostgreSQL: B sigue intacta.
  const { rows } = await pool.query('SELECT empresa_id FROM flota WHERE id = $1', [unidadB]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].empresa_id, empB);

  // 8. empresa_id falsificado en el body de un PUT sobre un recurso propio.
  const rTamper = await fetch(`${servidor.baseUrl}/api/flota/${unidadA}`, {
    method: 'PUT', headers, body: JSON.stringify({ marca: 'QA-TEST (borrar) renombrada', empresa_id: empB })
  });
  assert.equal(rTamper.status, 200);
  const { rows: rowsA } = await pool.query('SELECT empresa_id FROM flota WHERE id = $1', [unidadA]);
  assert.equal(rowsA[0].empresa_id, empA, 'la unidad de A debe seguir en la empresa del token, no en la del body');
});

// --- A2: relación cruzada entre tenants -- atencionesVeterinarias.js valida
// mascota_id contra `mascotas WHERE id=$1 AND empresa_id=$2`, mismo patrón
// que producto_id/cliente_id en ventas.js pero en otra vertical/módulo. ---

test('atencionesVeterinarias.js: A no puede crear una atención usando el mascota_id de B -> 404, sin efectos parciales', async () => {
  const empA = await crearEmpresa(ctx, 'atencion-A', ['atenciones_veterinarias', 'mascotas', 'clientes']);
  const empB = await crearEmpresa(ctx, 'atencion-B', ['atenciones_veterinarias', 'mascotas', 'clientes']);
  const cuentaA = await crearUsuario(ctx, { empresaId: empA });
  const token = await login(servidor.baseUrl, cuentaA.email, cuentaA.password);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const clienteB = await crearCliente(ctx, empB, 'Dueño B');
  const mascotaB = await crearMascota(ctx, empB, clienteB, 'Mascota de B');

  const r = await fetch(`${servidor.baseUrl}/api/atenciones_veterinarias`, {
    method: 'POST', headers,
    body: JSON.stringify({ fecha: '2026-01-15', mascota_id: mascotaB, procedimiento: 'Vacuna QA-TEST' })
  });
  assert.equal(r.status, 404);
  assert.match((await r.json()).error, /mascota/i);

  const { rows: atenciones } = await pool.query('SELECT id FROM atenciones_veterinarias WHERE mascota_id = $1', [mascotaB]);
  assert.equal(atenciones.length, 0, 'no debe haberse creado ninguna atención con la mascota de B');

  const { rows: mascotaRows } = await pool.query('SELECT empresa_id FROM mascotas WHERE id = $1', [mascotaB]);
  assert.equal(mascotaRows.length, 1, 'la mascota de B debe seguir intacta');
  assert.equal(mascotaRows[0].empresa_id, empB);
});
