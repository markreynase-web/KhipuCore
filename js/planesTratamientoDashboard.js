// js/planesTratamientoDashboard.js
// Dashboard bespoke de Planes de Tratamiento: aprobar/rechazar un plan
// propuesto es una acción real (PUT /planes_tratamiento/:id con estado) --
// fecha_aprobacion la calcula el servidor, no el cliente (ver
// backend/src/routes/planesTratamiento.js).

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  propuesto: { texto: 'Propuesto', color: 'muted' },
  aprobado: { texto: 'Aprobado', color: 'teal' },
  rechazado: { texto: 'Rechazado', color: 'danger' },
  en_progreso: { texto: 'En progreso', color: 'blue' },
  completado: { texto: 'Completado', color: 'purple' }
};

let planesCache = [];
let backendRef = null;
let eventosListos = false;

export function renderPlanesTratamientoDashboard(filasCrudas, backend) {
  planesCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('planesLista').addEventListener('click', (e) => {
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
  const propuestos = planesCache.filter(p => p.estado === 'propuesto').length;
  const aprobadosMes = planesCache.filter(p => p.estado === 'aprobado' && esteMes(p.fecha_aprobacion)).length;
  const presupuestoAprobado = planesCache.filter(p => ['aprobado', 'en_progreso', 'completado'].includes(p.estado))
    .reduce((s, p) => s + (Number(p.presupuesto_total) || 0), 0);

  const decididos = planesCache.filter(p => ['aprobado', 'rechazado', 'en_progreso', 'completado'].includes(p.estado)).length;
  const aprobadosTotal = planesCache.filter(p => ['aprobado', 'en_progreso', 'completado'].includes(p.estado)).length;
  const tasaAprobacion = decididos ? (aprobadosTotal / decididos) * 100 : null;

  document.getElementById('planesKpis').innerHTML = [
    kpiCard({ acento: propuestos ? 'orange' : 'teal', icono: '📋', label: 'Pendientes de aprobar', value: fmtNum(propuestos), sub: 'esperando al paciente' }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Aprobados este mes', value: fmtNum(aprobadosMes), sub: 'nuevas aprobaciones' }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Presupuesto aprobado', value: fmtNum(presupuestoAprobado), sub: 'planes en marcha o listos' }),
    kpiCard({
      acento: 'blue', icono: '📈', label: 'Tasa de aprobación', value: tasaAprobacion === null ? '—' : `${tasaAprobacion.toFixed(0)}%`,
      sub: tasaAprobacion === null ? 'sin planes decididos todavía' : `${aprobadosTotal} de ${decididos} decididos`
    })
  ].join('');
}

function botonesAccion(plan) {
  if (plan.estado === 'propuesto') {
    return `<button type="button" class="btn btn-ghost" data-accion="aprobado" style="padding:5px 10px; font-size:11.5px;">✓ Aprobar</button>
      <button type="button" class="btn btn-ghost" data-accion="rechazado" style="padding:5px 10px; font-size:11.5px;">✕ Rechazar</button>`;
  }
  if (plan.estado === 'aprobado') {
    return `<button type="button" class="btn btn-ghost" data-accion="en_progreso" style="padding:5px 10px; font-size:11.5px;">▶ Iniciar</button>`;
  }
  if (plan.estado === 'en_progreso') {
    return `<button type="button" class="btn btn-ghost" data-accion="completado" style="padding:5px 10px; font-size:11.5px;">✓ Completar</button>`;
  }
  return '';
}

function dibujarLista() {
  const ordenados = [...planesCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id));
  document.getElementById('planesCount').textContent = `${ordenados.length} plan(es)`;

  document.getElementById('planesLista').innerHTML = ordenados.length ? ordenados.map(p => {
    const est = ETIQUETA_ESTADO[p.estado] || { texto: p.estado, color: 'muted' };
    return `<div class="rank-row" data-id="${p.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-name" style="flex:1; min-width:220px;">
        ${escapeHtml(p.cliente_nombre)} — ${escapeHtml(p.descripcion)}
        <div class="rank-sub">${escapeHtml(String(p.fecha || '').slice(0, 10))}${p.fecha_aprobacion ? ` · Aprobado ${escapeHtml(String(p.fecha_aprobacion).slice(0, 10))}` : ''}</div>
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <span class="rank-val">${fmtNum(Number(p.presupuesto_total) || 0)}</span>
      <div style="display:flex; gap:6px;">${botonesAccion(p)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay planes de tratamiento registrados.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar el plan.');
    return;
  }
  const plan = planesCache.find(p => String(p.id) === String(id));
  if (plan) { plan.estado = res.estado; plan.fecha_aprobacion = res.fecha_aprobacion; }
  dibujar();
}
