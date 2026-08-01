// src/middleware/permisos.js
// Segunda pieza del pipeline: Cliente → JWT → auth() → verificarPermiso() →
// CRUD Factory → PostgreSQL.
//
// auth() ya validó el token y dejó req.usuario = { id, nombre, email, rol,
// permisos: ['ventas.ver', 'ventas.crear', ...] } (los permisos se calculan
// una vez, al hacer login, con el join roles → rol_permiso → permisos; ver
// routes/auth.js). Aquí solo se pregunta si ese permiso concreto está en la
// lista -- nada de "if (usuario.rol == 'admin')" repetido en cada ruta.
//
// Nota de diseño: los permisos viajan dentro del JWT, no se consultan de
// nuevo a la base de datos en cada request. Ventaja: cero costo extra por
// request. Costo: si un admin le quita un permiso a un rol, a alguien ya
// logueado con ese rol le sigue funcionando hasta que su token expire (8h)
// o vuelva a iniciar sesión. Para este tamaño de cliente es un trade-off
// razonable; si algún día hace falta revocar al instante, la alternativa es
// consultar rol_permiso en cada request (o mantener una lista de tokens
// invalidados).

export function verificarPermiso(permisoRequerido) {
  return (req, res, next) => {
    const permisos = (req.usuario && req.usuario.permisos) || [];
    if (!permisos.includes(permisoRequerido)) {
      return res.status(403).json({
        error: `No tienes permiso para esto (${permisoRequerido}).`
      });
    }
    next();
  };
}
