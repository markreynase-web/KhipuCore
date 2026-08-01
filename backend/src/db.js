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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usarSSL ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  // Un error async en un cliente ocioso del pool no debe tumbar el proceso.
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});
