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
