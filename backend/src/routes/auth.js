// src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';

const router = Router();
const DURACION_TOKEN = '8h';

// Junta el rol y la lista de permisos de un usuario (join roles → rol_permiso
// → permisos). Se usa al hacer login para "congelar" los permisos dentro del
// JWT -- ver la nota de trade-off en middleware/permisos.js.
async function permisosDeUsuario(usuario) {
  const { rows } = await pool.query(
    `SELECT r.nombre AS rol, COALESCE(array_agg(p.nombre) FILTER (WHERE p.nombre IS NOT NULL), '{}') AS permisos
     FROM usuarios u
     JOIN roles r ON r.id = u.rol_id
     LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
     LEFT JOIN permisos p ON p.id = rp.permiso_id
     WHERE u.id = $1
     GROUP BY r.nombre`,
    [usuario.id]
  );
  return rows[0] || { rol: usuario.rol, permisos: [] };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña son requeridos.' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM usuarios WHERE lower(email) = lower($1) AND activo = true',
      [email]
    );
    const usuario = rows[0];
    // Mismo mensaje si el usuario no existe o si la contraseña está mal —
    // no le decimos a quien intenta entrar cuál de las dos cosas falló.
    if (!usuario) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const coincide = await bcrypt.compare(password, usuario.password_hash);
    if (!coincide) return res.status(401).json({ error: 'Email o contraseña incorrectos.' });

    const { rol, permisos } = await permisosDeUsuario(usuario);
    const payload = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol, permisos };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: DURACION_TOKEN });
    res.json({ token, usuario: payload });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

// Protegida con auth(): sirve para que el frontend confirme que el token
// sigue siendo válido, y es la primera ruta que de verdad usa el middleware.
router.get('/me', auth, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
