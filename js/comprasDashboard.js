// js/comprasDashboard.js
// Dashboard bespoke de Compras: recibir una orden es la acción real que
// suma stock a Inventario y postea un egreso en Finanzas (ver
// backend/src/routes/compras.js) -- el botón llama directo a
// backend.actualizar(), no hay nada simulado del lado del cliente.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  pedido: { texto: 'Pedido', color: 'muted' },
  recibido: { texto: 'Recibido', color: 'teal' },
  cancelado: { texto: 'Cancelado', color: 'danger' }
};

let comprasCache = [];
let backendRef = null;
let eventosListos = false;

export function renderComprasDashboard(filasCrudas, backend) {
  comprasCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('comprasLista').addEventListener('click', (e) => {
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
  const pendientes = comprasCache.filter(c => c.estado === 'pedido').length;
  const recibidasMes = comprasCache.filter(c => c.estado === 'recibido' && esteMes(c.fecha_recibido || c.fecha)).length;
  const gastoMes = comprasCache.filter(c => c.estado === 'recibido' && esteMes(c.fecha_recibido || c.fecha)).reduce((s, c) => s + (Number(c.total) || 0), 0);
  const proveedoresActivos = new Set(comprasCache.filter(c => c.estado !== 'cancelado').map(c => c.proveedor)).size;

  document.getElementById('comprasKpis').innerHTML = [
    kpiCard({ acento: pendientes ? 'orange' : 'teal', icono: '🛒', label: 'Pedidos pendientes', value: fmtNum(pendientes), sub: 'esperando recepción' }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Recibidas este mes', value: fmtNum(recibidasMes), sub: 'órdenes cerradas' }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Gasto en compras', value: fmtNum(gastoMes), sub: 'recibidas este mes' }),
    kpiCard({ acento: 'blue', icono: '🏭', label: 'Proveedores activos', value: fmtNum(proveedoresActivos), sub: 'con órdenes vigentes' })
  ].join('');
}

function botonesAccion(c) {
  if (c.estado !== 'pedido') return '';
  return `<button type="button" class="btn btn-ghost" data-accion="recibido" style="padding:5px 10px; font-size:11.5px;">✓ Recibir</button>
    <button type="button" class="btn btn-ghost" data-accion="cancelado" style="padding:5px 10px; font-size:11.5px;">✕ Cancelar</button>`;
}

function dibujarLista() {
  const ordenados = [...comprasCache].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id));
  document.getElementById('comprasCount').textContent = `${ordenados.length} orden(es)`;

  document.getElementById('comprasLista').innerHTML = ordenados.length ? ordenados.map(c => {
    const est = ETIQUETA_ESTADO[c.estado] || { texto: c.estado, color: 'muted' };
    const sub = [c.proveedor, `${fmtNum(Number(c.cantidad))} u.`, escapeHtml(String(c.fecha || '').slice(0, 10))].filter(Boolean).join(' · ');
    return `<div class="rank-row" data-id="${c.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-name" style="flex:1; min-width:220px;">
        ${escapeHtml(c.producto_nombre)}
        <div class="rank-sub">${escapeHtml(sub)}</div>
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <span class="rank-val">${fmtNum(Number(c.total) || 0)}</span>
      <div style="display:flex; gap:6px;">${botonesAccion(c)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay órdenes de compra registradas.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar la compra.');
    return;
  }
  const compra = comprasCache.find(c => String(c.id) === String(id));
  if (compra) { compra.estado = res.estado; compra.fecha_recibido = res.fecha_recibido; compra.total = res.total; }
  dibujar();
}
