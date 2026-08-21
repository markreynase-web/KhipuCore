// js/tratamientosDashboard.js
// Dashboard bespoke de Tratamientos (vertical Dentista): historial clínico +
// facturación por procedimiento. KPIs reales (este mes vs. planificados),
// lista cronológica y ranking de procedimientos más frecuentes -- sin
// gráfico de "odontograma" gráfico (no existe esa UI todavía, ver nota en
// la migración 020_dentista.sql).

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  planificado: { texto: 'Planificado', color: 'muted' },
  en_progreso: { texto: 'En progreso', color: 'blue' },
  completado: { texto: 'Completado', color: 'teal' },
  cancelado: { texto: 'Cancelado', color: 'danger' }
};

let tratamientosCache = [];

export function renderTratamientosDashboard(filasCrudas) {
  tratamientosCache = filasCrudas || [];
  dibujar();
}

function esteMes(fechaStr) {
  if (!fechaStr) return false;
  const hoy = new Date();
  const f = new Date(fechaStr);
  return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
}

function dibujar() {
  dibujarKpis();
  dibujarLista();
  dibujarRankingProcedimientos();
}

function dibujarKpis() {
  const delMes = tratamientosCache.filter(t => esteMes(t.fecha));
  const enProgreso = tratamientosCache.filter(t => t.estado === 'en_progreso').length;
  const facturadoMes = delMes.filter(t => t.estado === 'completado').reduce((s, t) => s + (Number(t.costo) || 0), 0);
  const planificados = tratamientosCache.filter(t => t.estado === 'planificado').length;

  document.getElementById('tratKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🦷', label: 'Tratamientos este mes', value: fmtNum(delMes.length), sub: `${tratamientosCache.length} en total` }),
    kpiCard({ acento: 'orange', icono: '⏳', label: 'En progreso', value: fmtNum(enProgreso), sub: 'ahora mismo' }),
    kpiCard({ acento: 'teal', icono: '💰', label: 'Facturado este mes', value: fmtNum(facturadoMes), sub: 'tratamientos completados' }),
    kpiCard({ acento: 'purple', icono: '📝', label: 'Planificados', value: fmtNum(planificados), sub: 'sin iniciar todavía' })
  ].join('');
}

function dibujarLista() {
  const ordenados = [...tratamientosCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id)).slice(0, 15);
  document.getElementById('tratLista').innerHTML = ordenados.length ? ordenados.map(t => {
    const est = ETIQUETA_ESTADO[t.estado] || { texto: t.estado, color: 'muted' };
    // sub se arma crudo y se escapa UNA sola vez en el punto de inserción --
    // mismo patrón que el resto de los dashboards. Antes, pieza_dental (un
    // campo de texto libre) se insertaba sin pasar por escapeHtml(), lo que
    // permitía XSS almacenado vía ese campo.
    const sub = [t.pieza_dental ? `Pieza ${t.pieza_dental}` : null, String(t.fecha || '').slice(0, 10)].filter(Boolean).join(' · ');
    return `<div class="rank-row">
      <span class="rank-name">${escapeHtml(t.cliente_nombre)} — ${escapeHtml(t.procedimiento)}<div class="rank-sub">${escapeHtml(sub)}</div></span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <span class="rank-val">${fmtNum(Number(t.costo) || 0)}</span>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay tratamientos registrados.</div>';
}

function dibujarRankingProcedimientos() {
  const porProcedimiento = new Map();
  tratamientosCache.forEach(t => porProcedimiento.set(t.procedimiento, (porProcedimiento.get(t.procedimiento) || 0) + 1));
  const top = [...porProcedimiento.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  document.getElementById('tratRankProcedimientos').innerHTML = top.length
    ? top.map((r, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(r[0])}</span><span class="rank-val">${fmtNum(r[1])}</span></div>`).join('')
    : '<div class="rank-row">Todavía no hay tratamientos registrados.</div>';
}
