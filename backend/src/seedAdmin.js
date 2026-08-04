// src/seedAdmin.js
// No hay pantalla de "Crear cuenta" a propósito: quien instala el sistema
// crea el primer usuario admin desde la terminal, y ese admin es quien
// después da de alta a los demás (eso llega con Roles/Permisos).
//
// Uso: npm run seed:admin -- "Nombre Apellido" correo@ejemplo.com contraseña ["Nombre de la empresa"]
// Si el email ya existe, actualiza su nombre y contraseña (útil para resetear
// la clave del admin si la olvidas).
//
// Fase A (multi-tenant): el admin ya no solo se crea en usuarios -- también
// necesita una membresía en usuario_empresa. Si no se indica el nombre de
// empresa, reusa la primera que exista (la migración 012 siempre deja al
// menos una, la empresa semilla); si no hay ninguna, la crea.

import bcrypt from 'bcryptjs';
import { pool } from './db.js';

async function main() {
  const [, , nombre, email, password, nombreEmpresa] = process.argv;
  if (!nombre || !email || !password) {
    console.error('Uso: npm run seed:admin -- "Nombre Apellido" correo@ejemplo.com contraseña ["Nombre de la empresa"]');
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

  let empresa;
  if (nombreEmpresa) {
    // empresas.nombre no tiene constraint UNIQUE (una empresa real sí podría
    // llamarse igual que otra), así que el "reusar si existe" se resuelve
    // con un SELECT primero en vez de ON CONFLICT.
    const { rows: existentes } = await pool.query('SELECT id, nombre FROM empresas WHERE nombre = $1 LIMIT 1', [nombreEmpresa]);
    if (existentes.length) {
      empresa = existentes[0];
    } else {
      const creada = await pool.query('INSERT INTO empresas (nombre) VALUES ($1) RETURNING id, nombre', [nombreEmpresa]);
      empresa = creada.rows[0];
    }
  } else {
    const { rows } = await pool.query('SELECT id, nombre FROM empresas ORDER BY id LIMIT 1');
    if (rows.length) {
      empresa = rows[0];
    } else {
      const creada = await pool.query(
        `INSERT INTO empresas (nombre) VALUES ('Mi proyecto de datos') RETURNING id, nombre`
      );
      empresa = creada.rows[0];
    }
  }

  const { rows: usuarioRows } = await pool.query(
    `INSERT INTO usuarios (nombre, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre, password_hash = EXCLUDED.password_hash
     RETURNING id, nombre, email`,
    [nombre, email, hash]
  );
  const usuario = usuarioRows[0];

  await pool.query(
    `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET rol_id = EXCLUDED.rol_id, activo = true`,
    [usuario.id, empresa.id, rolRows[0].id]
  );

  console.log('Usuario administrador listo:', { ...usuario, empresa: empresa.nombre, rol: 'administrador' });
}

main()
  .catch(err => { console.error('Error creando el usuario:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
