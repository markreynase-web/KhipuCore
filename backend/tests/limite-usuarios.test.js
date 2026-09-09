// tests/limite-usuarios.test.js
// Nivel 1 (Urgente) del roadmap competitivo: límite de usuarios por plan,
// aplicado de verdad en POST /api/usuarios. Sin plan asignado (plan_id
// null) o con limite_usuarios null, el comportamiento debe ser IDÉNTICO
// al de antes de esta migración -- se prueba primero, para no romper a
// ninguna empresa existente.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, login, limpiarContexto, PASSWORD_QA } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

before(async () => { servidor = await iniciarServidorTest(); });
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

async function crearUsuarioViaApi(baseUrl, token, { nombre, email, rol = 'ventas' }) {
  return fetch(`${baseUrl}/api/usuarios`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ nombre, email, password: PASSWORD_QA, rol })
  });
}

test('empresa sin plan asignado (plan_id null): sin límite, comportamiento idéntico al de siempre', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-sin-plan');
  const admin = await crearUsuario(ctx, { empresaId });
  const token = await login(servidor.baseUrl, admin.email, admin.password);

  for (let i = 0; i < 4; i++) {
    const r = await crearUsuarioViaApi(servidor.baseUrl, token, {
      nombre: `Usuario ${i}`, email: `qa-test-sinplan-${Date.now()}-${i}@example.invalid`
    });
    assert.equal(r.status, 201, `usuario ${i} debería crearse sin restricción`);
    ctx.usuarioIds.push((await r.json()).id);
  }
});

test('plan Básico (límite 4): el 5to usuario activo se rechaza con 403, sin crear nada', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-basico');
  const { rows: planRows } = await pool.query(`SELECT id FROM planes WHERE nombre = 'Básico'`);
  await pool.query('UPDATE empresas SET plan_id = $1 WHERE id = $2', [planRows[0].id, empresaId]);

  // El propio admin ya ocupa 1 cupo de los 4 -- se crean 3 más para llegar
  // exacto al límite, y el 5to (el intento número 4 después del admin) debe
  // rechazarse.
  const admin = await crearUsuario(ctx, { empresaId });
  const token = await login(servidor.baseUrl, admin.email, admin.password);

  const r2 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 2', email: `qa-test-basico-${Date.now()}-2@example.invalid` });
  assert.equal(r2.status, 201);
  ctx.usuarioIds.push((await r2.json()).id);

  const r3 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 3', email: `qa-test-basico-${Date.now()}-3@example.invalid` });
  assert.equal(r3.status, 201);
  ctx.usuarioIds.push((await r3.json()).id);

  const r4 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 4', email: `qa-test-basico-${Date.now()}-4@example.invalid` });
  assert.equal(r4.status, 201);
  ctx.usuarioIds.push((await r4.json()).id);

  // Ya hay 4 membresías activas (admin + 3) -- el plan Básico tiene límite 4.
  const r5 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 5', email: `qa-test-basico-${Date.now()}-5@example.invalid` });
  assert.equal(r5.status, 403);
  assert.match((await r5.json()).error, /límite de 4 usuario/i);

  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM usuario_empresa WHERE empresa_id = $1', [empresaId]);
  assert.equal(countRows[0].n, 4, 'el intento rechazado no debe haber creado ninguna fila');
});

test('desactivar una membresía libera un cupo para invitar a otra persona', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-libera-cupo');
  const { rows: planRows } = await pool.query(`SELECT id FROM planes WHERE nombre = 'Básico'`);
  await pool.query('UPDATE empresas SET plan_id = $1 WHERE id = $2', [planRows[0].id, empresaId]);

  const admin = await crearUsuario(ctx, { empresaId });
  const token = await login(servidor.baseUrl, admin.email, admin.password);

  const r2 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 2', email: `qa-test-libera-${Date.now()}-2@example.invalid` });
  const usuario2 = await r2.json();
  ctx.usuarioIds.push(usuario2.id);
  const r3 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 3', email: `qa-test-libera-${Date.now()}-3@example.invalid` });
  ctx.usuarioIds.push((await r3.json()).id);
  const r4 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 4', email: `qa-test-libera-${Date.now()}-4@example.invalid` });
  ctx.usuarioIds.push((await r4.json()).id);

  // Al límite (4/4) -- confirmar que efectivamente rechaza antes de liberar cupo.
  const rBloqueado = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 5 (bloqueado)', email: `qa-test-libera-${Date.now()}-5@example.invalid` });
  assert.equal(rBloqueado.status, 403);

  // Desactivar la membresía de "Usuario 2" -- libera un cupo.
  const rDesactivar = await fetch(`${servidor.baseUrl}/api/usuarios/${usuario2.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ activo: false })
  });
  assert.equal(rDesactivar.status, 200);

  const rNuevo = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 6', email: `qa-test-libera-${Date.now()}-6@example.invalid` });
  assert.equal(rNuevo.status, 201, 'con un cupo liberado, debe poder crear uno nuevo');
  ctx.usuarioIds.push((await rNuevo.json()).id);
});

test('concurrencia: varias invitaciones simultáneas justo en el límite nunca lo superan', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-concurrencia');
  const { rows: planRows } = await pool.query(`SELECT id FROM planes WHERE nombre = 'Básico'`);
  await pool.query('UPDATE empresas SET plan_id = $1 WHERE id = $2', [planRows[0].id, empresaId]);

  const admin = await crearUsuario(ctx, { empresaId });
  const token = await login(servidor.baseUrl, admin.email, admin.password);

  // Admin ocupa 1 de los 4 cupos -- se crean 2 más de a uno, dejando
  // EXACTAMENTE 1 cupo libre antes de la ráfaga concurrente.
  const r2 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 2', email: `qa-test-concurrencia-${Date.now()}-2@example.invalid` });
  ctx.usuarioIds.push((await r2.json()).id);
  const r3 = await crearUsuarioViaApi(servidor.baseUrl, token, { nombre: 'Usuario 3', email: `qa-test-concurrencia-${Date.now()}-3@example.invalid` });
  ctx.usuarioIds.push((await r3.json()).id);

  // 3 solicitudes a la vez por el ÚLTIMO cupo -- sin el lock FOR UPDATE,
  // las 3 podrían leer el mismo conteo "3 de 4" antes de que cualquiera
  // insertara, y las 3 pasarían la validación.
  const resultados = await Promise.allSettled(
    Array.from({ length: 3 }, (_, i) =>
      crearUsuarioViaApi(servidor.baseUrl, token, { nombre: `Concurrente ${i}`, email: `qa-test-concurrencia-${Date.now()}-race-${i}@example.invalid` })
    )
  );

  const statuses = [];
  for (const r of resultados) {
    if (r.status !== 'fulfilled') { statuses.push('error'); continue; }
    statuses.push(r.value.status);
    if (r.value.status === 201) ctx.usuarioIds.push((await r.value.json()).id);
  }

  assert.equal(statuses.filter(s => s === 201).length, 1, `exactamente 1 de las 3 debe ganar el último cupo (statuses: ${statuses})`);
  assert.equal(statuses.filter(s => s === 403).length, 2, `las otras 2 deben rechazarse por límite (statuses: ${statuses})`);

  // La verdad final está en la base, no en las respuestas HTTP.
  const { rows: countRows } = await pool.query('SELECT count(*)::int AS n FROM usuario_empresa WHERE empresa_id = $1 AND activo = true', [empresaId]);
  assert.equal(countRows[0].n, 4, 'el límite del plan Básico (4) nunca debe superarse, ni bajo concurrencia');
});

test('super admin: PUT /api/superadmin/empresas/:id asigna y desasigna plan_id', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-superadmin');
  const superAdminEmail = `qa-test-superadmin-${Date.now()}@example.invalid`;
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows: suRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo, es_super_admin) VALUES ('QA-TEST (borrar) superadmin', $1, $2, true, true) RETURNING id`,
    [superAdminEmail, hash]
  );
  ctx.usuarioIds.push(suRows[0].id);
  const superToken = await login(servidor.baseUrl, superAdminEmail, PASSWORD_QA);

  const { rows: planRows } = await pool.query(`SELECT id FROM planes WHERE nombre = 'Profesional'`);
  const rAsignar = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: planRows[0].id })
  });
  assert.equal(rAsignar.status, 200);
  assert.equal((await rAsignar.json()).plan_id, planRows[0].id);

  const rDesasignar = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: null })
  });
  assert.equal(rDesasignar.status, 200);
  assert.equal((await rDesasignar.json()).plan_id, null);

  const rInexistente = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: 999999 })
  });
  assert.equal(rInexistente.status, 400);
});

// Regresión: la primera versión de esta validación hacía `await pool.query`
// FUERA del try/catch -- un plan_id no numérico habría quedado como una
// promesa rechazada sin capturar en un handler async de Express 4, y sin
// ningún process.on('unhandledRejection', ...) en server.js, Node tumba el
// proceso ENTERO por default (hallazgo real de la revisión antes de
// commitear, no un caso hipotético). Este test prueba, con el servidor real
// corriendo, que un plan_id malformado devuelve 400 -- y que el servidor
// SIGUE VIVO después (el healthcheck de la siguiente línea es el que de
// verdad confirma que no crasheó).
test('PUT /api/superadmin/empresas/:id: un plan_id no numérico se rechaza con 400, sin tumbar el servidor', async () => {
  const empresaId = await crearEmpresa(ctx, 'limite-plan-malformado');
  const superAdminEmail = `qa-test-superadmin-malformado-${Date.now()}@example.invalid`;
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows: suRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo, es_super_admin) VALUES ('QA-TEST (borrar) superadmin malformado', $1, $2, true, true) RETURNING id`,
    [superAdminEmail, hash]
  );
  ctx.usuarioIds.push(suRows[0].id);
  const superToken = await login(servidor.baseUrl, superAdminEmail, PASSWORD_QA);

  const rTexto = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: 'abc' })
  });
  assert.equal(rTexto.status, 400);

  const rObjeto = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: { foo: 'bar' } })
  });
  assert.equal(rObjeto.status, 400);

  const rDecimal = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({ plan_id: 1.5 })
  });
  assert.equal(rDecimal.status, 400);

  // El servidor sigue respondiendo con normalidad después de los 3 intentos.
  const rSalud = await fetch(`${servidor.baseUrl}/api/salud`);
  assert.equal(rSalud.status, 200);
});

test('GET /api/superadmin/planes: devuelve el catálogo de 3 planes sembrados', async () => {
  const superAdminEmail = `qa-test-superadmin-planes-${Date.now()}@example.invalid`;
  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows: suRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo, es_super_admin) VALUES ('QA-TEST (borrar) superadmin planes', $1, $2, true, true) RETURNING id`,
    [superAdminEmail, hash]
  );
  ctx.usuarioIds.push(suRows[0].id);
  const superToken = await login(servidor.baseUrl, superAdminEmail, PASSWORD_QA);

  const r = await fetch(`${servidor.baseUrl}/api/superadmin/planes`, { headers: { Authorization: `Bearer ${superToken}` } });
  assert.equal(r.status, 200);
  const planes = await r.json();
  const nombres = planes.map(p => p.nombre).sort();
  assert.deepEqual(nombres, ['Básico', 'Empresarial', 'Profesional']);
});
