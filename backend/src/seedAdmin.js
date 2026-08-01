// src/seedAdmin.js
// No hay pantalla de "Crear cuenta" a propósito: quien instala el sistema
// crea el primer usuario admin desde la terminal, y ese admin es quien
// después da de alta a los demás (eso llega con Roles/Permisos).
//
// Uso: npm run seed:admin -- "Nombre Apellido" correo@ejemplo.com contraseña
// Si el email ya existe, actualiza su nombre y contraseña (útil para resetear
// la clave del admin si la olvidas).

import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function main() {
  const [, , nombre, email, password] = process.argv;
  if (!nombre || !email || !password) {
    console.error('Uso: npm run seed:admin -- "Nombre Apellido" correo@ejemplo.com contraseña');
    process.exitCode = 1;
    return;
  }
  if (password.length < 6) {
    console.error('La contraseña debe tener al menos 6 caracteres.');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows: rolRows } = await pool.query(`SELECT id FROM roles WHERE nombre = 'administrador'`);
  if (!rolRows.length) {
    console.error('No existe el rol "administrador". Corre "npm run migrate" primero (migración 005).');
    process.exitCode = 1;
    return;
  }
  const { rows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, rol_id)
     VALUES ($1, $2, $3, 'administrador', $4)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash, rol_id = EXCLUDED.rol_id
     RETURNING id, nombre, email, rol`,
    [nombre, email, hash, rolRows[0].id]
  );
  console.log('Usuario administrador listo:', rows[0]);
}

main()
  .catch(err => { console.error('Error creando el usuario:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
