// src/migrate.js
// Aplica todos los archivos .sql de /migrations, en orden alfabético.
// Uso: npm run migrate
// Cuando agregues un módulo nuevo (ej. Inventario), su tabla va en
// 002_inventario.sql y este mismo script la recoge sin cambios.

import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dirMigraciones = path.join(__dirname, '..', 'migrations');

async function migrar() {
  const archivos = readdirSync(dirMigraciones).filter(f => f.endsWith('.sql')).sort();
  if (!archivos.length) {
    console.log('No hay archivos .sql en /migrations.');
    return;
  }
  for (const archivo of archivos) {
    const sql = readFileSync(path.join(dirMigraciones, archivo), 'utf8');
    console.log(`Aplicando ${archivo}...`);
    await pool.query(sql);
  }
  console.log(`Listo: ${archivos.length} migración(es) aplicada(s).`);
}

migrar()
  .catch(err => { console.error('Error migrando:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
