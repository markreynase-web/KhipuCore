// js/api.js
// Cliente HTTP genérico: habla con /api/{modulo} para cualquier módulo
// (ventas, inventario, clientes...). Toda función que falla (red caída,
// backend apagado, error del servidor) devuelve null en vez de lanzar,
// así el resto de la app puede caer a modo local sin romperse.

import { obtenerSesion } from './sesion.js';

function headerAuth() {
  const sesion = obtenerSesion();
  return sesion?.token ? { Authorization: `Bearer ${sesion.token}` } : {};
}

// Guarda el mensaje del último error de escritura (crear/editar/borrar) para
// que quien llamó pueda mostrarlo tal cual viene del backend -- ej. "Stock
// insuficiente: quedan 3 unidad(es) de Plumones". listarRegistros() sigue
// devolviendo null en silencio (así el modo local sigue funcionando si el
// backend está apagado), pero crear/editar necesitan el motivo exacto.
let ultimoError = null;
export function ultimoErrorAPI() {
  return ultimoError;
}

async function pedirJSON(baseUrl, path, opciones = {}) {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...headerAuth() },
      ...opciones
    });
    if (!res.ok) {
      const cuerpo = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('Tu sesión venció o no has iniciado sesión. Vuelve a entrar.');
      if (res.status === 403) throw new Error(cuerpo.error || 'No tienes permiso para esto.');
      throw new Error(cuerpo.error || `HTTP ${res.status}`);
    }
    ultimoError = null;
    if (res.status === 204) return true;
    return await res.json();
  } catch (err) {
    ultimoError = err.message;
    console.warn(`API ${path} no disponible:`, err.message);
    return null;
  }
}

export async function backendDisponible(baseUrl) {
  const r = await pedirJSON(baseUrl, '/salud');
  return !!r;
}

export function listarRegistros(baseUrl, modulo, { desde, hasta } = {}) {
  const qs = new URLSearchParams();
  if (desde) qs.set('desde', desde);
  if (hasta) qs.set('hasta', hasta);
  const query = qs.toString() ? `?${qs}` : '';
  return pedirJSON(baseUrl, `/${modulo}${query}`);
}

// Buscar-mientras-escribís (ver componentes/comboboxBusqueda.js): a
// diferencia de listarRegistros(), que trae todo el módulo, esto pide al
// backend solo lo que coincide con `termino` (ver ?buscar= en
// crudFactory.js) -- pensado para módulos con cientos/miles de filas donde
// cargar todo al frontend para filtrar en JS ya no escala.
export function buscarRegistros(baseUrl, modulo, termino, limite = 20) {
  const qs = new URLSearchParams({ buscar: termino, limite: String(limite) });
  return pedirJSON(baseUrl, `/${modulo}?${qs}`);
}

export function crearRegistro(baseUrl, modulo, datos) {
  return pedirJSON(baseUrl, `/${modulo}`, { method: 'POST', body: JSON.stringify(datos) });
}

export function actualizarRegistro(baseUrl, modulo, id, datos) {
  return pedirJSON(baseUrl, `/${modulo}/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
}

export function eliminarRegistro(baseUrl, modulo, id) {
  return pedirJSON(baseUrl, `/${modulo}/${id}`, { method: 'DELETE' });
}

export async function importarCSV(baseUrl, modulo, file) {
  const formData = new FormData();
  formData.append('archivo', file);
  try {
    const res = await fetch(`${baseUrl}/${modulo}/import`, { method: 'POST', body: formData, headers: headerAuth() });
    const cuerpo = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(cuerpo.error || `HTTP ${res.status}`);
    return cuerpo;
  } catch (err) {
    console.warn('Import CSV al backend falló:', err.message);
    return null;
  }
}
