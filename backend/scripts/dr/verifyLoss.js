// scripts/dr/verifyLoss.js
// Confirma que la pérdida simulada realmente ocurrió -- exclusivamente
// para los IDs del manifiesto. Solo lectura, no modifica nada. Falla
// (exit code 1) si queda cualquier registro que debería haber sido
// eliminado.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { DIR_SALIDA_DR } from './dataset.js';

const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
if (!existsSync(rutaManifiesto)) {
  console.error(`[dr:verifyLoss] No existe ${rutaManifiesto}.`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));

async function contar(sql, params) {
  const { rows } = await pool.query(sql, params);
  return Number(rows[0].n);
}

async function principal() {
  const empresaIds = [m.empresaA.empresaId, m.empresaB.empresaId];
  const usuarioIds = [m.empresaA.usuarioId, m.empresaB.usuarioId];
  const clienteIds = [m.empresaA.clienteId, m.empresaB.clienteId];
  const productoIds = [m.empresaA.productoId, m.empresaB.productoId];
  const ventaIds = [m.empresaA.ventaId, m.empresaB.ventaId];
  const mascotaIds = [m.empresaA.mascotaId].filter(Boolean);

  const chequeos = [
    ['empresas', await contar('SELECT count(*)::int AS n FROM empresas WHERE id = ANY($1::int[])', [empresaIds])],
    ['empresa_modulos', await contar('SELECT count(*)::int AS n FROM empresa_modulos WHERE empresa_id = ANY($1::int[])', [empresaIds])],
    ['usuarios', await contar('SELECT count(*)::int AS n FROM usuarios WHERE id = ANY($1::int[])', [usuarioIds])],
    ['usuario_empresa', await contar('SELECT count(*)::int AS n FROM usuario_empresa WHERE usuario_id = ANY($1::int[])', [usuarioIds])],
    ['clientes', await contar('SELECT count(*)::int AS n FROM clientes WHERE id = ANY($1::int[])', [clienteIds])],
    ['inventario', await contar('SELECT count(*)::int AS n FROM inventario WHERE id = ANY($1::int[])', [productoIds])],
    ['ventas', await contar('SELECT count(*)::int AS n FROM ventas WHERE id = ANY($1::int[])', [ventaIds])],
    ['finanzas', await contar(`SELECT count(*)::int AS n FROM finanzas WHERE origen_modulo='ventas' AND origen_id = ANY($1::int[])`, [ventaIds.map(String)])],
    ['mascotas', mascotaIds.length ? await contar('SELECT count(*)::int AS n FROM mascotas WHERE id = ANY($1::int[])', [mascotaIds]) : 0]
  ];

  let huboRestos = false;
  for (const [tabla, n] of chequeos) {
    const estado = n === 0 ? 'OK (0 filas)' : `*** QUEDARON ${n} FILA(S) ***`;
    console.log(`[dr:verifyLoss] ${tabla}: ${estado}`);
    if (n !== 0) huboRestos = true;
  }

  await pool.end();

  if (huboRestos) {
    console.error('[dr:verifyLoss] FALLÓ -- quedaron registros que deberían haberse eliminado. NO avanzar al restore.');
    process.exit(1);
  }
  console.log('[dr:verifyLoss] Pérdida confirmada: 0 registros QA-DR en las 9 tablas verificadas.');
}

principal().catch(err => { console.error('[dr:verifyLoss] ERROR:', err.message); process.exit(1); });
