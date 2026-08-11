// js/postventaDashboard.js
// Dashboard bespoke de Postventa (Rediseño v3): CRM + ticketing -- tablero
// Kanban por estado (pendiente/en_proceso/completado) en vez de un
// dashboard de KPIs genéricos. Primer patrón Kanban de la app, a propósito
// distinto de Ventas/Clientes/Finanzas/Inventario.
//
// LIMITACIÓN REAL (no inventada): `postventa` no tiene columnas de
// prioridad ni de responsable asignado -- el tablero se organiza solo por
// lo que sí existe (estado, tipo, fechas de garantía/próximo servicio), no
// se inventan campos que no están en el esquema.
//
// Mover una tarjeta SÍ es una operación real: PUT /postventa/:id acepta
// `estado` libremente (solo cliente_id/vehiculo_id/repuesto_id son
// inmutables, confirmado en backend/src/routes/postventa.js), así que los
// botones de mover llaman directo a backend.actualizar() -- sin backend
// nuevo, sin drag-and-drop (más frágil de mantener que un par de botones).

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_TIPO = { mantenimiento: 'Mantenimiento', garantia: 'Garantía', reparacion: 'Reparación', revision: 'Revisión' };
const ETIQUETA_ESTADO = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado' };
const ORDEN_ESTADOS = ['pendiente', 'en_proceso', 'completado'];

let ordenesCache = [];
let backendRef = null;
let eventosListos = false;

function diasHasta(fechaStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const f = new Date(fechaStr); f.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / 86400000);
}

export function renderPostventaDashboard(filasCrudas, backend) {
  ordenesCache = filasCrudas || [];
  backendRef = backend;
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('postKanban').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mover]');
    if (!btn) return;
    const id = btn.closest('.ticket-card').dataset.id;
    moverOrden(id, btn.dataset.mover);
  });
}

function dibujar() {
  dibujarKpis();
  dibujarKanban();
  dibujarVencimientos();
}

function dibujarKpis() {
  const abiertos = ordenesCache.filter(o => o.estado !== 'completado').length;
  const pendientesSinIniciar = ordenesCache.filter(o => o.estado === 'pendiente').length;

  const hoy = new Date();
  const completadosMes = ordenesCache.filter(o => {
    if (o.estado !== 'completado') return false;
    const d = new Date(o.actualizado_el || o.fecha);
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
  }).length;

  const ingresoCompletados = ordenesCache.filter(o => o.estado === 'completado').reduce((s, o) => s + (Number(o.total) || 0), 0);

  const porVencerGarantia = ordenesCache.filter(o => o.garantia_hasta && diasHasta(o.garantia_hasta) >= 0 && diasHasta(o.garantia_hasta) <= 30).length;

  document.getElementById('postKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🗂️', label: 'Casos abiertos', value: fmtNum(abiertos), sub: `${pendientesSinIniciar} sin iniciar` }),
    kpiCard({ acento: 'teal', icono: '✅', label: 'Completados este mes', value: fmtNum(completadosMes), sub: 'órdenes cerradas' }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Ingreso por servicios', value: fmtNum(ingresoCompletados), sub: 'de órdenes completadas' }),
    kpiCard({
      acento: porVencerGarantia ? 'orange' : 'teal', icono: '🛡️', label: 'Garantías por vencer',
      value: fmtNum(porVencerGarantia), sub: 'en los próximos 30 días'
    })
  ].join('');
}

function tarjetaHtml(orden) {
  const idx = ORDEN_ESTADOS.indexOf(orden.estado);
  const anterior = ORDEN_ESTADOS[idx - 1];
  const siguiente = ORDEN_ESTADOS[idx + 1];
  return `<div class="ticket-card" data-id="${orden.id}">
    <div class="ticket-card-top">
      <span class="ticket-tipo">${escapeHtml(ETIQUETA_TIPO[orden.tipo] || orden.tipo || '')}</span>
      <span class="ticket-total">${fmtNum(Number(orden.total) || 0)}</span>
    </div>
    <div class="ticket-cliente">${escapeHtml(orden.cliente_nombre || 'Sin cliente')}</div>
    <div class="ticket-vehiculo">${escapeHtml(orden.vehiculo_descripcion || '')}</div>
    <div class="ticket-desc">${escapeHtml(orden.descripcion || '')}</div>
    <div class="ticket-footer">
      <span class="ticket-fecha">${escapeHtml(String(orden.fecha || '').slice(0, 10))}</span>
      <div class="ticket-mover">
        ${anterior ? `<button type="button" data-mover="atras" title="Mover a ${ETIQUETA_ESTADO[anterior]}">←</button>` : ''}
        ${siguiente ? `<button type="button" data-mover="adelante" title="Mover a ${ETIQUETA_ESTADO[siguiente]}">→</button>` : ''}
      </div>
    </div>
  </div>`;
}

function dibujarKanban() {
  ORDEN_ESTADOS.forEach(estado => {
    const delEstado = ordenesCache.filter(o => o.estado === estado).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    document.getElementById(`kanban-count-${estado}`).textContent = delEstado.length;
    document.getElementById(`kanban-${estado}`).innerHTML = delEstado.length
      ? delEstado.map(tarjetaHtml).join('')
      : '<div class="kanban-vacio">Sin órdenes acá.</div>';
  });
}

async function moverOrden(id, direccion) {
  const orden = ordenesCache.find(o => String(o.id) === String(id));
  if (!orden) return;
  const idx = ORDEN_ESTADOS.indexOf(orden.estado);
  const nuevoIdx = direccion === 'adelante' ? idx + 1 : idx - 1;
  if (nuevoIdx < 0 || nuevoIdx >= ORDEN_ESTADOS.length) return;
  const nuevoEstado = ORDEN_ESTADOS[nuevoIdx];

  const res = await backendRef.actualizar(id, { estado: nuevoEstado });
  if (!res) {
    alert(backendRef.ultimoError() || 'No se pudo actualizar el estado.');
    return;
  }
  orden.estado = nuevoEstado;
  dibujar();
}

// Garantía y próximo servicio combinados en una sola línea de tiempo --
// dos campos de fecha distintos, pero la misma pregunta para el usuario
// ("¿qué se me vence pronto?"), así que se muestran juntos con una
// etiqueta que distingue cuál es cuál.
function dibujarVencimientos() {
  const eventos = [];
  ordenesCache.forEach(o => {
    if (o.garantia_hasta) eventos.push({ tipo: 'Garantía', fecha: o.garantia_hasta, cliente: o.cliente_nombre, vehiculo: o.vehiculo_descripcion });
    if (o.proximo_servicio) eventos.push({ tipo: 'Próximo servicio', fecha: o.proximo_servicio, cliente: o.cliente_nombre, vehiculo: o.vehiculo_descripcion });
  });
  const proximos = eventos
    .filter(e => diasHasta(e.fecha) >= -30 && diasHasta(e.fecha) <= 30)
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

  document.getElementById('postVencimientos').innerHTML = proximos.length ? proximos.slice(0, 10).map(e => {
    const dias = diasHasta(e.fecha);
    const urgente = dias <= 7;
    return `<div class="rank-row">
      <span class="rank-name">${escapeHtml(e.cliente || 'Sin cliente')}<div class="rank-sub">${escapeHtml(e.tipo)} · ${escapeHtml(e.vehiculo || '')}</div></span>
      <span class="rank-val" style="${urgente ? 'color:var(--danger);' : ''}">${dias < 0 ? 'Vencido' : `${dias} día${dias === 1 ? '' : 's'}`}</span>
    </div>`;
  }).join('') : '<div class="rank-row">Sin garantías ni servicios próximos a vencer.</div>';
}
