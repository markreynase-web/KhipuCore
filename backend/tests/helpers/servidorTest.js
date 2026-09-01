// tests/helpers/servidorTest.js
// Arranca una instancia REAL de la API (node src/server.js) en un proceso
// hijo, sobre un puerto propio de test, conectada EXCLUSIVAMENTE a
// TEST_DATABASE_URL (nunca a la base de producción/desarrollo) -- ver
// envParaServidorDePrueba() más abajo y el guardia fail-closed en testDb.js.
//
// Se elige un proceso hijo en vez de importar server.js directo a propósito:
// server.js llama a app.listen() al cargarse, sin exportar `app` por
// separado -- importarlo como módulo dispararía un listen real imposible de
// aislar por test. Spawnear el mismo comando que ya usa "npm start" evita
// tocar server.js para hacerlo testeable (menos cambios).
//
// El proceso hijo recibe envParaServidorDePrueba() (ver testDb.js), NUNCA
// process.env tal cual -- así la propia API bajo prueba también queda
// conectada a TEST_DATABASE_URL, no a la base de producción. Importar
// testDb.js acá además hace que ARRANCAR un servidor de test, por sí solo,
// ya dispare el guardia fail-closed.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { envParaServidorDePrueba } from './testDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ_BACKEND = path.join(__dirname, '..', '..');

// `node --test` corre cada archivo en un proceso propio -- un contador de
// puerto estático (ej. "let siguientePuerto = 3097") arranca en el mismo
// valor en cada proceso y puede colisionar (EADDRINUSE) si dos archivos
// llaman a iniciarServidorTest() casi al mismo tiempo. Pedirle un puerto
// libre al sistema operativo (bind a :0, leer el puerto real, soltarlo) es
// la única forma de que sea único de verdad entre procesos concurrentes.
function puertoLibre() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export async function iniciarServidorTest() {
  const port = await puertoLibre();
  const baseUrl = `http://127.0.0.1:${port}`;

  const proceso = spawn(process.execPath, ['src/server.js'], {
    cwd: RAIZ_BACKEND,
    env: { ...envParaServidorDePrueba(), PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let salidaError = '';
  proceso.stderr.on('data', (chunk) => { salidaError += chunk.toString(); });

  const maxIntentos = 60; // ~15s
  for (let intento = 0; intento < maxIntentos; intento++) {
    if (proceso.exitCode !== null) {
      throw new Error(`El servidor de test terminó antes de levantar (código ${proceso.exitCode}):\n${salidaError}`);
    }
    try {
      const r = await fetch(`${baseUrl}/api/salud`);
      if (r.ok) {
        return {
          baseUrl,
          detener: () => new Promise((resolve) => {
            proceso.once('exit', resolve);
            proceso.kill();
          })
        };
      }
    } catch {
      // todavía no levantó -- reintenta
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  proceso.kill();
  throw new Error(`El servidor de test no respondió /api/salud a tiempo.\n${salidaError}`);
}
