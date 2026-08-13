// js/produccionDashboard.js
// Dashboard bespoke de Producción: completar una orden es la acción real
// que suma cantidad_producida al stock de Inventario (ver
// backend/src/routes/produccion.js). Iniciar/Completar/Cancelar llaman
// directo a backend.actualizar().

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  planificada: { texto: 'Planificada', color: 'muted' },
  en_proceso: { texto: 'En proceso', color: 'blue' },
  completada: { texto: 'Completada', color: 'teal' },
  cancelada: { texto: 'Cancelada', color: 'danger' }
};

let ordenesCache = [];
let backendRef = null;
let eventosListos = false;

export function renderProduccionDashboard(filasCrudas, backend) {
  ordenesCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('produccionLista').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    cambiarEstado(btn.closest('[data-id]').dataset.id, btn.dataset.accion);
  });
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
  const activas = ordenesCache.filter(o => ['planificada', 'en_proceso'].includes(o.estado)).length;
  const completadasMes = ordenesCache.filter(o => o.estado === 'completada' && esteMes(o.actualizado_el || o.fecha_inicio));
  const unidadesMes = completadasMes.reduce((s, o) => s + (Number(o.cantidad_producida) || 0), 0);
  const costoMes = ordenesCache.filter(o => esteMes(o.fecha_inicio)).reduce((s, o) => s + (Number(o.costo_materiales) || 0) + (Number(o.costo_mano_obra) || 0), 0);

  document.getElementById('produccionKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🏭', label: 'Órdenes activas', value: fmtNum(activas), sub: 'planificadas + en proceso' }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Completadas este mes', value: fmtNum(completadasMes.length), sub: 'órdenes cerradas' }),
    kpiCard({ acento: 'purple', icono: '📦', label: 'Unidades producidas', value: fmtNum(unidadesMes), sub: 'este mes' }),
    kpiCard({ acento: 'orange', icono: '💰', label: 'Costo de producción', value: fmtNum(costoMes), sub: 'materiales + mano de obra, este mes' })
  ].join('');
}

function botonesAccion(o) {
  if (o.estado === 'planificada') {
    return `<button type="button" class="btn btn-ghost" data-accion="en_proceso" style="padding:5px 10px; font-size:11.5px;">▶ Iniciar</button>
      <button type="button" class="btn btn-ghost" data-accion="cancelada" style="padding:5px 10px; font-size:11.5px;">✕ Cancelar</button>`;
  }
  if (o.estado === 'en_proceso') {
    return `<button type="button" class="btn btn-ghost" data-accion="completada" style="padding:5px 10px; font-size:11.5px;">✓ Completar</button>`;
  }
  return '';
}

function dibujarLista() {
  const ordenados = [...ordenesCache].sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)) || (b.id - a.id));
  document.getElementById('produccionCount').textContent = `${ordenados.length} orden(es)`;

  document.getElementById('produccionLista').innerHTML = ordenados.length ? ordenados.map(o => {
    const est = ETIQUETA_ESTADO[o.estado] || { texto: o.estado, color: 'muted' };
    const sub = [`Plan: ${fmtNum(Number(o.cantidad_planificada))} u.`, o.estado === 'completada' ? `Producido: ${fmtNum(Number(o.cantidad_producida))} u.` : null, escapeHtml(String(o.fecha_inicio || '').slice(0, 10))].filter(Boolean).join(' · ');
    return `<div class="rank-row" data-id="${o.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-name" style="flex:1; min-width:220px;">
        ${escapeHtml(o.producto_nombre)}
        <div class="rank-sub">${escapeHtml(sub)}</div>
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <div style="display:flex; gap:6px;">${botonesAccion(o)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay órdenes de producción registradas.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar la orden.');
    return;
  }
  const orden = ordenesCache.find(o => String(o.id) === String(id));
  if (orden) { orden.estado = res.estado; orden.cantidad_producida = res.cantidad_producida; }
  dibujar();
}
