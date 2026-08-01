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
