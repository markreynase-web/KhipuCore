// src/routes/auth.js
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { auth } from '../middleware/auth.js';

const router = Router();
const DURACION_TOKEN = '8h';
// El freeze de 8h de DURACION_TOKEN no solo congela los permisos (ver la
// nota de trade-off en middleware/permisos.js) -- desde Fase A también
// congela la EMPRESA activa: a alguien removido de una empresa a media
// sesión le sigue funcionando el acceso a esos datos hasta por 8h, o hasta
// que vuelva a iniciar sesión. Aceptado como trade-off de Fase A; si algún
// día hace falta revocar al instante, la alternativa es una tabla de
// tokens invalidados o acortar este valor.
const DURACION_PREAUTH = '5m';

// Junta el rol y la lista de permisos que tiene un usuario DENTRO de una
// empresa concreta (join usuario_empresa → roles → rol_permiso → permisos).
// Se usa al hacer login para "congelar" los permisos dentro del JWT -- ver
// la nota de trade-off en middleware/permisos.js. A partir de Fase A el rol
// ya no es un atributo global del usuario (usuarios.rol_id) sino de su
// membresía a esa empresa (usuario_empresa.rol_id), porque una misma
// persona puede tener roles distintos en cada empresa a la que pertenece.
async function permisosDeUsuario(usuarioId, empresaId) {
  const { rows } = await pool.query(
    `SELECT r.nombre AS rol, COALESCE(array_agg(p.nombre) FILTER (WHERE p.nombre IS NOT NULL), '{}') AS permisos
     FROM usuario_empresa ue
     JOIN roles r ON r.id = ue.rol_id
     LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
     LEFT JOIN permisos p ON p.id = rp.permiso_id
     WHERE ue.usuario_id = $1 AND ue.empresa_id = $2
     GROUP BY r.nombre`,
    [usuarioId, empresaId]
  );
  return rows[0] || { rol: null, permisos: [] };
}

// Firma el token completo de una sesión ya resuelta a UNA empresa concreta
// (ya sea porque el usuario solo pertenece a una, o porque acaba de
// elegirla en /login/empresa).
async function firmarSesion(usuario, empresaId, empresaNombre) {
  const { rol, permisos } = await permisosDeUsuario(usuario.id, empresaId);
  const payload = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    empresa_id: empresaId,
    empresa_nombre: empresaNombre,
    rol,
    permisos
  };
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: DURACION_TOKEN });
  return { token, usuario: payload };
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

    // "Login inteligente": la identidad (usuarios) es global, la empresa
    // activa sale de a qué empresas pertenece ese usuario (usuario_empresa).
    const { rows: membresias } = await pool.query(
      `SELECT ue.empresa_id, e.nombre AS empresa_nombre
       FROM usuario_empresa ue
       JOIN empresas e ON e.id = ue.empresa_id
       WHERE ue.usuario_id = $1 AND ue.activo = true AND e.activo = true
       ORDER BY e.nombre`,
      [usuario.id]
    );

    if (!membresias.length) {
      return res.status(401).json({ error: 'Tu usuario no está asociado a ninguna empresa activa.' });
    }

    if (membresias.length === 1) {
      const sesion = await firmarSesion(usuario, membresias[0].empresa_id, membresias[0].empresa_nombre);
      return res.json(sesion);
    }

    // Más de una empresa: no se firma el token completo todavía. Se manda
    // un preAuthToken de corta duración (prueba de que el password ya se
    // validó, sin repetir el login) + la lista para que el frontend
    // muestre el selector.
    const preAuthToken = jwt.sign({ id: usuario.id, tipo: 'preauth' }, process.env.JWT_SECRET, { expiresIn: DURACION_PREAUTH });
    res.json({
      requiereSeleccionEmpresa: true,
      preAuthToken,
      empresas: membresias.map(m => ({ id: m.empresa_id, nombre: m.empresa_nombre }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

// Segundo paso del login para usuarios con más de una empresa. El
// empresa_id que manda el cliente NUNCA se confía a ciegas -- se revalida
// server-side contra usuario_empresa antes de firmar el token real.
router.post('/login/empresa', async (req, res) => {
  const { preAuthToken, empresa_id } = req.body || {};
  if (!preAuthToken || !empresa_id) {
    return res.status(400).json({ error: 'preAuthToken y empresa_id son requeridos.' });
  }

  let payload;
  try {
    payload = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    if (payload.tipo !== 'preauth') throw new Error('tipo inválido');
  } catch (err) {
    return res.status(401).json({ error: 'Selección de empresa vencida. Inicia sesión de nuevo.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.nombre, u.email, e.id AS empresa_id, e.nombre AS empresa_nombre
       FROM usuario_empresa ue
       JOIN usuarios u ON u.id = ue.usuario_id
       JOIN empresas e ON e.id = ue.empresa_id
       WHERE ue.usuario_id = $1 AND ue.empresa_id = $2 AND ue.activo = true AND u.activo = true AND e.activo = true`,
      [payload.id, empresa_id]
    );
    if (!rows.length) return res.status(403).json({ error: 'No perteneces a esa empresa.' });

    const fila = rows[0];
    const sesion = await firmarSesion(fila, fila.empresa_id, fila.empresa_nombre);
    res.json(sesion);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo completar el inicio de sesión.' });
  }
});

// Protegida con auth(): sirve para que el frontend confirme que el token
// sigue siendo válido, y es la primera ruta que de verdad usa el middleware.
router.get('/me', auth, (req, res) => {
  res.json({ usuario: req.usuario });
});

export default router;
