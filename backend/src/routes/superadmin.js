// src/routes/superadmin.js
// Panel de super administrador: gestiona empresas, sus módulos habilitados,
// y su primer administrador -- reemplaza los scripts SQL manuales que se
// venían usando para dar de alta cada empresa nueva. Protegido por
// requireSuperAdmin() en vez de requireEmpresa(): estas rutas cruzan
// empresas a propósito, así que no hay (ni debe haber) scoping por
// empresa_id en ninguna consulta de este archivo.

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { auth, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();
router.use(auth, requireSuperAdmin);

router.get('/empresas', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*,
        (SELECT count(*) FROM usuario_empresa ue WHERE ue.empresa_id = e.id) AS usuarios_count,
        (SELECT count(*) FROM empresa_modulos em WHERE em.empresa_id = e.id) AS modulos_count
      FROM empresas e
      ORDER BY e.nombre
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer las empresas.' });
  }
});

router.post('/empresas', async (req, res) => {
  const { nombre, logo } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido.' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO empresas (nombre, logo) VALUES ($1, $2) RETURNING *`,
      [String(nombre).trim(), logo || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear la empresa.' });
  }
});

// color_primario: null/'' = "quitar personalización, volver al color de
// KhipuCore por defecto". A diferencia de nombre/logo/activo, un PUT que
// no lo manda debe DEJARLO IGUAL (no borrarlo) -- COALESCE no alcanza para
// eso, porque no distingue "no vino en el body" de "vino vacío a propósito
// para borrarlo"; ambos casos necesitan comportamiento distinto acá. Por
// eso se manda un flag aparte (colorProvisto) y un CASE en el UPDATE. Se
// valida el formato hex porque el frontend lo inyecta directo como valor
// de una propiedad CSS (ver aplicarTema() en js/config.js).
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

router.put('/empresas/:id', async (req, res) => {
  const { nombre, logo, activo } = req.body || {};
  const colorProvisto = Object.prototype.hasOwnProperty.call(req.body || {}, 'color_primario');
  const colorPrimario = req.body?.color_primario;
  if (colorPrimario && !HEX_COLOR.test(colorPrimario)) {
    return res.status(400).json({ error: 'color_primario debe ser un color hex válido, ej. #E3B23C.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE empresas SET
         nombre = COALESCE($1, nombre),
         logo = COALESCE($2, logo),
         activo = COALESCE($3, activo),
         color_primario = CASE WHEN $4 THEN $5 ELSE color_primario END,
         actualizado_el = now()
       WHERE id = $6
       RETURNING *`,
      [nombre || null, logo || null, activo === undefined ? null : activo, colorProvisto, colorPrimario || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empresa no encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la empresa.' });
  }
});

// Catálogo completo de módulos (para armar la lista de checkboxes en el frontend).
router.get('/modulos', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM modulos ORDER BY id`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los módulos.' });
  }
});

// Catálogo + qué está habilitado para ESA empresa puntual.
router.get('/empresas/:id/modulos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.label, m.icon, m.base_de_datos, (em.modulo_id IS NOT NULL) AS habilitado
       FROM modulos m
       LEFT JOIN empresa_modulos em ON em.modulo_id = m.id AND em.empresa_id = $1
       ORDER BY m.id`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los módulos de la empresa.' });
  }
});

router.post('/empresas/:id/modulos', async (req, res) => {
  const { modulo_id } = req.body || {};
  if (!modulo_id) return res.status(400).json({ error: 'modulo_id es requerido.' });
  try {
    await pool.query(
      `INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, modulo_id]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo habilitar el módulo.' });
  }
});

router.delete('/empresas/:id/modulos/:moduloId', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM empresa_modulos WHERE empresa_id = $1 AND modulo_id = $2`,
      [req.params.id, req.params.moduloId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo deshabilitar el módulo.' });
  }
});

// Crea (o reusa, si el email ya tiene cuenta globalmente) un usuario y lo
// vincula como administrador de esta empresa -- mismo flujo que
// seedAdmin.js, ahora disponible sin terminal. A diferencia de
// routes/usuarios.js (que rechaza un email ya existente para no vincular
// sin consentimiento a alguien fuera de contexto), aquí SÍ se reusa a
// propósito: es el super admin quien está pidiendo explícitamente "agrega
// a esta persona como admin de esta empresa", no un efecto secundario
// ambiguo de un formulario de alta común.
router.post('/empresas/:id/admin', async (req, res) => {
  const { nombre, email, password } = req.body || {};
  if (!nombre || !email) return res.status(400).json({ error: 'nombre y email son requeridos.' });

  try {
    const { rows: rolAdmin } = await pool.query(`SELECT id FROM roles WHERE nombre = 'administrador'`);
    if (!rolAdmin.length) return res.status(500).json({ error: 'No existe el rol administrador (¿corriste las migraciones?).' });

    const { rows: existentes } = await pool.query(`SELECT id FROM usuarios WHERE lower(email) = lower($1)`, [email]);
    let usuarioId;
    if (existentes.length) {
      usuarioId = existentes[0].id;
    } else {
      if (!password || password.length < 6) {
        return res.status(400).json({ error: 'password es requerido (mínimo 6 caracteres) para crear una cuenta nueva.' });
      }
      const hash = await bcrypt.hash(password, 10);
      const { rows: nuevo } = await pool.query(
        `INSERT INTO usuarios (nombre, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
        [nombre, email, hash]
      );
      usuarioId = nuevo[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id, empresa_id) DO UPDATE SET rol_id = EXCLUDED.rol_id, activo = true
       RETURNING usuario_id, empresa_id`,
      [usuarioId, req.params.id, rolAdmin[0].id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo crear el administrador de la empresa.' });
  }
});

export default router;
