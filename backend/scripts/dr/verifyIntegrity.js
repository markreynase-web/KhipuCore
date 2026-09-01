// scripts/dr/verifyIntegrity.js
// Integridad referencial post-restore, acotada al dataset QA-DR del
// manifiesto (no revalida los 35 módulos) + un chequeo general de que
// ningún constraint del schema public quedó marcado como NOT VALID
// después del restore. Solo lectura.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { DIR_SALIDA_DR } from './dataset.js';

const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
if (!existsSync(rutaManifiesto)) {
  console.error(`[dr:integrity] No existe ${rutaManifiesto}.`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));

async function huerfanos(nombre, sql, params) {
  const { rows } = await pool.query(sql, params);
  const estado = rows.length === 0 ? 'OK (0 huérfanos)' : `*** ${rows.length} HUÉRFANO(S) ***`;
  console.log(`[dr:integrity] ${nombre}: ${estado}`);
  if (rows.length) console.log('  ', JSON.stringify(rows));
  return rows.length === 0;
}

async function principal() {
  const empresaIds = [m.empresaA.empresaId, m.empresaB.empresaId];
  const usuarioIds = [m.empresaA.usuarioId, m.empresaB.usuarioId];
  const ventaIds = [m.empresaA.ventaId, m.empresaB.ventaId];

  let todoOk = true;

  todoOk &= await huerfanos(
    'usuario_empresa -> empresas',
    `SELECT ue.usuario_id, ue.empresa_id FROM usuario_empresa ue
     LEFT JOIN empresas e ON e.id = ue.empresa_id
     WHERE ue.usuario_id = ANY($1::int[]) AND e.id IS NULL`,
    [usuarioIds]
  );

  todoOk &= await huerfanos(
    'clientes -> empresas',
    `SELECT c.id, c.empresa_id FROM clientes c
     LEFT JOIN empresas e ON e.id = c.empresa_id
     WHERE c.empresa_id = ANY($1::int[]) AND e.id IS NULL`,
    [empresaIds]
  );

  todoOk &= await huerfanos(
    'inventario -> empresas',
    `SELECT i.id, i.empresa_id FROM inventario i
     LEFT JOIN empresas e ON e.id = i.empresa_id
     WHERE i.empresa_id = ANY($1::int[]) AND e.id IS NULL`,
    [empresaIds]
  );

  todoOk &= await huerfanos(
    'mascotas -> empresas',
    `SELECT ms.id, ms.empresa_id FROM mascotas ms
     LEFT JOIN empresas e ON e.id = ms.empresa_id
     WHERE ms.empresa_id = ANY($1::int[]) AND e.id IS NULL`,
    [empresaIds]
  );

  todoOk &= await huerfanos(
    'mascotas -> clientes (misma empresa)',
    `SELECT ms.id, ms.cliente_id FROM mascotas ms
     LEFT JOIN clientes c ON c.id = ms.cliente_id AND c.empresa_id = ms.empresa_id
     WHERE ms.empresa_id = ANY($1::int[]) AND ms.cliente_id IS NOT NULL AND c.id IS NULL`,
    [empresaIds]
  );

  todoOk &= await huerfanos(
    'ventas -> clientes (misma empresa)',
    `SELECT v.id, v.cliente_id FROM ventas v
     LEFT JOIN clientes c ON c.id = v.cliente_id AND c.empresa_id = v.empresa_id
     WHERE v.id = ANY($1::int[]) AND v.cliente_id IS NOT NULL AND c.id IS NULL`,
    [ventaIds]
  );

  todoOk &= await huerfanos(
    'ventas -> inventario (misma empresa)',
    `SELECT v.id, v.producto_id FROM ventas v
     LEFT JOIN inventario i ON i.id = v.producto_id AND i.empresa_id = v.empresa_id
     WHERE v.id = ANY($1::int[]) AND v.producto_id IS NOT NULL AND i.id IS NULL`,
    [ventaIds]
  );

  todoOk &= await huerfanos(
    'finanzas -> ventas (origen_id)',
    `SELECT f.id, f.origen_id FROM finanzas f
     LEFT JOIN ventas v ON v.id = f.origen_id
     WHERE f.origen_modulo = 'ventas' AND f.origen_id = ANY($1::int[]) AND v.id IS NULL`,
    [ventaIds]
  );

  // Chequeo general (no acotado al manifiesto): ningún constraint del
  // schema public debería quedar NOT VALID después de un restore limpio.
  const { rows: invalidos } = await pool.query(`
    SELECT conname, conrelid::regclass AS tabla
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND NOT convalidated
  `);
  console.log(`[dr:integrity] constraints NOT VALID en public: ${invalidos.length === 0 ? 'OK (ninguno)' : JSON.stringify(invalidos)}`);
  if (invalidos.length) todoOk = false;

  await pool.end();

  if (!todoOk) {
    console.error('[dr:integrity] FALLÓ -- hay huérfanos o constraints inválidos.');
    process.exit(1);
  }
  console.log('[dr:integrity] Integridad referencial OK.');
}

principal().catch(err => { console.error('[dr:integrity] ERROR:', err.message); process.exit(1); });
