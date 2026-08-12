// js/recetasOpticasDashboard.js
// Dashboard bespoke de Recetas Ópticas (vertical Oculista): historial de
// exámenes con la prescripción completa por ojo. Sin gráfico de tendencia
// de graduación (no tiene sentido promediar esfera/cilindro entre pacientes
// distintos) -- KPIs de actividad + lista cronológica con el detalle real.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

let recetasCache = [];

export function renderRecetasOpticasDashboard(filasCrudas) {
  recetasCache = filasCrudas || [];
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
}

function dibujarKpis() {
  const delMes = recetasCache.filter(r => esteMes(r.fecha));
  const pacientesUnicos = new Set(recetasCache.map(r => r.cliente_id)).size;
  const conAdicion = recetasCache.filter(r => r.adicion !== null && r.adicion !== undefined && Number(r.adicion) > 0).length;

  document.getElementById('recetasKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '👓', label: 'Recetas este mes', value: fmtNum(delMes.length), sub: `${recetasCache.length} en total` }),
    kpiCard({ acento: 'teal', icono: '🧑‍🤝‍🧑', label: 'Pacientes examinados', value: fmtNum(pacientesUnicos), sub: 'con al menos una receta' }),
    kpiCard({ acento: 'purple', icono: '🔎', label: 'Con adición', value: fmtNum(conAdicion), sub: 'bifocal / progresivo' }),
    kpiCard({ acento: 'orange', icono: '📅', label: 'Última semana', value: fmtNum(recetasCache.filter(r => {
      const d = new Date(r.fecha); const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7);
      return d >= hace7;
    }).length), sub: 'exámenes recientes' })
  ].join('');
}

function fmtGraduacion(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return (n > 0 ? '+' : '') + n.toFixed(2);
}

function dibujarLista() {
  const ordenados = [...recetasCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id)).slice(0, 20);
  document.getElementById('recetasCount').textContent = `${recetasCache.length} receta(s)`;

  document.getElementById('recetasLista').innerHTML = ordenados.length ? ordenados.map(r => {
    const od = `OD: ${fmtGraduacion(r.esfera_od)} / ${fmtGraduacion(r.cilindro_od)} × ${r.eje_od ?? '—'}°`;
    const oi = `OI: ${fmtGraduacion(r.esfera_oi)} / ${fmtGraduacion(r.cilindro_oi)} × ${r.eje_oi ?? '—'}°`;
    const extra = [r.adicion ? `Adición ${fmtGraduacion(r.adicion)}` : null, r.distancia_pupilar ? `DP ${r.distancia_pupilar}mm` : null].filter(Boolean).join(' · ');
    return `<div class="rank-row" style="align-items:flex-start;">
      <span class="rank-name">
        ${escapeHtml(r.cliente_nombre)}
        <div class="rank-sub">${escapeHtml(od)} · ${escapeHtml(oi)}${extra ? ' · ' + escapeHtml(extra) : ''}</div>
      </span>
      <span class="rank-val" style="font-size:12px;">${escapeHtml(String(r.fecha || '').slice(0, 10))}</span>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay recetas registradas.</div>';
}
