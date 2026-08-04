// js/config.js
// Fase A (multi-tenant): antes leía config/company.json, un archivo estático
// (un despliegue = una empresa). Ahora branding + módulos habilitados salen
// de la base de datos, scoped a la empresa activa del usuario logueado --
// se piden a GET /api/empresa/actual una vez que hay sesión. Sin sesión
// (ej. pages/login.html antes de loguearse) no hay empresa que resolver, así
// que se devuelve el default sin tocar la red -- apiBaseUrl es la única
// pieza que sigue disponible siempre porque ahora es una constante fija
// (ver js/apiConfig.js), no algo que dependa de la empresa.
//
// Se cachea en memoria porque no cambia durante la sesión y varias páginas/
// funciones lo consultan (sidebar, branding, título de la pestaña, etc.).

import { API_BASE_URL } from './apiConfig.js';
import { haySesionActiva, obtenerSesion } from './sesion.js';

const CONFIG_POR_DEFECTO = {
  bizName: 'Mi proyecto de datos',
  logo: 'PD',
  apiBaseUrl: API_BASE_URL,
  modules: []
};

let cache = null;

export async function cargarConfigEmpresa() {
  if (cache) return cache;

  if (!haySesionActiva()) {
    cache = CONFIG_POR_DEFECTO;
    return cache;
  }

  try {
    const token = obtenerSesion()?.token;
    const res = await fetch(`${API_BASE_URL}/empresa/actual`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache = { ...CONFIG_POR_DEFECTO, ...json };
  } catch (err) {
    console.warn('No se pudo cargar la información de la empresa, usando valores por defecto.', err);
    cache = CONFIG_POR_DEFECTO;
  }
  return cache;
}

export function modulosHabilitados(config) {
  return (config.modules || []).filter(m => m.enabled);
}

export function buscarModulo(config, id) {
  return (config.modules || []).find(m => m.id === id) || null;
}
