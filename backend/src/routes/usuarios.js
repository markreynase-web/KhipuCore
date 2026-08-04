// src/routes/usuarios.js
// Gestión de cuentas y roles (Fase 4). No usa crudFactory porque el manejo
// de contraseñas es distinto (hay que hashear, y nunca se devuelve el hash).
// Sigue el mismo pipeline: auth() → requireEmpresa() → verificarPermiso('usuarios.xxx').
//
// Fase A (multi-tenant): la identidad (usuarios) es global, pero "ser
// usuario de esta empresa" y "qué rol tiene aquí" viven en usuario_empresa.
// Por eso esta pantalla ya no lee/escribe usuarios.rol/rol_id directo --
// opera sobre la membresía scoped a req.usuario.empresa_id.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';

const router = Router();
router.use(auth, requireEmpresa);

// GET /api/usuarios/roles -> lista de roles con sus permisos (para el
// formulario "Nuevo usuario" y para una futura pantalla de "editar rol").
// roles/permisos son globales (misma lista para todas las empresas), no
// necesita scoping.
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

// GET /api/usuarios -- solo los miembros de la empresa activa.
router.get('/', verificarPermiso('usuarios.ver'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, ue.activo, u.creado_el
       FROM usuario_empresa ue
       JOIN usuarios u ON u.id = ue.usuario_id
       JOIN roles r ON r.id = ue.rol_id
       WHERE ue.empresa_id = $1
       ORDER BY u.nombre`,
      [req.usuario.empresa_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los usuarios.' });
  }
});

// POST /api/usuarios  { nombre, email, password, rol }
// Si el email ya tiene cuenta (en esta empresa o en otra), se rechaza en vez
// de vincularlo en silencio -- sin un flujo de invitación por correo (fuera
// de alcance de Fase A), auto-vincular dejaría que el admin de una empresa
// "adopte" sin consentimiento la cuenta de alguien que ya trabaja en otra.
router.post('/', verificarPermiso('usuarios.crear'), async (req, res) => {
  const { nombre, email, password, rol } = req.body || {};
  if (!nombre || !email || !password || !rol) {
    return res.status(400).json({ error: 'Nombre, email, contraseña y rol son requeridos.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });

  try {
    const { rows: existente } = await pool.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [email]);
    if (existente.length) {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese email. Pídele a esa persona que te comparta acceso, o contacta soporte para vincularla a tu empresa.' });
    }

    const { rows: rolRows } = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
    if (!rolRows.length) return res.status(400).json({ error: `El rol "${rol}" no existe.` });

    const hash = await bcrypt.hash(password, 10);
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows: nuevoUsuario } = await cliente.query(
        `INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id, nombre, email`,
        [nombre, email, hash]
      );
      await cliente.query(
        `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES ($1, $2, $3)`,
        [nuevoUsuario[0].id, req.usuario.empresa_id, rolRows[0].id]
      );
      await cliente.query('COMMIT');
      res.status(201).json({ ...nuevoUsuario[0], rol, activo: true });
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw err;
    } finally {
      cliente.release();
    }
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un usuario con ese email.' });
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

// PUT /api/usuarios/:id  { nombre?, rol?, activo? }
// :id es el id de usuarios (identidad global). rol/activo se editan en la
// membresía (usuario_empresa) scoped a la empresa activa -- así un admin de
// la empresa A no puede tocar el rol que esa persona tiene en la empresa B.
// nombre sigue siendo un campo global de la identidad (mismo nombre se ve
// en todas las empresas donde participa esa persona) -- trade-off aceptado
// para Fase A.
router.put('/:id', verificarPermiso('usuarios.editar'), async (req, res) => {
  const { nombre, rol, activo } = req.body || {};
  const empresaId = req.usuario.empresa_id;
  try {
    let rolId = null;
    if (rol) {
      const { rows: rolRows } = await pool.query('SELECT id FROM roles WHERE nombre = $1', [rol]);
      if (!rolRows.length) return res.status(400).json({ error: `El rol "${rol}" no existe.` });
      rolId = rolRows[0].id;
    }

    const { rows: membresia } = await pool.query(
      `UPDATE usuario_empresa SET
         rol_id = COALESCE($1, rol_id),
         activo = COALESCE($2, activo)
       WHERE usuario_id = $3 AND empresa_id = $4
       RETURNING usuario_id, rol_id, activo`,
      [rolId, activo === undefined ? null : activo, req.params.id, empresaId]
    );
    if (!membresia.length) return res.status(404).json({ error: 'Usuario no encontrado en esta empresa.' });

    if (nombre) {
      await pool.query(`UPDATE usuarios SET nombre = $1, actualizado_el = now() WHERE id = $2`, [nombre, req.params.id]);
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, r.nombre AS rol, ue.activo
       FROM usuario_empresa ue
       JOIN usuarios u ON u.id = ue.usuario_id
       JOIN roles r ON r.id = ue.rol_id
       WHERE ue.usuario_id = $1 AND ue.empresa_id = $2`,
      [req.params.id, empresaId]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el usuario.' });
  }
});

export default router;
