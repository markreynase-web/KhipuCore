// src/routes/usuarios.js
// Gestión de cuentas y roles (Fase 4). No usa crudFactory porque el manejo
// de contraseñas es distinto (hay que hashear, y nunca se devuelve el hash).
// Sigue el mismo pipeline: auth() → verificarPermiso('usuarios.xxx').

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';

const router = Router();
router.use(auth);

// GET /api/usuarios/roles -> lista de roles con sus permisos (para el
// formulario "Nuevo usuario" y para una futura pantalla de "editar rol").
router.get('/roles', verificarPermiso('usuarios.ver'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.id, r.nombre,
              COALESCE(array_agg(p.nombre) FILTER (WHERE p.nombre IS NOT NULL), '{}') AS permisos
       FROM roles r
       LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
       LEFT JOIN permisos p ON p.id = rp.permiso_id
       GROUP BY r.id, r.nombre
       ORDER BY r.id`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los roles.' });
  }
});

// GET /api/usuarios
router.get('/', verificarPermiso('usuarios.ver'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, u.activo, u.creado_el
       FROM usuarios u JOIN roles r ON r.id = u.rol_id
       ORDER BY u.nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los usuarios.' });
  }
});

// POST /api/usuarios  { nombre, email, password, rol }
router.post('/', verificarPermiso('usuarios.crear'), async (req, res) => {
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: 'Nombre, email, contraseña y rol son requeridos.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

  try {
    const { rows: rolRows } = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
    if (!rolRows.length) return res.status(400).json({ error: `El rol "${rol}" no existe.` });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, rol_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, email, rol, activo`,
      [nombre, email, hash, rol, rolRows[0].id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

// PUT /api/usuarios/:id  { nombre?, rol?, activo? }  (cambio de rol, desactivar, etc.)
router.put('/:id', verificarPermiso('usuarios.editar'), async (req, res) => {
  const { nombre, rol, activo } = req.body || {};
  try {
    let rolId = null;
    if (rol) {
      const { rows: rolRows } = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
      if (!rolRows.length) return res.status(400).json({ error: `El rol "${rol}" no existe.` });
      rolId = rolRows[0].id;
    }
    const { rows } = await pool.query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         rol = COALESCE($2, rol),
         rol_id = COALESCE($3, rol_id),
         activo = COALESCE($4, activo),
         actualizado_el = now()
       WHERE id = $5
       RETURNING id, nombre, email, rol, activo`,
      [nombre || null, rol || null, rolId, activo === undefined ? null : activo, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el usuario.' });
  }
});

export default router;
