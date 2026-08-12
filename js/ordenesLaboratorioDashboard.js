// js/ordenesLaboratorioDashboard.js
// Dashboard bespoke de Órdenes de Laboratorio: flujo real
// pedido -> en_laboratorio -> listo -> entregado, con botones que llaman
// directo a backend.actualizar() (PUT /ordenes_laboratorio/:id).

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  pedido: { texto: 'Pedido', color: 'muted' },
  en_laboratorio: { texto: 'En laboratorio', color: 'blue' },
  listo: { texto: 'Listo', color: 'purple' },
  entregado: { texto: 'Entregado', color: 'teal' },
  cancelado: { texto: 'Cancelado', color: 'danger' }
};
const ORDEN_ESTADOS = ['pedido', 'en_laboratorio', 'listo', 'entregado'];

let ordenesCache = [];
let backendRef = null;
let eventosListos = false;

export function renderOrdenesLaboratorioDashboard(filasCrudas, backend) {
  ordenesCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('ordenesLista').addEventListener('click', (e) => {
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
  const activos = ordenesCache.filter(o => ['pedido', 'en_laboratorio'].includes(o.estado)).length;
  const listos = ordenesCache.filter(o => o.estado === 'listo').length;
  const entregadosMes = ordenesCache.filter(o => o.estado === 'entregado' && esteMes(o.actualizado_el || o.fecha)).length;
  const costoMes = ordenesCache.filter(o => esteMes(o.fecha)).reduce((s, o) => s + (Number(o.costo) || 0), 0);

  document.getElementById('ordenesKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🔬', label: 'Pedidos activos', value: fmtNum(activos), sub: 'pedido + en laboratorio' }),
    kpiCard({ acento: listos ? 'orange' : 'teal', icono: '📦', label: 'Listos para entregar', value: fmtNum(listos), sub: 'esperando al paciente' }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Entregados este mes', value: fmtNum(entregadosMes), sub: 'órdenes cerradas' }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Costo en laboratorio', value: fmtNum(costoMes), sub: 'pedidos de este mes' })
  ].join('');
}

function botonesAccion(orden) {
  const idx = ORDEN_ESTADOS.indexOf(orden.estado);
  if (idx === -1 || idx === ORDEN_ESTADOS.length - 1) return '';
  const siguiente = ORDEN_ESTADOS[idx + 1];
  const etiquetaSiguiente = ETIQUETA_ESTADO[siguiente].texto;
  const cancelar = orden.estado === 'pedido' ? `<button type="button" class="btn btn-ghost" data-accion="cancelado" style="padding:5px 10px; font-size:11.5px;">✕ Cancelar</button>` : '';
  return `<button type="button" class="btn btn-ghost" data-accion="${siguiente}" style="padding:5px 10px; font-size:11.5px;">→ ${escapeHtml(etiquetaSiguiente)}</button>${cancelar}`;
}

function dibujarLista() {
  const ordenados = [...ordenesCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id));
  document.getElementById('ordenesCount').textContent = `${ordenados.length} orden(es)`;

  document.getElementById('ordenesLista').innerHTML = ordenados.length ? ordenados.map(o => {
    const est = ETIQUETA_ESTADO[o.estado] || { texto: o.estado, color: 'muted' };
    const sub = [o.armazon, o.tipo_lente, o.laboratorio, escapeHtml(String(o.fecha || '').slice(0, 10))].filter(Boolean).join(' · ');
    return `<div class="rank-row" data-id="${o.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-name" style="flex:1; min-width:220px;">
        ${escapeHtml(o.cliente_nombre)}
        <div class="rank-sub">${escapeHtml(sub)}</div>
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <span class="rank-val">${fmtNum(Number(o.costo) || 0)}</span>
      <div style="display:flex; gap:6px;">${botonesAccion(o)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay órdenes registradas.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar la orden.');
    return;
  }
  const orden = ordenesCache.find(o => String(o.id) === String(id));
  if (orden) orden.estado = nuevoEstado;
  dibujar();
}
