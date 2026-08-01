// js/config.js
// Carga config/company.json (nombre de la empresa, logo, y qué módulos tiene
// habilitados esta empresa). Es la pieza central de la Fase 2: para dar de alta
// o de baja un módulo a un cliente, o cambiar su branding, se edita SOLO este
// archivo — no hace falta tocar HTML/JS/CSS.
//
// Se cachea en memoria porque no cambia durante la sesión y varias páginas/
// funciones lo consultan (nav, branding, título de la pestaña, etc.).

const CONFIG_POR_DEFECTO = {
  bizName: 'Mi proyecto de datos',
  logo: 'PD',
  modules: []
};

let cache = null;

export async function cargarConfigEmpresa() {
  if (cache) return cache;
  try {
    // Las páginas viven en /pages/, config.json vive en /config/, un nivel arriba.
    const res = await fetch('../config/company.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache = { ...CONFIG_POR_DEFECTO, ...json };
  } catch (err) {
    console.warn('No se pudo cargar config/company.json, usando valores por defecto.', err);
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
