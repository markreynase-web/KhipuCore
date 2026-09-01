// tests/impersonacion.test.js
// Suite de regresión — Sub-bloque 3: Impersonación
// (POST /api/superadmin/empresas/:id/impersonar).
//
// fixtures.js no tiene helper para crear una cuenta de super admin (es un
// caso especial, sin usuario_empresa) -- se inserta directo acá, siguiendo
// el mismo criterio que el resto de esta suite: fixtures puntuales cuando
// el helper compartido no cubre el escenario.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, limpiarContexto, PASSWORD_QA } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

// Reintenta una consulta hasta que devuelva al menos una fila o se agote el
// margen -- necesario para leer filas de audit_log escritas por una llamada
// fire-and-forget (ver el comentario en el test de auditoría, más abajo).
async function esperarFilaAuditLog(consulta, params, { intentos = 20, esperaMs = 100 } = {}) {
  for (let i = 0; i < intentos; i++) {
    const { rows } = await pool.query(consulta, params);
    if (rows.length) return rows;
    await new Promise((resolve) => setTimeout(resolve, esperaMs));
  }
  return [];
}

before(async () => { servidor = await iniciarServidorTest({ BREVO_API_KEY: null }); });
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

// Inserta una cuenta de super admin real (es_super_admin=true, sin ninguna
// fila en usuario_empresa -- así es como existen de verdad, ver
// 015_super_admin.sql) y loguea vía HTTP para obtener su token real, igual
// que se hace con cualquier otra cuenta en esta suite.
async function crearSuperAdmin() {
  const email = `qa-test-superadmin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@example.invalid`;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo, es_super_admin)
     VALUES ('QA-TEST (borrar) superadmin', $1, $2, true, true) RETURNING id`,
    [email, hash]
  );
  ctx.usuarioIds.push(rows[0].id);

  const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD_QA })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Login de super admin de prueba falló (${r.status}): ${JSON.stringify(body)}`);
  return { usuarioId: rows[0].id, email, token: body.token };
}

test('control de acceso: solo una cuenta de super admin puede impersonar', async () => {
  const empresaObjetivo = await crearEmpresa(ctx, 'imperso-acceso');
  const empresaAdmin = await crearEmpresa(ctx, 'imperso-acceso-admin');
  const cuentaAdmin = await crearUsuario(ctx, { empresaId: empresaAdmin });
  const rLogin = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuentaAdmin.email, password: cuentaAdmin.password })
  });
  const tokenAdmin = (await rLogin.json()).token;

  const rSinToken = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaObjetivo}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo: 'Soporte QA' })
  });
  assert.equal(rSinToken.status, 401);

  const rAdminRegular = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaObjetivo}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}` },
    body: JSON.stringify({ motivo: 'Soporte QA' })
  });
  assert.equal(rAdminRegular.status, 403);
  assert.match((await rAdminRegular.json()).error, /super administrador/i);
});

test('super admin impersona una empresa activa: 200 y el JWT devuelto cumple las propiedades exactas de una sesión de soporte', async () => {
  const superAdmin = await crearSuperAdmin();
  const empresaObjetivo = await crearEmpresa(ctx, 'imperso-payload');

  const r = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaObjetivo}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin.token}` },
    body: JSON.stringify({ motivo: 'Revisión de un ticket de soporte QA' })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.token);

  const decodificado = jwt.verify(body.token, process.env.JWT_SECRET);
  assert.equal(decodificado.impersonando, true);
  assert.equal(decodificado.empresa_id, empresaObjetivo);
  // El JWT lleva la identidad REAL del super admin -- nunca la de nadie de
  // la empresa objetivo (no existe un campo separado "usuario_id": el super
  // admin ocupa el mismo campo "id" que cualquier sesión normal).
  assert.equal(decodificado.id, superAdmin.usuarioId);
  assert.equal(decodificado.rol, 'administrador');
  assert.ok(Array.isArray(decodificado.permisos) && decodificado.permisos.length > 0);

  const duracionSegundos = decodificado.exp - decodificado.iat;
  assert.equal(duracionSegundos, 1800, 'la sesión de impersonación debe durar exactamente 30 minutos, contra las 8h de una sesión normal');
});

test('empresa inexistente, inactiva o sin motivo: rechazadas sin emitir ningún token', async () => {
  const superAdmin = await crearSuperAdmin();
  const empresaInactiva = await crearEmpresa(ctx, 'imperso-inactiva');
  await pool.query('UPDATE empresas SET activo = false WHERE id = $1', [empresaInactiva]);

  const intentar = async (empresaId, body) => {
    const r = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaId}/impersonar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin.token}` },
      body: JSON.stringify(body)
    });
    return { status: r.status, body: await r.json() };
  };

  const rInexistente = await intentar(999999999, { motivo: 'Soporte QA' });
  assert.equal(rInexistente.status, 404);

  const rInactiva = await intentar(empresaInactiva, { motivo: 'Soporte QA' });
  assert.equal(rInactiva.status, 400);
  assert.match(rInactiva.body.error, /desactivada/i);

  const empresaActiva = await crearEmpresa(ctx, 'imperso-sin-motivo');
  const rSinMotivo = await intentar(empresaActiva, {});
  assert.equal(rSinMotivo.status, 400);
  assert.match(rSinMotivo.body.error, /motivo/i);
});

test('el token impersonado accede al tenant objetivo (200) pero sigue bloqueado para acciones exclusivas de super admin (403)', async () => {
  const superAdmin = await crearSuperAdmin();
  const empresaObjetivo = await crearEmpresa(ctx, 'imperso-uso');

  const rImpersonar = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaObjetivo}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin.token}` },
    body: JSON.stringify({ motivo: 'Uso del token impersonado QA' })
  });
  const tokenImpersonado = (await rImpersonar.json()).token;

  const rGet = await fetch(`${servidor.baseUrl}/api/clientes`, { headers: { Authorization: `Bearer ${tokenImpersonado}` } });
  assert.equal(rGet.status, 200);
  assert.deepEqual(await rGet.json(), []);

  const rPost = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenImpersonado}` },
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) cliente vía impersonación' })
  });
  assert.equal(rPost.status, 201);
  const clienteCreado = await rPost.json();
  assert.equal(clienteCreado.empresa_id, empresaObjetivo, 'el registro debe quedar en la empresa impersonada, tomada del token, nunca de un valor del body');
  ctx.clienteIds.push(clienteCreado.id);

  const rCrearEmpresaComoSoporte = await fetch(`${servidor.baseUrl}/api/superadmin/empresas`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenImpersonado}` },
    body: JSON.stringify({ nombre: 'QA-TEST (borrar) empresa creada indebidamente vía impersonación' })
  });
  assert.equal(rCrearEmpresaComoSoporte.status, 403, 'una sesión impersonada NUNCA debe poder ejercer privilegios globales de super admin, aunque el JWT siga siendo válido');
});

test('auditoría: el propio impersonar() queda registrado bajo la empresa objetivo, y las acciones hechas con el token quedan marcadas via_impersonacion', async () => {
  const superAdmin = await crearSuperAdmin();
  const empresaObjetivo = await crearEmpresa(ctx, 'imperso-auditoria');

  const rImpersonar = await fetch(`${servidor.baseUrl}/api/superadmin/empresas/${empresaObjetivo}/impersonar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superAdmin.token}` },
    body: JSON.stringify({ motivo: 'Auditoría QA del acceso de soporte' })
  });
  const tokenImpersonado = (await rImpersonar.json()).token;

  const { rows: filasImpersonar } = await pool.query(
    `SELECT usuario_id, accion, empresa_id, via_impersonacion, detalle FROM audit_log
     WHERE empresa_id = $1 AND accion = 'impersonar' ORDER BY id DESC LIMIT 1`,
    [empresaObjetivo]
  );
  assert.equal(filasImpersonar.length, 1);
  assert.equal(filasImpersonar[0].usuario_id, superAdmin.usuarioId);
  assert.equal(filasImpersonar[0].via_impersonacion, false, 'la LLAMADA a impersonar la hace la sesión real del super admin, no una ya impersonada');
  assert.equal(filasImpersonar[0].detalle.motivo, 'Auditoría QA del acceso de soporte');

  const rPost = await fetch(`${servidor.baseUrl}/api/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenImpersonado}` },
    body: JSON.stringify({ fecha_registro: '2026-01-01', nombre: 'QA-TEST (borrar) cliente para auditoría' })
  });
  const clienteCreado = await rPost.json();
  ctx.clienteIds.push(clienteCreado.id);

  // A diferencia de POST /impersonar (que hace `await registrarAuditoria(...)`
  // antes de responder), crudFactory.js llama a registrarAuditoria() SIN
  // await, después de responder -- fire-and-forget, a propósito, para no
  // demorar la respuesta al usuario por culpa de la auditoría. Consultar
  // audit_log apenas llega la respuesta HTTP es, por diseño, una carrera:
  // hay que reintentar con un margen corto en vez de asumir que ya escribió.
  const filasCrear = await esperarFilaAuditLog(
    `SELECT usuario_id, accion, modulo, empresa_id, via_impersonacion FROM audit_log
     WHERE empresa_id = $1 AND accion = 'crear' AND modulo = 'clientes' ORDER BY id DESC LIMIT 1`,
    [empresaObjetivo]
  );
  assert.equal(filasCrear.length, 1, 'la fila de auditoría del crudFactory (fire-and-forget) debe aparecer dentro de la ventana de reintento');
  assert.equal(filasCrear[0].usuario_id, superAdmin.usuarioId, 'la acción quedó a nombre del super admin real, nunca de un usuario de la empresa');
  assert.equal(filasCrear[0].via_impersonacion, true, 'toda acción tomada CON el token impersonado debe quedar marcada como tal');
});
