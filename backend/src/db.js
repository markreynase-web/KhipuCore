// src/db.js
// Pool de conexiones a PostgreSQL. `pg` maneja la reconexión y el pooling solo;
// no hay que abrir/cerrar conexión a mano en cada ruta.
//
// SSL: Supabase (y la mayoría de proveedores administrados: Neon, Railway...)
// exige conexión con SSL. rejectUnauthorized:false porque Supabase usa un
// certificado de una CA que Node no trae en su lista por defecto; el propio
// proveedor ya te da la conexión sobre una red segura, así que esto es lo
// mismo que recomienda la documentación de Supabase para node-postgres.
// Para Postgres local sin SSL, deja PGSSL=false en tu .env.

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error(
    'Falta DATABASE_URL en el archivo .env. Copia .env.example a .env y complétalo ' +
    'con los datos de tu PostgreSQL antes de arrancar el servidor.'
  );
}

const usarSSL = process.env.PGSSL !== 'false';

// Hardening del pool (Fase 3, Eje A -- Escalabilidad): antes de esto, los
// tres parámetros de abajo corrían con los defaults de `pg`, sin que nadie
// los hubiera decidido a propósito. El más riesgoso era
// connectionTimeoutMillis en su default (0 = espera indefinida): si las
// `max` conexiones del pool estaban todas ocupadas, una request nueva se
// quedaba colgada esperando una libre en vez de fallar rápido con un error
// legible -- bajo carga real, eso se siente como "el backend no responde",
// no como un error claro.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usarSSL ? { rejectUnauthorized: false } : false,
  // Tamaño del pool parametrizable por entorno -- sin DB_POOL_MAX en el
  // .env, se mantiene el mismo valor que ya traía el default de `pg` (10),
  // así que esto no cambia el comportamiento actual, solo lo hace ajustable
  // sin tocar código si el plan de Postgres del hosting cambia.
  max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  // Cuánto puede quedar una conexión ociosa en el pool antes de cerrarse.
  idleTimeoutMillis: 10000,
  // Fail-fast: si no hay una conexión libre en 5s, se rechaza la request
  // con un error claro en vez de dejarla esperando indefinidamente.
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  // Un error async en un cliente ocioso del pool no debe tumbar el proceso.
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});
