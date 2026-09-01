// tests/autorizacion.test.js
// RF-3 (Fase 1): autorización y gobernanza. Cada test deja explícito, en su
// nombre y comentario, si prueba una regla de seguridad, una regla de
// negocio, o un trade-off de diseño ya aceptado (nunca los mezcla).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { iniciarServidorTest } from './helpers/servidorTest.js';
import {
  nuevoContexto, crearEmpresa, crearUsuario, login, limpiarContexto
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

function headersCon(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

// --- Seguridad: nadie cambia su propio rol ---

test('[seguridad] un administrador no puede cambiar su propio rol, ni siquiera al mismo rol que ya tiene', async () => {
  const empresa = await crearEmpresa(ctx, 'auto-rol');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'administrador' });
  const token = await login(servidor.baseUrl, cuenta.email, cuenta.password);

  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${cuenta.usuarioId}`, {
    method: 'PUT', headers: headersCon(token), body: JSON.stringify({ rol: 'administrador' })
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /propio rol/i);
});

// --- Seguridad: solo un administrador puede otorgar el rol de administrador ---

test('[seguridad] un administrador SÍ puede otorgar el rol de administrador a otra persona', async () => {
  const empresa = await crearEmpresa(ctx, 'otorga-admin-ok');
  const admin = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'administrador' });
  const objetivo = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'consulta' });
  const token = await login(servidor.baseUrl, admin.email, admin.password);

  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${objetivo.usuarioId}`, {
    method: 'PUT', headers: headersCon(token), body: JSON.stringify({ rol: 'administrador' })
  });
  assert.equal(r.status, 200);
  const { rows } = await pool.query(
    `SELECT r.nombre FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id WHERE ue.usuario_id = $1 AND ue.empresa_id = $2`,
    [objetivo.usuarioId, empresa]
  );
  assert.equal(rows[0].nombre, 'administrador');
});

test('[seguridad] defensa en profundidad: aunque un rol no-administrador tuviera usuarios.editar (por una mala configuración de permisos), el código sigue bloqueando que asigne "administrador"', async () => {
  // Hoy ningún rol real fuera de "administrador" tiene usuarios.editar (la
  // migración 032 lo cerró a nivel de datos) -- por eso esta ruta de ataque
  // no es alcanzable con un login real de la aplicación. Este test no
  // depende de esa configuración de datos: firma un JWT válido (mismo
  // JWT_SECRET que usa la app) simulando el escenario que el guardia de
  // código está para prevenir, y prueba que el guardia en sí -- no la
  // ausencia del permiso -- es lo que bloquea la escalación.
  const empresa = await crearEmpresa(ctx, 'defensa-profundidad');
  const objetivo = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'consulta' });

  const tokenSimulado = jwt.sign(
    {
      id: 999999999, nombre: 'QA-TEST rol con permiso indebido', email: 'qa-test-indebido@example.invalid',
      empresa_id: empresa, empresa_nombre: 'QA-TEST', rol: 'gerente', permisos: ['usuarios.editar', 'usuarios.ver']
    },
    process.env.JWT_SECRET, { expiresIn: '5m' }
  );

  const r = await fetch(`${servidor.baseUrl}/api/usuarios/${objetivo.usuarioId}`, {
    method: 'PUT', headers: headersCon(tokenSimulado), body: JSON.stringify({ rol: 'administrador' })
  });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /Solo un administrador puede asignar/i);
});

// --- Seguridad: sin el permiso, la acción protegida se rechaza ---

test('[seguridad] un usuario sin el permiso correspondiente recibe 403 al intentar la acción protegida', async () => {
  const empresa = await crearEmpresa(ctx, 'sin-permiso');
  // Se determina dinámicamente, contra la base real, un permiso que el rol
  // "consulta" NO tiene -- no se asume de memoria qué permisos tiene cada rol.
  const { rows: permisosConsulta } = await pool.query(
    `SELECT p.nombre FROM roles r
     LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
     LEFT JOIN permisos p ON p.id = rp.permiso_id
     WHERE r.nombre = 'consulta'`
  );
  const tiene = new Set(permisosConsulta.map(p => p.nombre));
  assert.ok(!tiene.has('ventas.crear'), 'este test asume que "consulta" no tiene ventas.crear; si la matriz de permisos cambió, ajustar el test');

  const cuenta = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'consulta' });
  const token = await login(servidor.baseUrl, cuenta.email, cuenta.password);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, {
    method: 'POST', headers: headersCon(token),
    body: JSON.stringify({ fecha: '2026-01-15', producto_id: 1, cliente_id: 1, cantidad: 1, precio_unitario: 100 })
  });
  assert.equal(r.status, 403);
});

// --- Seguridad: las reglas de módulo se respetan ---

test('[seguridad] una empresa sin un módulo contratado recibe 403 al llamar a su API, aunque el usuario tenga el permiso', async () => {
  const empresaSinVentas = await crearEmpresa(ctx, 'sin-modulo-ventas', ['clientes', 'inventario', 'finanzas']);
  const cuenta = await crearUsuario(ctx, { empresaId: empresaSinVentas, rolNombre: 'administrador' });
  const token = await login(servidor.baseUrl, cuenta.email, cuenta.password);

  const r = await fetch(`${servidor.baseUrl}/api/ventas`, { headers: headersCon(token) });
  assert.equal(r.status, 403);
  assert.match((await r.json()).error, /módulo/i);
});

// --- Seguridad: revocar la membresía bloquea el acceso de inmediato (V-05) ---

test('[seguridad] desactivar la membresía de un usuario bloquea sus requests futuros, con el MISMO JWT todavía vigente', async () => {
  const empresa = await crearEmpresa(ctx, 'revocacion');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'administrador' });
  const token = await login(servidor.baseUrl, cuenta.email, cuenta.password);

  const antes = await fetch(`${servidor.baseUrl}/api/ventas`, { headers: headersCon(token) });
  assert.equal(antes.status, 200, 'antes de revocar, el acceso debe funcionar normalmente');

  await pool.query(`UPDATE usuario_empresa SET activo = false WHERE usuario_id = $1 AND empresa_id = $2`, [cuenta.usuarioId, empresa]);

  const despues = await fetch(`${servidor.baseUrl}/api/ventas`, { headers: headersCon(token) });
  assert.equal(despues.status, 403, 'con la membresía desactivada, el MISMO token ya vigente debe dejar de funcionar');
  assert.match((await despues.json()).error, /ya no está activo/i);
});

// --- Trade-off de diseño aceptado: permisos congelados en el JWT ---

test('[trade-off aceptado] revocar un permiso en la base NO afecta una sesión ya iniciada; SÍ afecta un login nuevo', async () => {
  // Comportamiento documentado a propósito en middleware/permisos.js y
  // routes/auth.js -- NO es un bug. Este test prueba que la implementación
  // real coincide exactamente con lo que el propio código dice que hace.
  const empresa = await crearEmpresa(ctx, 'permiso-congelado');
  const cuenta = await crearUsuario(ctx, { empresaId: empresa, rolNombre: 'consulta' });

  // Se le otorga temporalmente ventas.crear a "consulta" en la base de test
  // (aislada -- no afecta ninguna base real) para poder demostrar el freeze
  // en ambos sentidos: aparece en la sesión vieja después de revocado, y no
  // aparece en una sesión nueva antes de otorgado.
  const { rows: rolRows } = await pool.query(`SELECT id FROM roles WHERE nombre = 'consulta'`);
  const { rows: permisoRows } = await pool.query(`SELECT id FROM permisos WHERE nombre = 'ventas.crear'`);
  const rolId = rolRows[0].id;
  const permisoId = permisoRows[0].id;

  try {
    await pool.query(`INSERT INTO rol_permiso (rol_id, permiso_id) VALUES ($1, $2)`, [rolId, permisoId]);

    const tokenConPermiso = await login(servidor.baseUrl, cuenta.email, cuenta.password);

    await pool.query(`DELETE FROM rol_permiso WHERE rol_id = $1 AND permiso_id = $2`, [rolId, permisoId]);

    // Con el token viejo (emitido cuando "consulta" SÍ tenía el permiso),
    // el permiso sigue funcionando -- congelado en el JWT.
    const conTokenViejo = await fetch(`${servidor.baseUrl}/api/ventas`, {
      method: 'POST', headers: headersCon(tokenConPermiso),
      body: JSON.stringify({ fecha: '2026-01-15', producto_id: 999999999, cliente_id: 999999999, cantidad: 1, precio_unitario: 100 })
    });
    // 404 (producto no existe) y no 403 -- prueba que SÍ pasó
    // verificarPermiso('ventas.crear') con el permiso ya revocado en la base.
    assert.equal(conTokenViejo.status, 404, 'el token viejo debe seguir teniendo el permiso ya revocado (freeze intencional)');

    // Un login NUEVO, ya sin el permiso en la base, no lo trae.
    const tokenNuevo = await login(servidor.baseUrl, cuenta.email, cuenta.password);
    const conTokenNuevo = await fetch(`${servidor.baseUrl}/api/ventas`, {
      method: 'POST', headers: headersCon(tokenNuevo),
      body: JSON.stringify({ fecha: '2026-01-15', producto_id: 999999999, cliente_id: 999999999, cantidad: 1, precio_unitario: 100 })
    });
    assert.equal(conTokenNuevo.status, 403, 'un login nuevo, después de revocado, no debe tener el permiso');
  } finally {
    // Restaura el estado del rol en la base de test, sin importar si el
    // test pasó o falló.
    await pool.query(`DELETE FROM rol_permiso WHERE rol_id = $1 AND permiso_id = $2`, [rolId, permisoId]);
  }
});
