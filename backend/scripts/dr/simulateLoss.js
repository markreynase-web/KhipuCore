// scripts/dr/simulateLoss.js
// Pérdida simulada del dataset QA-DR. Este es el único script destructivo
// de C3 -- por eso tiene más guardias que ningún otro:
//
//   1. precheck.js (TEST_DATABASE_URL confirmada, != DATABASE_URL).
//   2. Carga dr_manifest.json -- si no existe, aborta.
//   3. Vuelve a leer de la base los nombres de las empresas del manifiesto
//      y exige que empiecen con el prefijo QA-DR- (defensa SECUNDARIA: si
//      el manifiesto quedara desincronizado de la base real, esto lo
//      detecta antes de borrar).
//   4. Imprime un resumen sanitizado de EXACTAMENTE qué va a borrar, antes
//      de borrar nada.
//   5. Exige el flag --confirm en la línea de comandos -- sin él, termina
//      en el resumen (dry run) y no ejecuta ningún DELETE.
//
// La defensa PRIMARIA en todo momento son los IDs exactos del manifiesto
// (nunca un DELETE por prefijo/patrón, nunca sin WHERE). Todo corre dentro
// de una única transacción: si algo falla a mitad, se revierte todo.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { PREFIJO_DR, DIR_SALIDA_DR } from './dataset.js';

const CONFIRMAR = process.argv.includes('--confirm');

const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
if (!existsSync(rutaManifiesto)) {
  console.error(`[dr:loss] No existe ${rutaManifiesto} -- corré scripts/dr/seed.js primero.`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));

async function verificarPrefijoQA_DR(empresaId) {
  const { rows } = await pool.query('SELECT nombre FROM empresas WHERE id = $1', [empresaId]);
  if (!rows.length) throw new Error(`Empresa id=${empresaId} del manifiesto ya no existe en la base -- abortando, no coincide con el estado esperado.`);
  if (!rows[0].nombre.startsWith(PREFIJO_DR)) {
    throw new Error(`Empresa id=${empresaId} tiene nombre "${rows[0].nombre}", no empieza con "${PREFIJO_DR}" -- abortando, el manifiesto no corresponde al dataset QA-DR esperado.`);
  }
  return rows[0].nombre;
}

async function principal() {
  console.log('[dr:loss] Verificando que las empresas del manifiesto sigan siendo QA-DR...');
  const nombreA = await verificarPrefijoQA_DR(m.empresaA.empresaId);
  const nombreB = await verificarPrefijoQA_DR(m.empresaB.empresaId);
  console.log(`[dr:loss]   Empresa A: id=${m.empresaA.empresaId} nombre="${nombreA}" -- OK`);
  console.log(`[dr:loss]   Empresa B: id=${m.empresaB.empresaId} nombre="${nombreB}" -- OK`);

  console.log('\n[dr:loss] === RESUMEN DE LO QUE SE VA A ELIMINAR ===');
  console.log(`[dr:loss] finanzas:        origen_id IN (venta ${m.empresaA.ventaId}, venta ${m.empresaB.ventaId})`);
  console.log(`[dr:loss] mascotas:        id IN (${[m.empresaA.mascotaId].filter(Boolean).join(', ') || '-- ninguna --'})`);
  console.log(`[dr:loss] ventas:          id IN (${m.empresaA.ventaId}, ${m.empresaB.ventaId})`);
  console.log(`[dr:loss] inventario:      id IN (${m.empresaA.productoId}, ${m.empresaB.productoId})`);
  console.log(`[dr:loss] clientes:        id IN (${m.empresaA.clienteId}, ${m.empresaB.clienteId})`);
  console.log(`[dr:loss] usuario_empresa: usuario_id IN (${m.empresaA.usuarioId}, ${m.empresaB.usuarioId})`);
  console.log(`[dr:loss] usuarios:        id IN (${m.empresaA.usuarioId}, ${m.empresaB.usuarioId})`);
  console.log(`[dr:loss] empresa_modulos: empresa_id IN (${m.empresaA.empresaId}, ${m.empresaB.empresaId})`);
  console.log(`[dr:loss] empresas:        id IN (${m.empresaA.empresaId}, ${m.empresaB.empresaId})`);
  console.log('[dr:loss] ============================================\n');

  if (!CONFIRMAR) {
    console.log('[dr:loss] DRY RUN -- no se ejecutó ningún DELETE. Volvé a correr con --confirm para ejecutar de verdad.');
    await pool.end();
    return;
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const ventaIds = [m.empresaA.ventaId, m.empresaB.ventaId];
    const mascotaIds = [m.empresaA.mascotaId].filter(Boolean);
    const clienteIds = [m.empresaA.clienteId, m.empresaB.clienteId];
    const productoIds = [m.empresaA.productoId, m.empresaB.productoId];
    const usuarioIds = [m.empresaA.usuarioId, m.empresaB.usuarioId];
    const empresaIds = [m.empresaA.empresaId, m.empresaB.empresaId];

    await cliente.query(`DELETE FROM finanzas WHERE origen_modulo='ventas' AND origen_id = ANY($1::int[])`, [ventaIds.map(String)]);
    if (mascotaIds.length) await cliente.query(`DELETE FROM mascotas WHERE id = ANY($1::int[])`, [mascotaIds]);
    await cliente.query(`DELETE FROM ventas WHERE id = ANY($1::int[])`, [ventaIds]);
    await cliente.query(`DELETE FROM inventario WHERE id = ANY($1::int[])`, [productoIds]);
    await cliente.query(`DELETE FROM clientes WHERE id = ANY($1::int[])`, [clienteIds]);
    await cliente.query(`DELETE FROM usuario_empresa WHERE usuario_id = ANY($1::int[])`, [usuarioIds]);
    await cliente.query(`DELETE FROM usuarios WHERE id = ANY($1::int[])`, [usuarioIds]);
    await cliente.query(`DELETE FROM empresa_modulos WHERE empresa_id = ANY($1::int[])`, [empresaIds]);
    await cliente.query(`DELETE FROM empresas WHERE id = ANY($1::int[])`, [empresaIds]);
    await cliente.query('COMMIT');
    console.log('[dr:loss] Pérdida simulada ejecutada y confirmada (COMMIT).');
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error('[dr:loss] ERROR -- se revirtió todo (ROLLBACK):', err.message);
    process.exitCode = 1;
  } finally {
    cliente.release();
  }

  await pool.end();
}

principal().catch(err => { console.error('[dr:loss] ERROR:', err.message); process.exit(1); });
