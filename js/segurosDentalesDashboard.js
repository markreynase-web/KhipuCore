// js/segurosDentalesDashboard.js
// Dashboard bespoke de Seguros Dentales: seguimiento de reclamos, con
// cambio de estado real (PUT /seguros_dentales/:id) igual que el resto de
// los módulos con flujo de estados de esta sesión.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  enviado: { texto: 'Enviado', color: 'muted' },
  en_revision: { texto: 'En revisión', color: 'blue' },
  aprobado: { texto: 'Aprobado', color: 'teal' },
  rechazado: { texto: 'Rechazado', color: 'danger' },
  pagado: { texto: 'Pagado', color: 'purple' }
};

let reclamosCache = [];
let backendRef = null;
let eventosListos = false;

export function renderSegurosDentalesDashboard(filasCrudas, backend) {
  reclamosCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('segurosLista').addEventListener('click', (e) => {
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
  const pendientes = reclamosCache.filter(r => ['enviado', 'en_revision'].includes(r.estado)).length;
  const aprobados = reclamosCache.filter(r => r.estado === 'aprobado').length;
  const montoCubiertoTotal = reclamosCache.filter(r => ['aprobado', 'pagado'].includes(r.estado)).reduce((s, r) => s + (Number(r.monto_cubierto) || 0), 0);
  const pagadosMes = reclamosCache.filter(r => r.estado === 'pagado' && esteMes(r.actualizado_el || r.fecha)).length;

  document.getElementById('segurosKpis').innerHTML = [
    kpiCard({ acento: pendientes ? 'orange' : 'teal', icono: '📨', label: 'Pendientes', value: fmtNum(pendientes), sub: 'enviados o en revisión' }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Aprobados', value: fmtNum(aprobados), sub: 'esperando pago' }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Monto cubierto', value: fmtNum(montoCubiertoTotal), sub: 'aprobados + pagados' }),
    kpiCard({ acento: 'blue', icono: '🧾', label: 'Pagados este mes', value: fmtNum(pagadosMes), sub: 'reclamos cerrados' })
  ].join('');
}

function botonesAccion(r) {
  if (r.estado === 'enviado') {
    return `<button type="button" class="btn btn-ghost" data-accion="en_revision" style="padding:5px 10px; font-size:11.5px;">▶ En revisión</button>
      <button type="button" class="btn btn-ghost" data-accion="rechazado" style="padding:5px 10px; font-size:11.5px;">✕ Rechazar</button>`;
  }
  if (r.estado === 'en_revision') {
    return `<button type="button" class="btn btn-ghost" data-accion="aprobado" style="padding:5px 10px; font-size:11.5px;">✓ Aprobar</button>
      <button type="button" class="btn btn-ghost" data-accion="rechazado" style="padding:5px 10px; font-size:11.5px;">✕ Rechazar</button>`;
  }
  if (r.estado === 'aprobado') {
    return `<button type="button" class="btn btn-ghost" data-accion="pagado" style="padding:5px 10px; font-size:11.5px;">✓ Marcar pagado</button>`;
  }
  return '';
}

function dibujarLista() {
  const ordenados = [...reclamosCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id));
  document.getElementById('segurosCount').textContent = `${ordenados.length} reclamo(s)`;

  document.getElementById('segurosLista').innerHTML = ordenados.length ? ordenados.map(r => {
    const est = ETIQUETA_ESTADO[r.estado] || { texto: r.estado, color: 'muted' };
    const sub = [r.aseguradora, r.tratamiento_descripcion, escapeHtml(String(r.fecha || '').slice(0, 10))].filter(Boolean).join(' · ');
    return `<div class="rank-row" data-id="${r.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-name" style="flex:1; min-width:220px;">
        ${escapeHtml(r.cliente_nombre)}
        <div class="rank-sub">${escapeHtml(sub)}</div>
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <span class="rank-val">${fmtNum(Number(r.monto_reclamado) || 0)}<div class="rank-sub" style="text-align:right;">cubierto: ${fmtNum(Number(r.monto_cubierto) || 0)}</div></span>
      <div style="display:flex; gap:6px;">${botonesAccion(r)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay reclamos registrados.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar el reclamo.');
    return;
  }
  const r = reclamosCache.find(x => String(x.id) === String(id));
  if (r) r.estado = nuevoEstado;
  dibujar();
}
