// scripts/dr/seed.js
// Crea el dataset QA-DR (Empresa A + Empresa B) descripto en el diseño de
// C3.2, y escribe backend/backups/dr/dr_manifest.json con los IDs exactos
// para que el resto de los scripts de C3 nunca dependan de buscar por
// nombre/prefijo -- el prefijo QA-DR- es una defensa SECUNDARIA (visual,
// de reconocimiento humano), el manifiesto de IDs es la primaria.
//
// La venta de cada empresa se crea vía HTTP real (POST /api/ventas) contra
// un servidor de test levantado acá mismo, apuntando a TEST_DATABASE_URL --
// así también queda ejercitado el movimiento de finanzas que la aplicación
// genera sola, no uno insertado a mano.
//
// NO ESCRIBE NINGUNA CONTRASEÑA EN EL MANIFIESTO. La contraseña QA-DR sale
// de DR_QA_PASSWORD (variable de entorno) o de un valor sintético por
// defecto -- nunca se imprime.

import bcrypt from 'bcryptjs';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { iniciarServidorTest } from '../../tests/helpers/servidorTest.js';
import { PREFIJO_DR, DIR_SALIDA_DR, DR_PASSWORD } from './dataset.js';

async function crearEmpresaBase(sufijo, modulos) {
  const { rows } = await pool.query(
    `INSERT INTO empresas (nombre, activo) VALUES ($1, true) RETURNING id`,
    [`${PREFIJO_DR}Empresa-${sufijo}`]
  );
  const empresaId = rows[0].id;
  for (const moduloId of modulos) {
    await pool.query(`INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES ($1,$2)`, [empresaId, moduloId]);
  }
  return empresaId;
}

async function crearUsuarioAdmin(empresaId, sufijo) {
  const { rows: rolRows } = await pool.query(`SELECT id FROM roles WHERE nombre = 'administrador'`);
  const rolId = rolRows[0].id;
  const email = `${PREFIJO_DR.toLowerCase()}usuario-${sufijo}@example.invalid`;
  const hash = await bcrypt.hash(DR_PASSWORD, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, activo) VALUES ($1,$2,$3,true) RETURNING id`,
    [`${PREFIJO_DR}Usuario-${sufijo}`, email, hash]
  );
  const usuarioId = rows[0].id;
  await pool.query(
    `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES ($1,$2,$3,true)`,
    [usuarioId, empresaId, rolId]
  );
  return { usuarioId, email };
}

async function crearCliente(empresaId, sufijo) {
  const { rows } = await pool.query(
    `INSERT INTO clientes (empresa_id, nombre) VALUES ($1,$2) RETURNING id`,
    [empresaId, `${PREFIJO_DR}Cliente-${sufijo}`]
  );
  return rows[0].id;
}

async function crearProducto(empresaId, sufijo) {
  const { rows } = await pool.query(
    `INSERT INTO inventario (fecha_registro, empresa_id, nombre, categoria, stock, precio_unitario)
     VALUES (CURRENT_DATE, $1, $2, 'general', 50, 100) RETURNING id`,
    [empresaId, `${PREFIJO_DR}Producto-${sufijo}`]
  );
  return rows[0].id;
}

async function crearMascota(empresaId, clienteId, sufijo) {
  const { rows } = await pool.query(
    `INSERT INTO mascotas (cliente_id, cliente_nombre, nombre, especie, empresa_id)
     VALUES ($1, $2, $3, 'perro', $4) RETURNING id`,
    [clienteId, `${PREFIJO_DR}Cliente-${sufijo}`, `${PREFIJO_DR}Mascota-${sufijo}`, empresaId]
  );
  return rows[0].id;
}

async function sembrar() {
  console.log('[dr:seed] Levantando servidor de test contra TEST_DATABASE_URL...');
  const servidor = await iniciarServidorTest();

  try {
    // --- Empresa A: ventas, inventario, clientes, finanzas, mascotas ---
    const empresaA = await crearEmpresaBase('A', ['ventas', 'inventario', 'clientes', 'finanzas', 'mascotas']);
    const { usuarioId: usuarioA, email: emailA } = await crearUsuarioAdmin(empresaA, 'A');
    const clienteA = await crearCliente(empresaA, 'A');
    const productoA = await crearProducto(empresaA, 'A');
    const mascotaA = await crearMascota(empresaA, clienteA, 'A');

    const tokenA = await loginHttp(servidor.baseUrl, emailA, DR_PASSWORD);
    const ventaA = await crearVentaHttp(servidor.baseUrl, tokenA, productoA, clienteA);

    // --- Empresa B: ventas, inventario, clientes, finanzas (sin mascota) ---
    const empresaB = await crearEmpresaBase('B', ['ventas', 'inventario', 'clientes', 'finanzas']);
    const { usuarioId: usuarioB, email: emailB } = await crearUsuarioAdmin(empresaB, 'B');
    const clienteB = await crearCliente(empresaB, 'B');
    const productoB = await crearProducto(empresaB, 'B');

    const tokenB = await loginHttp(servidor.baseUrl, emailB, DR_PASSWORD);
    const ventaB = await crearVentaHttp(servidor.baseUrl, tokenB, productoB, clienteB);

    const manifiesto = {
      creadoEl: new Date().toISOString(),
      prefijo: PREFIJO_DR,
      empresaA: { empresaId: empresaA, usuarioId: usuarioA, clienteId: clienteA, productoId: productoA, mascotaId: mascotaA, ventaId: ventaA },
      empresaB: { empresaId: empresaB, usuarioId: usuarioB, clienteId: clienteB, productoId: productoB, ventaId: ventaB }
    };

    if (!existsSync(DIR_SALIDA_DR)) mkdirSync(DIR_SALIDA_DR, { recursive: true });
    const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
    writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
    console.log(`[dr:seed] Manifiesto escrito: ${rutaManifiesto}`);
    console.log(`[dr:seed] Empresa A: empresa=${empresaA} usuario=${usuarioA} cliente=${clienteA} producto=${productoA} mascota=${mascotaA} venta=${ventaA}`);
    console.log(`[dr:seed] Empresa B: empresa=${empresaB} usuario=${usuarioB} cliente=${clienteB} producto=${productoB} venta=${ventaB}`);
  } finally {
    await servidor.detener();
  }

  await pool.end();
}

async function loginHttp(baseUrl, email, password) {
  const r = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`[dr:seed] Login falló (${r.status}): ${JSON.stringify(body)}`);
  return body.token;
}

async function crearVentaHttp(baseUrl, token, productoId, clienteId) {
  const r = await fetch(`${baseUrl}/api/ventas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), producto_id: productoId, cliente_id: clienteId, cantidad: 3, precio_unitario: 100 })
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`[dr:seed] Creación de venta falló (${r.status}): ${JSON.stringify(body)}`);
  return body.id;
}

sembrar().catch(err => { console.error('[dr:seed] ERROR:', err.message); process.exit(1); });
