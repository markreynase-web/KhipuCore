// src/seedSuperAdmin.js
// Igual que seedAdmin.js, pero para el panel de super administrador
// (huevo-y-gallina: para crear un super admin desde la API hace falta ya
// serlo, así que el primero se crea siempre desde la terminal).
//
// Uso: npm run seed:superadmin -- "Nombre Apellido" correo@ejemplo.com contraseña

import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function main() {
  const [, , nombre, email, password] = process.argv;
  if (!nombre || !email || !password) {
    console.error('Uso: npm run seed:superadmin -- "Nombre Apellido" correo@ejemplo.com contraseña');
    process.exitCode = 1;
    return;
  }
  if (password.length < 6) {
    console.error('La contraseña debe tener al menos 6 caracteres.');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, es_super_admin)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash, es_super_admin = true
     RETURNING id, nombre, email`,
    [nombre, email, hash]
  );
  console.log('Super admin listo:', rows[0]);
}

main()
  .catch(err => { console.error('Error creando el super admin:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
