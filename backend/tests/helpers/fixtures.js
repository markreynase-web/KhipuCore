// tests/helpers/fixtures.js
// Datos de prueba reales insertados en TEST_DATABASE_URL (nunca en la base
// de producción/desarrollo -- ver el guardia fail-closed en testDb.js, que
// es de donde sale el pool `poolTest` que se usa acá abajo). Todo lo que
// crea este archivo lleva el prefijo QA-TEST para poder identificarlo a
// simple vista si alguna limpieza llegara a fallar, y cada test debe llamar
// a limpiarContexto() en un finally/after -- nunca se borra "todo lo que
// empiece con QA-TEST", solo los IDs exactos que el propio contexto creó.

import bcrypt from 'bcryptjs';
// NUNCA ../../src/db.js acá -- ese es el pool de producción. Todo lo que
// este archivo inserta/borra pasa por el pool de tests, que solo existe si
// pasó el guardia fail-closed de testDb.js (TEST_ENV + TEST_DATABASE_URL).
import { poolTest as pool } from './testDb.js';

export const PASSWORD_QA = 'AbcTest1234';
const PREFIJO = 'QA-TEST (borrar)';

export function nuevoContexto() {
  return {
    empresaIds: [], usuarioIds: [], productoIds: [], clienteIds: [], ventaIds: [],
    mascotaIds: [], flotaIds: [], atencionIds: []
  };
}

// 'usuarios' NO es un modulo_id real (la tabla `modulos` no lo tiene --
// routes/usuarios.js usa auth+requireEmpresa, nunca requireModulo()).
// Incluirlo acá violaba la FK de empresa_modulos_modulo_id_fkey en TODAS
// las empresas de prueba, tumbando 30/30 tests en el before()/beforeEach().
export async function crearEmpresa(ctx, sufijo = '', modulos = ['ventas', 'inventario', 'clientes', 'finanzas']) {
  const { rows } = await pool.query(
    `INSERT INTO empresas (nombre, activo) VALUES ($1, true) RETURNING id`,
    [`${PREFIJO} ${sufijo} ${Date.now()}`]
  );
  const empresaId = rows[0].id;
  ctx.empresaIds.push(empresaId);
  for (const moduloId of modulos) {
    await pool.query(`INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES ($1,$2)`, [empresaId, moduloId]);
  }
  return empresaId;
}

export async function crearUsuario(ctx, { empresaId, rolNombre = 'administrador', activo = true }) {
  const { rows: rolRows } = await pool.query(`SELECT id FROM roles WHERE nombre = $1`, [rolNombre]);
  if (!rolRows.length) throw new Error(`Rol de prueba "${rolNombre}" no existe en la base.`);
  const rolId = rolRows[0].id;

  const email = `qa-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}@example.invalid`;
  const hash = await bcrypt.hash(PASSWORD_QA, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo) VALUES ($1,$2,$3,true) RETURNING id`,
    [`${PREFIJO} usuario`, email, hash]
  );
  const usuarioId = rows[0].id;
  ctx.usuarioIds.push(usuarioId);

  await pool.query(
    `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES ($1,$2,$3,$4)`,
    [usuarioId, empresaId, rolId, activo]
  );

  return { usuarioId, email, password: PASSWORD_QA };
}

export async function crearProducto(ctx, empresaId, { nombre = 'Producto', stock = 100, precio_unitario = 100 } = {}) {
  const { rows } = await pool.query(
    `INSERT INTO inventario (fecha_registro, empresa_id, nombre, categoria, stock, precio_unitario)
     VALUES (CURRENT_DATE, $1, $2, 'general', $3, $4) RETURNING id`,
    [empresaId, `${PREFIJO} ${nombre}`, stock, precio_unitario]
  );
  ctx.productoIds.push(rows[0].id);
  return rows[0].id;
}

export async function crearCliente(ctx, empresaId, nombre = 'Cliente') {
  const { rows } = await pool.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1, $2) RETURNING id`,
    [empresaId, `${PREFIJO} ${nombre}`]
  );
  ctx.clienteIds.push(rows[0].id);
  return rows[0].id;
}

// Mascota de un cliente (vertical Veterinaria) -- inserción directa, mismo
// patrón que crearCliente/crearProducto (no necesita pasar por HTTP para
// existir como fixture de "recurso de la otra empresa").
export async function crearMascota(ctx, empresaId, clienteId, nombre = 'Mascota') {
  const { rows } = await pool.query(
    `INSERT INTO mascotas (cliente_id, cliente_nombre, nombre, especie, empresa_id)
     VALUES ($1, 'QA-TEST (borrar) dueño', $2, 'perro', $3) RETURNING id`,
    [clienteId, `${PREFIJO} ${nombre}`, empresaId]
  );
  ctx.mascotaIds.push(rows[0].id);
  return rows[0].id;
}

// Login real vía HTTP contra el servidor de test -- así el JWT que usan los
// tests es exactamente el mismo que emite la aplicación real, no uno armado
// a mano.
export async function login(baseUrl, email, password) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`Login de prueba falló (${r.status}): ${JSON.stringify(body)}`);
  return body.token;
}

// Borra EXACTAMENTE los IDs que este contexto creó, en orden de
// dependencias FK, sin importar si algún test los dejó a medio crear.
export async function limpiarContexto(ctx) {
  if (ctx.ventaIds.length) {
    await pool.query(`DELETE FROM ventas WHERE id = ANY($1::int[])`, [ctx.ventaIds]);
  }
  if (ctx.empresaIds.length) {
    await pool.query(`DELETE FROM ventas WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    await pool.query(`DELETE FROM finanzas WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    await pool.query(`DELETE FROM audit_log WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    // atenciones_veterinarias referencia mascotas -- va antes, por si acaso.
    await pool.query(`DELETE FROM atenciones_veterinarias WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    await pool.query(`DELETE FROM mascotas WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    await pool.query(`DELETE FROM flota WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
  }
  if (ctx.atencionIds.length) {
    await pool.query(`DELETE FROM atenciones_veterinarias WHERE id = ANY($1::int[])`, [ctx.atencionIds]);
  }
  if (ctx.mascotaIds.length) {
    await pool.query(`DELETE FROM mascotas WHERE id = ANY($1::int[])`, [ctx.mascotaIds]);
  }
  if (ctx.flotaIds.length) {
    await pool.query(`DELETE FROM flota WHERE id = ANY($1::int[])`, [ctx.flotaIds]);
  }
  if (ctx.productoIds.length) {
    await pool.query(`DELETE FROM inventario WHERE id = ANY($1::int[])`, [ctx.productoIds]);
  }
  if (ctx.clienteIds.length) {
    await pool.query(`DELETE FROM clientes WHERE id = ANY($1::int[])`, [ctx.clienteIds]);
  }
  if (ctx.usuarioIds.length) {
    await pool.query(`DELETE FROM usuario_empresa WHERE usuario_id = ANY($1::int[])`, [ctx.usuarioIds]);
    await pool.query(`DELETE FROM usuarios WHERE id = ANY($1::int[])`, [ctx.usuarioIds]);
  }
  if (ctx.empresaIds.length) {
    await pool.query(`DELETE FROM empresa_modulos WHERE empresa_id = ANY($1::int[])`, [ctx.empresaIds]);
    await pool.query(`DELETE FROM empresas WHERE id = ANY($1::int[])`, [ctx.empresaIds]);
  }
}
