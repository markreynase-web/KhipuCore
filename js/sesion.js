// js/sesion.js
// Maneja el token JWT en el navegador. Se guarda en localStorage (no hay
// namespace por módulo aquí a propósito: la sesión es global, la misma
// persona navega entre Ventas/Inventario/Clientes sin volver a loguearse).

const CLAVE = 'pd_sesion';

export function guardarSesion({ token, usuario }) {
  localStorage.setItem(CLAVE, JSON.stringify({ token, usuario }));
}

export function obtenerSesion() {
  try {
    const cruda = localStorage.getItem(CLAVE);
    return cruda ? JSON.parse(cruda) : null;
  } catch {
    return null;
  }
}

export function cerrarSesion() {
  localStorage.removeItem(CLAVE);
}

export function haySesionActiva() {
  const s = obtenerSesion();
  return !!(s && s.token);
}

// Fase 4.5 (Frontend): no basta con bloquear en el backend, también hay que
// ocultar el botón. Los permisos ya vienen calculados dentro del token desde
// el login (ver backend/src/routes/auth.js), así que esto es una consulta
// local, sin red.
export function tienePermiso(permiso) {
  const s = obtenerSesion();
  const permisos = s?.usuario?.permisos || [];
  return permisos.includes(permiso);
}

export function tieneAlgunPermiso(prefijoModulo) {
  const s = obtenerSesion();
  const permisos = s?.usuario?.permisos || [];
  return permisos.some(p => p.startsWith(`${prefijoModulo}.`));
}

// Panel de super administrador: sesión exclusiva, sin empresa_id ni
// permisos (ver backend/src/routes/auth.js) -- por eso es una consulta
// aparte, no una revisión más de `permisos`.
export function esSuperAdmin() {
  const s = obtenerSesion();
  return !!s?.usuario?.es_super_admin;
}

// Impersonación (ver POST /superadmin/empresas/:id/impersonar): una sesión
// impersonada es, para el resto del frontend, una sesión normal de empresa
// (mismo empresa_id/permisos que cualquier admin) -- lo único que la
// distingue es este flag, usado solo para el banner de aviso (ver
// components/topbar.js) y para decidir qué hace "Salir" en ese banner.
export function estaImpersonando() {
  const s = obtenerSesion();
  return !!s?.usuario?.impersonando;
}

// Al impersonar, la sesión de super admin (que no lleva empresa_id/permisos,
// ver arriba) se reemplaza por la sesión impersonada en la misma clave de
// localStorage -- no pueden convivir las dos. Se guarda una copia aparte
// antes de reemplazarla, así "Salir" (ver components/topbar.js) puede volver
// directo a Super Admin sin pedir contraseña de nuevo.
const CLAVE_BACKUP_SUPER_ADMIN = 'pd_sesion_super_admin_backup';

export function respaldarSesionSuperAdmin() {
  const actual = obtenerSesion();
  if (actual) sessionStorage.setItem(CLAVE_BACKUP_SUPER_ADMIN, JSON.stringify(actual));
}

export function restaurarSesionSuperAdmin() {
  const cruda = sessionStorage.getItem(CLAVE_BACKUP_SUPER_ADMIN);
  sessionStorage.removeItem(CLAVE_BACKUP_SUPER_ADMIN);
  if (!cruda) return false;
  try {
    localStorage.setItem(CLAVE, cruda);
    return true;
  } catch {
    return false;
  }
}

// Fase A (multi-tenant): cuando un usuario pertenece a más de una empresa,
// el login no entrega sesión de una vez -- entrega un preAuthToken de 5
// minutos + la lista de empresas para que el usuario elija. Eso NO es una
// sesión válida todavía, así que se guarda aparte, en sessionStorage (se
// pierde solo con esa pestaña, no debe sobrevivir como localStorage).
const CLAVE_PREAUTH = 'pd_preauth';

export function guardarPreAuth({ preAuthToken, empresas }) {
  sessionStorage.setItem(CLAVE_PREAUTH, JSON.stringify({ preAuthToken, empresas }));
}

export function obtenerPreAuth() {
  try {
    const cruda = sessionStorage.getItem(CLAVE_PREAUTH);
    return cruda ? JSON.parse(cruda) : null;
  } catch {
    return null;
  }
}

export function borrarPreAuth() {
  sessionStorage.removeItem(CLAVE_PREAUTH);
}
