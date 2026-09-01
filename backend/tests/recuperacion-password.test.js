// tests/recuperacion-password.test.js
// Suite de regresión — Sub-bloque 2: Recuperación de contraseña
// (/api/auth/forgot-password, /reset-password/validar, /reset-password).
//
// El token real (crudo, no el hash) nunca sale de forgot-password por HTTP
// -- solo viaja por correo, a propósito (ver auth.js). Para probar validar/
// reset de punta a punta se inserta un token conocido directo en la tabla
// password_reset_tokens (mismo criterio que forgot-password usa: sha256 del
// token crudo), igual que el resto de esta suite inserta fixtures directo en
// la base cuando el flujo por HTTP no puede producir el dato que hace falta.
//
// BREVO_API_KEY se fuerza a null para este servidor de test (ver
// servidorTest.js) -- así mailer.js cae en su rama "no_configurado" (loguea
// el link, no llama a la API real de Brevo) en vez de mandar correos reales
// a direcciones @example.invalid.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import { nuevoContexto, crearEmpresa, crearUsuario, limpiarContexto } from './helpers/fixtures.js';
import { poolTest as pool } from './helpers/testDb.js';

let servidor;
const ctx = nuevoContexto();

before(async () => { servidor = await iniciarServidorTest({ BREVO_API_KEY: null }); });
after(async () => {
  await limpiarContexto(ctx);
  await servidor.detener();
  await pool.end();
});

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// Inserta un token de reset directo en la base (bypass de forgot-password,
// que nunca revela el token crudo por HTTP) y devuelve el token crudo.
async function insertarTokenReset(usuarioId, { minutosParaExpirar = 30, usado = false } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + minutosParaExpirar * 60 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO password_reset_tokens (usuario_id, token_hash, expires_at, used_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [usuarioId, sha256(token), expiresAt, usado ? new Date() : null]
  );
  // No se trackea en ctx.limpiarContexto -- password_reset_tokens tiene
  // ON DELETE CASCADE sobre usuario_id (ver migración 030), así que se
  // borra solo cuando limpiarContexto() borra el usuario dueño del token.
  return { token, id: rows[0].id };
}

test('POST /forgot-password: mismo mensaje genérico para email existente e inexistente', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-generico');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });

  const rExistente = await fetch(`${servidor.baseUrl}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email })
  });
  const rInexistente = await fetch(`${servidor.baseUrl}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'qa-test-reset-no-existe@example.invalid' })
  });

  assert.equal(rExistente.status, 200);
  assert.equal(rInexistente.status, 200);
  assert.deepEqual(await rExistente.json(), await rInexistente.json(), 'mismo mensaje exacto exista o no la cuenta -- no debe distinguirse cuál de los dos casos fue');
});

test('POST /forgot-password: crea un token real (hash sha256, 30 min de expiración, sin usar) solo para la cuenta que sí existe', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-token-creado');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });

  const antes = Date.now();
  const r = await fetch(`${servidor.baseUrl}/api/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email })
  });
  assert.equal(r.status, 200);

  const { rows } = await pool.query(
    'SELECT token_hash, expires_at, used_at FROM password_reset_tokens WHERE usuario_id = $1',
    [cuenta.usuarioId]
  );
  assert.equal(rows.length, 1, 'debe crear exactamente un token para esta solicitud');
  const fila = rows[0];
  assert.match(fila.token_hash, /^[0-9a-f]{64}$/, 'token_hash debe ser un sha256 hex de 64 caracteres, nunca el token en claro');
  assert.equal(fila.used_at, null);

  const minutosHastaExpirar = (new Date(fila.expires_at).getTime() - antes) / 60000;
  assert.ok(minutosHastaExpirar > 29 && minutosHastaExpirar < 31, `expires_at debe ser ~30 min desde la solicitud (fue ${minutosHastaExpirar.toFixed(2)} min)`);
});

test('GET /reset-password/validar: válido, inexistente, expirado, usado y vacío -- siempre 200, solo cambia el campo "valido"', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-validar');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const { token: tokenValido } = await insertarTokenReset(cuenta.usuarioId);
  const { token: tokenExpirado } = await insertarTokenReset(cuenta.usuarioId, { minutosParaExpirar: -5 });
  const { token: tokenUsado } = await insertarTokenReset(cuenta.usuarioId, { usado: true });

  const validar = async (token) => {
    const r = await fetch(`${servidor.baseUrl}/api/auth/reset-password/validar?token=${encodeURIComponent(token)}`);
    return { status: r.status, body: await r.json() };
  };

  const rValido = await validar(tokenValido);
  assert.equal(rValido.status, 200);
  assert.equal(rValido.body.valido, true);

  const rInexistente = await validar('token-que-nunca-existio-'.padEnd(64, '0'));
  assert.equal(rInexistente.status, 200);
  assert.equal(rInexistente.body.valido, false);

  const rExpirado = await validar(tokenExpirado);
  assert.equal(rExpirado.status, 200);
  assert.equal(rExpirado.body.valido, false);

  const rUsado = await validar(tokenUsado);
  assert.equal(rUsado.status, 200);
  assert.equal(rUsado.body.valido, false);

  const rVacio = await fetch(`${servidor.baseUrl}/api/auth/reset-password/validar`);
  assert.equal(rVacio.status, 200);
  assert.equal((await rVacio.json()).valido, false);
});

test('POST /reset-password: reseteo exitoso actualiza el hash, invalida el token y permite loguear con la nueva contraseña', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-exitoso');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const { token, id: tokenId } = await insertarTokenReset(cuenta.usuarioId);
  const nuevaPassword = 'NuevaClave2026';

  const r = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: nuevaPassword })
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).mensaje, 'Contraseña actualizada correctamente.');

  const { rows: filasUsuario } = await pool.query('SELECT password_hash FROM usuarios WHERE id = $1', [cuenta.usuarioId]);
  assert.ok(await bcrypt.compare(nuevaPassword, filasUsuario[0].password_hash), 'el hash en la base debe corresponder a la NUEVA contraseña');

  const { rows: filasToken } = await pool.query('SELECT used_at FROM password_reset_tokens WHERE id = $1', [tokenId]);
  assert.notEqual(filasToken[0].used_at, null, 'el token debe quedar marcado como usado, nunca borrado');

  const rLogin = await fetch(`${servidor.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cuenta.email, password: nuevaPassword })
  });
  assert.equal(rLogin.status, 200);
  assert.ok((await rLogin.json()).token, 'debe poder loguear con la contraseña recién establecida');
});

test('POST /reset-password: reusar el mismo token una segunda vez se rechaza (400), con el mismo mensaje que un token inválido', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-reuso');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const { token } = await insertarTokenReset(cuenta.usuarioId);

  const primerUso = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'PrimeraVez2026' })
  });
  assert.equal(primerUso.status, 200);

  const segundoUso = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'SegundaVez2026' })
  });
  assert.equal(segundoUso.status, 400);
  assert.equal((await segundoUso.json()).error, 'Este enlace ya no es válido.');
});

test('POST /reset-password: token inexistente, expirado o ausente se rechaza (400) con el mismo mensaje', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-invalidos');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const { token: tokenExpirado } = await insertarTokenReset(cuenta.usuarioId, { minutosParaExpirar: -5 });

  const intentar = async (body) => {
    const r = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: r.status, body: await r.json() };
  };

  const rInexistente = await intentar({ token: 'token-fantasma-0000', password: 'ClaveValida2026' });
  assert.equal(rInexistente.status, 400);
  assert.equal(rInexistente.body.error, 'Este enlace ya no es válido.');

  const rExpirado = await intentar({ token: tokenExpirado, password: 'ClaveValida2026' });
  assert.equal(rExpirado.status, 400);
  assert.equal(rExpirado.body.error, 'Este enlace ya no es válido.');

  const rSinToken = await intentar({ password: 'ClaveValida2026' });
  assert.equal(rSinToken.status, 400);
  assert.equal(rSinToken.body.error, 'Este enlace ya no es válido.');
});

test('POST /reset-password: contraseña que no cumple la política se rechaza (400) sin consumir el token', async () => {
  const empresa = await crearEmpresa(ctx, 'reset-politica');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa });
  const { token, id: tokenId } = await insertarTokenReset(cuenta.usuarioId);

  const rDebil = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'debil' })
  });
  assert.equal(rDebil.status, 400);
  assert.match((await rDebil.json()).error, /al menos 8 caracteres/i);

  const { rows } = await pool.query('SELECT used_at FROM password_reset_tokens WHERE id = $1', [tokenId]);
  assert.equal(rows[0].used_at, null, 'el token sigue sin usarse -- el rechazo por política ocurre antes de tocar la base');

  // Confirma que el token sigue siendo válido de verdad (no quedó en un
  // estado intermedio raro): un reseteo posterior con una contraseña que sí
  // cumple la política debe funcionar con el MISMO token.
  const rValida = await fetch(`${servidor.baseUrl}/api/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: 'ClaveValida2026' })
  });
  assert.equal(rValida.status, 200);
});
