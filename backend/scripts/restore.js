#!/usr/bin/env node
// scripts/restore.js
// Restauración real vía pg_restore, SIEMPRE contra un destino explícito
// (RESTORE_TARGET_URL). Nunca usa DATABASE_URL como destino por defecto, y
// rechaza explícitamente restaurar si RESTORE_TARGET_URL coincide con
// DATABASE_URL -- ver BACKUP.md para el procedimiento completo.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function fallar(mensaje) {
  console.error(`[restore] ${mensaje}`);
  process.exit(1);
}

const archivo = process.argv[2];
if (!archivo) {
  fallar('Uso: node scripts/restore.js <archivo.dump>   (con RESTORE_TARGET_URL definida en el entorno)');
}
if (!existsSync(archivo)) {
  fallar(`No existe el archivo: ${archivo}`);
}

if (!process.env.RESTORE_TARGET_URL) {
  fallar(
    'Falta RESTORE_TARGET_URL. La restauración NUNCA usa DATABASE_URL como destino ' +
    'por defecto -- indicá explícitamente a qué base restaurar (una base aislada, ' +
    'nunca producción).'
  );
}

if (process.env.RESTORE_TARGET_URL === process.env.DATABASE_URL) {
  fallar('RESTORE_TARGET_URL es idéntica a DATABASE_URL. Restaurar sobre producción por accidente está prohibido -- usá una base de destino aislada.');
}

let url;
try {
  url = new URL(process.env.RESTORE_TARGET_URL);
} catch {
  fallar('RESTORE_TARGET_URL no es una URL de conexión válida.');
}

const verificacion = spawnSync('pg_restore', ['--version'], { stdio: 'ignore' });
if (verificacion.error) {
  fallar(
    'pg_restore no está instalado o no está en el PATH de este sistema.\n' +
    'Ver BACKUP.md para el detalle de las alternativas evaluadas.'
  );
}

const nombreBase = (url.pathname || '/postgres').slice(1) || 'postgres';
const envLibpq = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || '5432',
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: nombreBase,
  PGSSLMODE: process.env.PGSSL === 'false' ? 'disable' : 'require'
};

// RESTORE_LIST_FILE (opcional): si se define, se agrega -L <archivo> a
// pg_restore para restaurar solo las entradas de esa lista, en vez del
// dump completo. Pensado para excluir a mano entradas puntuales del TOC
// (ej. el objeto "SCHEMA public" cuando choca con una extensión que ya
// vive ahí en el destino -- ver BACKUP.md) sin tener que decidir en el
// script, de forma genérica, qué excluir -- la lista filtrada es un
// artefacto explícito de cada prueba de recuperación, generado a mano con
// "pg_restore -l" + edición, nunca algo que este script decida solo.
const argsExtra = [];
if (process.env.RESTORE_LIST_FILE) {
  if (!existsSync(process.env.RESTORE_LIST_FILE)) {
    fallar(`RESTORE_LIST_FILE apunta a un archivo que no existe: ${process.env.RESTORE_LIST_FILE}`);
  }
  argsExtra.push('-L', process.env.RESTORE_LIST_FILE);
  console.log(`[restore] Usando lista TOC filtrada: ${process.env.RESTORE_LIST_FILE}`);
}

console.log(`[restore] Restaurando ${archivo} -> "${nombreBase}" en "${url.hostname}" (RESTORE_TARGET_URL)`);

// --exit-on-error + --single-transaction: restauración todo-o-nada. Sin
// esto, pg_restore por defecto sigue adelante después de un error
// individual y recién al final reporta cuántos hubo -- pudiendo dejar la
// base a medio restaurar sin que quede claro dónde se cortó. Con ambos,
// cualquier error revierte TODO (ROLLBACK), dejando la base exactamente
// como estaba antes del intento -- preferible a un resultado ambiguo para
// una prueba de recuperación real.
const resultado = spawnSync(
  'pg_restore',
  ['--clean', '--if-exists', '--no-owner', '--exit-on-error', '--single-transaction', ...argsExtra, '-d', nombreBase, archivo],
  { env: envLibpq, stdio: ['ignore', 'inherit', 'inherit'] }
);

if (resultado.status !== 0) {
  fallar(`pg_restore terminó con código ${resultado.status}. Revisá el detalle de arriba.`);
}

console.log(`[restore] Completado sobre "${nombreBase}" en "${url.hostname}".`);
