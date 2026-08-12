// js/agendaDashboard.js
// Dashboard bespoke de Agenda: vista de "día seleccionado" con navegación
// ←/hoy/→ (no un dashboard de KPIs genérico) -- es lo que de verdad importa
// en un módulo de citas: qué hay agendado hoy, y qué sigue. Reemplaza el
// motor genérico de js/dashboard.js para este módulo, igual que ya se hizo
// con Ventas/Clientes/Finanzas/Inventario/Postventa/Vehículos/Repuestos.
//
// Cambiar el estado de una cita (confirmar/completar/cancelar/no asistió)
// llama directo a backend.actualizar() -- PUT /agenda/:id acepta `estado`
// libremente (ver backend/src/routes/agenda.js), sin backend nuevo.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  pendiente: { texto: 'Pendiente', color: 'muted' },
  confirmada: { texto: 'Confirmada', color: 'blue' },
  completada: { texto: 'Completada', color: 'teal' },
  cancelada: { texto: 'Cancelada', color: 'danger' },
  no_asistio: { texto: 'No asistió', color: 'purple' }
};

let citasCache = [];
let backendRef = null;
let fechaSeleccionada = hoyISO();
let eventosListos = false;

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const fecha = new Date(y, m - 1, d + dias);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}
function formatoFechaLarga(fechaISO) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function renderAgendaDashboard(filasCrudas, backend) {
  citasCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;

  const input = document.getElementById('agendaFechaSeleccionada');
  input.value = fechaSeleccionada;
  input.addEventListener('change', () => { fechaSeleccionada = input.value || hoyISO(); dibujar(); });

  document.getElementById('agendaDiaAnterior').addEventListener('click', () => { fechaSeleccionada = sumarDias(fechaSeleccionada, -1); dibujar(); });
  document.getElementById('agendaDiaSiguiente').addEventListener('click', () => { fechaSeleccionada = sumarDias(fechaSeleccionada, 1); dibujar(); });
  document.getElementById('agendaHoy').addEventListener('click', () => { fechaSeleccionada = hoyISO(); dibujar(); });

  document.getElementById('agendaDia').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    cambiarEstado(btn.closest('[data-id]').dataset.id, btn.dataset.accion);
  });
}

function dibujar() {
  document.getElementById('agendaFechaSeleccionada').value = fechaSeleccionada;
  document.getElementById('agendaFechaLabel').textContent = formatoFechaLarga(fechaSeleccionada);
  dibujarKpis();
  dibujarDia();
  dibujarProximas();
}

function dibujarKpis() {
  const hoy = hoyISO();
  const en7dias = sumarDias(hoy, 6);

  const citasHoy = citasCache.filter(c => c.fecha === hoy);
  const confirmadasHoy = citasHoy.filter(c => c.estado === 'confirmada').length;
  const pendientes = citasCache.filter(c => c.estado === 'pendiente' && c.fecha >= hoy).length;
  const proximos7 = citasCache.filter(c => c.fecha >= hoy && c.fecha <= en7dias && !['cancelada', 'no_asistio'].includes(c.estado)).length;

  document.getElementById('agendaKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '📅', label: 'Citas hoy', value: fmtNum(citasHoy.length), sub: `${confirmadasHoy} confirmada(s)` }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Confirmadas hoy', value: fmtNum(confirmadasHoy), sub: citasHoy.length ? `de ${citasHoy.length} cita(s)` : 'sin citas hoy' }),
    kpiCard({
      acento: pendientes ? 'orange' : 'teal', icono: '⏳', label: 'Pendientes de confirmar', value: fmtNum(pendientes),
      sub: 'hoy en adelante'
    }),
    kpiCard({ acento: 'purple', icono: '🗓️', label: 'Próximos 7 días', value: fmtNum(proximos7), sub: 'citas activas' })
  ].join('');
}

function botonesAccion(cita) {
  if (cita.estado === 'pendiente') {
    return `<button type="button" class="btn btn-ghost" data-accion="confirmada" style="padding:5px 10px; font-size:11.5px;">✓ Confirmar</button>
      <button type="button" class="btn btn-ghost" data-accion="cancelada" style="padding:5px 10px; font-size:11.5px;">✕ Cancelar</button>`;
  }
  if (cita.estado === 'confirmada') {
    return `<button type="button" class="btn btn-ghost" data-accion="completada" style="padding:5px 10px; font-size:11.5px;">✓ Completar</button>
      <button type="button" class="btn btn-ghost" data-accion="no_asistio" style="padding:5px 10px; font-size:11.5px;">⚠ No asistió</button>
      <button type="button" class="btn btn-ghost" data-accion="cancelada" style="padding:5px 10px; font-size:11.5px;">✕ Cancelar</button>`;
  }
  return '';
}

function dibujarDia() {
  const delDia = citasCache.filter(c => c.fecha === fechaSeleccionada).sort((a, b) => String(a.hora).localeCompare(String(b.hora)));
  document.getElementById('agendaDiaCount').textContent = delDia.length ? `${delDia.length} cita(s)` : 'sin citas';

  document.getElementById('agendaDia').innerHTML = delDia.length ? delDia.map(c => {
    const est = ETIQUETA_ESTADO[c.estado] || { texto: c.estado, color: 'muted' };
    const sub = [c.vehiculo_descripcion, c.notas].filter(Boolean).join(' · ');
    return `<div class="rank-row" data-id="${c.id}" style="align-items:center; flex-wrap:wrap; gap:8px 12px;">
      <span class="rank-num" style="border-radius:8px; width:auto; padding:0 8px;">${escapeHtml(String(c.hora).slice(0, 5))}</span>
      <span class="rank-name" style="flex:1; min-width:160px;">
        ${escapeHtml(c.cliente_nombre)} — ${escapeHtml(c.motivo)}
        ${sub ? `<div class="rank-sub">${escapeHtml(sub)}</div>` : ''}
      </span>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <div style="display:flex; gap:6px;">${botonesAccion(c)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">No hay citas agendadas este día.</div>';
}

function dibujarProximas() {
  const hoy = hoyISO();
  const proximas = citasCache
    .filter(c => c.fecha >= hoy && !['cancelada', 'completada', 'no_asistio'].includes(c.estado))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || String(a.hora).localeCompare(String(b.hora)))
    .slice(0, 8);

  document.getElementById('agendaProximas').innerHTML = proximas.length ? proximas.map(c => `
    <div class="rank-row">
      <span class="rank-name">${escapeHtml(c.cliente_nombre)}<div class="rank-sub">${escapeHtml(c.motivo)}</div></span>
      <span class="rank-val" style="font-size:12px; text-align:right;">${escapeHtml(String(c.fecha).slice(5))}<br>${escapeHtml(String(c.hora).slice(0, 5))}</span>
    </div>`).join('') : '<div class="rank-row">Sin próximas citas agendadas.</div>';
}

async function cambiarEstado(id, nuevoEstado) {
  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar la cita.');
    return;
  }
  const cita = citasCache.find(c => String(c.id) === String(id));
  if (cita) cita.estado = nuevoEstado;
  dibujar();
}
