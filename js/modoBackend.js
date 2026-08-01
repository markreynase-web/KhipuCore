// js/modoBackend.js
// Activa, solo para los módulos marcados con "baseDeDatos": true en
// config/company.json, el modo "conectado a base de datos real": las
// filas vienen de la API (PostgreSQL) en vez de un CSV subido a mano o
// de localStorage. Si el backend no responde, quien lo llama debe dejar
// la página tal como estaba en modo local (Fase 1/2) — este módulo nunca
// rompe nada, solo devuelve null cuando no puede conectarse.
//
// La transformación de abajo reutiliza el motor de render existente
// (dashboard.js / charts.js / filters.js) tal cual: fabricamos el mismo
// { filas, mapa, stats, cols } que ya arma parsing.js para un CSV, usando
// el "mapa" declarado en el esquema de cada módulo (js/esquemas.js).

import { listarRegistros, crearRegistro, actualizarRegistro, eliminarRegistro, importarCSV, backendDisponible, ultimoErrorAPI } from './api.js';
import { ESQUEMAS } from './esquemas.js';

function transformarFilasApi(filasApi, mapa) {
  return filasApi.map(r => {
    const fila = {
      _fecha: r[mapa.colFecha] ? String(r[mapa.colFecha]).slice(0, 10) : null,
      _numero: r[mapa.colNum] !== null && r[mapa.colNum] !== undefined ? Number(r[mapa.colNum]) : NaN,
      _cat1: r[mapa.colCat1] || 'Sin dato',
      _cat2: mapa.colCat2 ? (r[mapa.colCat2] || 'Sin dato') : 'Sin dato',
      _extra: {},
      _extraCat: {},
      _id: r.id
    };
    (mapa.otrosNum || []).forEach(c => { fila._extra[c] = Number(r[c]); });
    (mapa.otrasCat || []).forEach(c => { fila._extraCat[c] = r[c] || 'Sin dato'; });
    return fila;
  });
}

export async function iniciarModoBackend({ baseUrl, moduloId, onError }) {
  const esquema = ESQUEMAS[moduloId];
  if (!esquema) return null;

  const ok = await backendDisponible(baseUrl);
  if (!ok) {
    onError(`No se pudo conectar con el servidor (${baseUrl}). Revisa que el backend esté corriendo (npm run dev en /backend) y que apunte a tu PostgreSQL.`);
    return null;
  }

  return {
    esquema,
    async obtenerFuente(filtros) {
      const filasApi = await listarRegistros(baseUrl, moduloId, filtros);
      if (!filasApi) return null;
      return { filas: transformarFilasApi(filasApi, esquema.mapa), mapa: esquema.mapa, stats: null, cols: esquema.mapa && esquema.columnasTabla.map(c => c.key) };
    },
    async listarCrudo(filtros) {
      return (await listarRegistros(baseUrl, moduloId, filtros)) || [];
    },
    registrar: (datos) => crearRegistro(baseUrl, moduloId, datos),
    actualizar: (id, datos) => actualizarRegistro(baseUrl, moduloId, id, datos),
    borrar: (id) => eliminarRegistro(baseUrl, moduloId, id),
    importarCSV: (file) => importarCSV(baseUrl, moduloId, file),
    ultimoError: ultimoErrorAPI,
    // Para poblar selects (ej. productos/clientes en el formulario de Ventas)
    // con datos frescos de OTRO módulo, no solo del propio.
    listarDeModulo: (otroModulo, filtros) => listarRegistros(baseUrl, otroModulo, filtros)
  };
}
