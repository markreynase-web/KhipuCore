// tests/helpers/testDb.js
// Guarda fail-closed: es el ÚNICO lugar del proyecto donde los tests abren
// una conexión a base de datos. Todo archivo de test o fixture debe importar
// el pool desde acá, nunca desde ../../src/db.js directo -- así es
// estructuralmente imposible que la suite corra contra DATABASE_URL sin que
// alguien lo haga a propósito, saltándose este archivo.
//
// Las tres condiciones de abajo abortan el PROCESO ENTERO (no solo lanzan
// un error que un test podría, sin querer, dejar pasar) apenas se importa
// este módulo -- antes de que exista ningún pool, antes de cualquier query.

import pg from 'pg';
import dotenv from 'dotenv';

// Mismo patrón que src/db.js -- carga .env acá para que "npm test" funcione
// sin que cada desarrollador tenga que exportar variables a mano en su shell.
dotenv.config();

function abortarProteccionDeProduccion(motivo) {
  console.error(
    `\n[tests] EJECUCIÓN ABORTADA -- ${motivo}\n` +
    `La suite de tests se negó a correr para proteger la base de datos de producción.\n` +
    `Configurá TEST_ENV=true y TEST_DATABASE_URL (una base EXCLUSIVA de pruebas,\n` +
    `distinta de DATABASE_URL) antes de volver a intentar.\n`
  );
  process.exit(1);
}

if (process.env.TEST_ENV !== 'true') {
  abortarProteccionDeProduccion('falta TEST_ENV=true (o tiene un valor distinto de "true").');
}

if (!process.env.TEST_DATABASE_URL) {
  abortarProteccionDeProduccion('falta TEST_DATABASE_URL. Los tests NUNCA usan DATABASE_URL como fallback.');
}

if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  abortarProteccionDeProduccion('TEST_DATABASE_URL es idéntica a DATABASE_URL -- correr la suite destructiva contra producción está prohibido.');
}

const { Pool } = pg;
const usarSSL = process.env.PGSSL !== 'false';

// Pool completamente separado del que usa la aplicación real (src/db.js) --
// construido EXCLUSIVAMENTE desde TEST_DATABASE_URL, nunca desde DATABASE_URL.
export const poolTest = new Pool({
  connectionString: process.env.TEST_DATABASE_URL,
  ssl: usarSSL ? { rejectUnauthorized: false } : false
});

// El servidor de la aplicación bajo prueba (proceso hijo, ver servidorTest.js)
// también tiene que conectarse a la base de pruebas -- se le pasa
// TEST_DATABASE_URL como SU PROPIO DATABASE_URL, y el resto del entorno
// queda igual (JWT_SECRET, etc. sí pueden ser los mismos de siempre).
export function envParaServidorDePrueba() {
  return { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL };
}
