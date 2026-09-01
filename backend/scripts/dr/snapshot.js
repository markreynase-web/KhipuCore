// scripts/dr/snapshot.js
// Captura determinista del estado QA-DR: columnas explícitas, orden de
// filas explícito, orden de tablas fijo -- nunca "SELECT *", nunca
// dependiente del orden natural de PostgreSQL. Ver diseño C3.3 para la
// justificación de por qué se incluyen id/timestamps en el hash.
//
// Uso: node scripts/dr/snapshot.js pre   -> pre_restore_snapshot.{json,sha256}
//      node scripts/dr/snapshot.js post  -> post_restore_snapshot.{json,sha256}

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { poolTest as pool } from './precheck.js';
import { ORDEN_TABLAS, COLUMNAS, ordenPorDefecto, DIR_SALIDA_DR } from './dataset.js';

const momento = process.argv[2];
if (momento !== 'pre' && momento !== 'post') {
  console.error('[dr:snapshot] Uso: node scripts/dr/snapshot.js <pre|post>');
  process.exit(1);
}

const rutaManifiesto = path.join(DIR_SALIDA_DR, 'dr_manifest.json');
if (!existsSync(rutaManifiesto)) {
  console.error(`[dr:snapshot] No existe ${rutaManifiesto} -- corré scripts/dr/seed.js primero.`);
  process.exit(1);
}
const manifiesto = JSON.parse(readFileSync(rutaManifiesto, 'utf8'));

// Construye, para cada tabla, la condición WHERE y sus parámetros a partir
// EXCLUSIVAMENTE de los IDs del manifiesto -- nunca de una búsqueda por
// prefijo (el prefijo QA-DR- es defensa secundaria, ver diseño C3.5).
function condicionPara(tabla, m) {
  switch (tabla) {
    case 'empresas':
      return { where: 'id = ANY($1::int[])', params: [[m.empresaA.empresaId, m.empresaB.empresaId]] };
    case 'usuarios':
      return { where: 'id = ANY($1::int[])', params: [[m.empresaA.usuarioId, m.empresaB.usuarioId]] };
    case 'usuario_empresa':
      return { where: 'usuario_id = ANY($1::int[])', params: [[m.empresaA.usuarioId, m.empresaB.usuarioId]] };
    case 'clientes':
      return { where: 'id = ANY($1::int[])', params: [[m.empresaA.clienteId, m.empresaB.clienteId]] };
    case 'inventario':
      return { where: 'id = ANY($1::int[])', params: [[m.empresaA.productoId, m.empresaB.productoId]] };
    case 'ventas':
      return { where: 'id = ANY($1::int[])', params: [[m.empresaA.ventaId, m.empresaB.ventaId]] };
    case 'finanzas':
      return { where: `origen_modulo = 'ventas' AND origen_id = ANY($1::int[])`, params: [[String(m.empresaA.ventaId), String(m.empresaB.ventaId)]] };
    case 'mascotas': {
      const ids = [m.empresaA.mascotaId, m.empresaB.mascotaId].filter(Boolean);
      return { where: 'id = ANY($1::int[])', params: [ids] };
    }
    default:
      throw new Error(`Tabla sin condición definida: ${tabla}`);
  }
}

function serializarValor(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

async function capturar() {
  const resultado = { tomadoEl: new Date().toISOString(), momento, tablas: {} };

  for (const tabla of ORDEN_TABLAS) {
    const columnas = COLUMNAS[tabla];
    const orden = ordenPorDefecto(tabla).join(', ');
    const { where, params } = condicionPara(tabla, manifiesto);
    const sql = `SELECT ${columnas.join(', ')} FROM ${tabla} WHERE ${where} ORDER BY ${orden}`;
    const { rows } = await pool.query(sql, params);
    // Cada fila se serializa como arreglo de [columna, valor] en el orden
    // fijo de `columnas` -- no como objeto plano, para no depender de
    // ningún supuesto sobre el orden de propiedades de JS.
    resultado.tablas[tabla] = rows.map(fila => columnas.map(c => [c, serializarValor(fila[c])]));
  }

  const hashPorTabla = {};
  for (const tabla of ORDEN_TABLAS) {
    hashPorTabla[tabla] = createHash('sha256').update(JSON.stringify(resultado.tablas[tabla])).digest('hex');
  }
  const hashGlobal = createHash('sha256').update(JSON.stringify(hashPorTabla)).digest('hex');

  const nombreBase = `${momento}_restore_snapshot`;
  const rutaJson = path.join(DIR_SALIDA_DR, `${nombreBase}.json`);
  const rutaHash = path.join(DIR_SALIDA_DR, `${nombreBase}.sha256`);

  writeFileSync(rutaJson, JSON.stringify(resultado, null, 2));
  writeFileSync(rutaHash, JSON.stringify({ global: hashGlobal, porTabla: hashPorTabla }, null, 2));

  console.log(`[dr:snapshot] (${momento}) escrito: ${rutaJson}`);
  console.log(`[dr:snapshot] (${momento}) hash global: ${hashGlobal}`);
  for (const tabla of ORDEN_TABLAS) {
    console.log(`[dr:snapshot]   ${tabla}: ${resultado.tablas[tabla].length} fila(s), hash=${hashPorTabla[tabla].slice(0, 12)}...`);
  }

  await pool.end();
}

capturar().catch(err => { console.error('[dr:snapshot] ERROR:', err.message); process.exit(1); });
