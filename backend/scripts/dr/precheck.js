// scripts/dr/precheck.js
// Punto de entrada OBLIGATORIO para todo script de C3 que toque la base.
// Reutiliza el guardia fail-closed ya existente en tests/helpers/testDb.js
// (TEST_ENV=true + TEST_DATABASE_URL + TEST_DATABASE_URL != DATABASE_URL,
// aborta el proceso si algo falla) -- no se duplica esa lógica acá, solo
// se agrega la confirmación visual sanitizada que pide C3.1.
//
// Ningún script de scripts/dr/ debe importar ../../src/db.js ni construir
// un pool a mano -- todos importan `poolTest` DESDE ACÁ.

import { poolTest } from '../../tests/helpers/testDb.js';

const url = new URL(process.env.TEST_DATABASE_URL);
const base = (url.pathname || '/postgres').slice(1) || 'postgres';

console.log('[dr] --- Precheck de seguridad C3 ---');
console.log(`[dr] Destino confirmado: TEST_DATABASE_URL -> host="${url.hostname}" db="${base}" puerto="${url.port || '5432'}"`);
console.log(`[dr] DATABASE_URL presente: ${Boolean(process.env.DATABASE_URL)} (valor no mostrado)`);
console.log(`[dr] TEST_DATABASE_URL !== DATABASE_URL: ${process.env.TEST_DATABASE_URL !== process.env.DATABASE_URL}`);
console.log('[dr] --- Precheck OK, continuando ---');

export { poolTest };
export const hostConfirmado = url.hostname;
export const baseConfirmada = base;
