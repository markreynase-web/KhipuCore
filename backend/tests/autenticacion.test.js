// tests/autenticacion.test.js
// Suite de regresión — Sub-bloque 1: Autenticación (/api/auth/*). Hasta
// ahora, los 36 tests de Fase 1 usaban login() como plumbing para conseguir
// un token y probar OTRA cosa -- acá el propio login/login-empresa/me es el
// objeto de la prueba. Mismo guardia fail-closed heredado de testDb.js vía
// fixtures.js, misma base de testing separada.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, login, limpiarContexto, PASSWORD_QA
} from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

before(async () => { servidor = await iniciarServidorTest(); });
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

// --- Flujo de usuario único ---

test('login exitoso con una sola empresa: token completo con empresa_id y permisos', async () => {
  const empresa = await crearEmpresa(ctx, 'auth-unica');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });

  const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: cuenta.password })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.token, 'debe devolver un token completo, no un preAuthToken');
  assert.equal(body.usuario.empresa_id, empresa);
  assert.equal(body.usuario.rol, 'administrador');
  assert.ok(Array.isArray(body.usuario.permisos) && body.usuario.permisos.length > 0);
});

// --- Flujo multiempresa ---

test('login con más de una empresa: requiereSeleccionEmpresa + preAuthToken, nunca un token completo', async () => {
  const empresaA = await crearEmpresa(ctx, 'auth-multi-A');
  const empresaB = await crearEmpresa(ctx, 'auth-multi-B');
  const cuenta = await crearUsuario(ctx, { empresaId: empresaA });
  // Vincula la MISMA identidad a una segunda empresa -- fixtures.js no
  // tiene un helper para esto (crearUsuario siempre crea una identidad
  // nueva), se hace la inserción directa acá, puntual para este test.
  const { rows: rolRows } = await pool.query(`SELECT id FROM roles WHERE nombre='administrador'`);
  await pool.query(
    `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES ($1,$2,$3,true)`,
    [cuenta.usuarioId, empresaB, rolRows[0].id]
  );

  const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: cuenta.password })
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.requiereSeleccionEmpresa, true);
  assert.ok(body.preAuthToken, 'debe traer un preAuthToken');
  assert.equal(body.token, undefined, 'NUNCA debe traer un token completo en este paso');
  assert.equal(body.empresas.length, 2);

  // POST /login/empresa con el preAuthToken -> token final de la empresa elegida
  const rElegir = await fetch(`${servidor.baseUrl}/api/auth/login/empresa`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preAuthToken: body.preAuthToken, empresa_id: empresaB })
  });
  assert.equal(rElegir.status, 200);
  const bodyElegir = await rElegir.json();
  assert.ok(bodyElegir.token);
  assert.equal(bodyElegir.usuario.empresa_id, empresaB);
});

test('POST /login/empresa: elegir una empresa a la que el usuario NO pertenece -> 403 (revalidado server-side)', async () => {
  const empresaPropia = await crearEmpresa(ctx, 'auth-revalidacion-propia');
  const empresaAjena = await crearEmpresa(ctx, 'auth-revalidacion-ajena');
  const cuenta = await crearUsuario(ctx, { empresaId: empresaPropia });

  // preAuthToken real (mismo login), no fabricado a mano -- el usuario
  // pertenece a UNA sola empresa acá, pero eso no importa para este test:
  // lo que se prueba es que el body puede pedir cualquier empresa_id y el
  // servidor lo revalida igual, sin confiar en lo que mande el cliente.
  const rLogin = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: cuenta.password })
  });
  // Con una sola empresa, /login ya devuelve el token completo -- para
  // forzar el paso de selección hace falta un preAuthToken real, así que
  // se firma acá con el mismo JWT_SECRET (mismo patrón ya usado en
  // autorizacion.test.js para probar defensa en profundidad).
  const preAuthToken = jwt.sign({ id: (await rLogin.json()).usuario.id, tipo: 'preauth' }, process.env.JWT_SECRET, { expiresIn: '5m' });

  const r = await fetch(`${servidor.baseUrl}/api/auth/login/empresa`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preAuthToken, empresa_id: empresaAjena })
  });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /no perteneces/i);
});

// --- Seguridad y casos borde ---

test('mensaje genérico idéntico para usuario inexistente y para contraseña incorrecta', async () => {
  const empresa = await crearEmpresa(ctx, 'auth-generico');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });

  const rInexistente = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'qa-test-no-existe@example.invalid', password: 'cualquiera123' })
  });
  const rPasswordMal = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: 'password-incorrecta-a-proposito' })
  });
  assert.equal(rInexistente.status, 401);
  assert.equal(rPasswordMal.status, 401);
  assert.deepEqual(await rInexistente.json(), await rPasswordMal.json(), 'mismo mensaje exacto en ambos casos -- no debe distinguirse cuál de las dos cosas falló');
});

test('usuario inactivo (identidad global) no puede loguearse -- mismo mensaje genérico', async () => {
  const empresa = await crearEmpresa(ctx, 'auth-usuario-inactivo');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  await pool.query('UPDATE usuarios SET activo = false WHERE id = $1', [cuenta.usuarioId]);

  const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: cuenta.password })
  });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /email o contraseña incorrectos/i);
});

test('empresa inactiva: usuario sin ninguna membresía activa recibe un mensaje DISTINTO al genérico', async () => {
  const empresa = await crearEmpresa(ctx, 'auth-empresa-inactiva');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  await pool.query('UPDATE empresas SET activo = false WHERE id = $1', [empresa]);

  const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: cuenta.password })
  });
  assert.equal(r.status, 401);
  assert.match((await r.json()).error, /no está asociado a ninguna empresa activa/i);
});

test('rate limiting: el 6to intento fallido consecutivo sobre el mismo email responde 429', async () => {
  const emailDedicado = 'qa-test-rate-limit-auth@example.invalid';
  const intentos = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${servidor.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailDedicado, password: 'no-importa' })
    });
    intentos.push(r.status);
  }
  assert.deepEqual(intentos.slice(0, 5), [401, 401, 401, 401, 401], 'los primeros 5 deben fallar por credenciales, no por rate limit');
  assert.equal(intentos[5], 429, 'el 6to debe ser bloqueado por rate limit');
});

test('GET /me: token válido responde 200; token manipulado o expirado responde 401', async () => {
  const empresa = await crearEmpresa(ctx, 'auth-me');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const token = await login(servidor.baseUrl, cuenta.email, cuenta.password);

  const rValido = await fetch(`${servidor.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(rValido.status, 200);
  assert.equal((await rValido.json()).usuario.email, cuenta.email);

  const tokenManipulado = token.slice(0, -3) + 'xxx';
  const rManipulado = await fetch(`${servidor.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenManipulado}` } });
  assert.equal(rManipulado.status, 401);

  const tokenExpirado = jwt.sign({ id: cuenta.usuarioId, tipo: 'test' }, process.env.JWT_SECRET, { expiresIn: '-10s' });
  const rExpirado = await fetch(`${servidor.baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${tokenExpirado}` } });
  assert.equal(rExpirado.status, 401);

  const rSinToken = await fetch(`${servidor.baseUrl}/api/auth/me`);
  assert.equal(rSinToken.status, 401);
});
