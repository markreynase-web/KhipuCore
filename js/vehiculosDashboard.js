// js/vehiculosDashboard.js
// Dashboard bespoke de Vehículos (Rediseño v3): "fleet dashboard" -- listado
// de flota con alertas de servicio/garantía inline, ranking de gasto en
// mantenimiento, y una ficha por vehículo (panel lateral) con su historial
// real de órdenes de Postventa. Reemplaza el motor genérico de
// js/dashboard.js para este módulo (que hoy ni siquiera tiene un colNum
// mapeado -- no hay una sola métrica numérica "principal" en el esquema de
// vehiculos, otra razón más para no usar el dashboard genérico acá).
//
// DECISIÓN (no un dato inventado, una elección honesta): vehiculos.
// kilometraje_actual y postventa.kilometraje son dos números
// INDEPENDIENTES que pueden desincronizarse -- crear una orden de servicio
// con un kilometraje no actualiza el vehículo (confirmado en el backend).
// Este dashboard trata kilometraje_actual como el dato canónico (es lo que
// el taller mantiene a mano) y muestra las lecturas de postventa.kilometraje
// solo dentro del historial de cada orden, nunca para sobreescribir el
// kilometraje "actual" del vehículo.
//
// "Próximo servicio" y "garantía" no viven en la tabla vehiculos -- se
// derivan de las propias órdenes de Postventa de ese vehículo (el campo
// real está ahí, por orden, no en el vehículo).

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';
import { abrirPanelLateral } from '../components/panelLateral.js';
import { crearGraficoBarras, crearGraficoLineaFecha, crearGraficoDona } from './charts.js';

const ETIQUETA_TIPO = { mantenimiento: 'Mantenimiento', garantia: 'Garantía', reparacion: 'Reparación', revision: 'Revisión' };
const ETIQUETA_ESTADO = { pendiente: 'Pendiente', en_proceso: 'En proceso', completado: 'Completado' };
const VENTANA_ALERTA_DIAS = 30;

let vehiculosCache = [];
let postventaCache = [];
let eventosListos = false;
let chartMarca = null;
let chartAnio = null;
let chartGastoTiempo = null;
let chartGarantia = null;

function ultimosNMeses(n) {
  const hoy = new Date();
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}
function etiquetaMes(mesStr) {
  const [y, mm] = mesStr.split('-');
  return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('es-PE', { month: 'short', year: '2-digit' });
}

function diasHasta(fechaStr) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const f = new Date(fechaStr); f.setHours(0, 0, 0, 0);
  return Math.round((f - hoy) / 86400000);
}

function ordenesDeVehiculo(vehiculoId) {
  return postventaCache.filter(o => o.vehiculo_id === vehiculoId);
}

export function renderVehiculosDashboard(filasCrudas, backend) {
  vehiculosCache = filasCrudas || [];
  backend.listarDeModulo('postventa').then(postventa => {
    postventaCache = postventa || [];
    asegurarEventos();
    dibujar();
  });
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('vehFlota').addEventListener('click', (e) => {
    const fila = e.target.closest('.cliente-row');
    if (fila) abrirFichaVehiculo(fila.dataset.id);
  });
}

// Próximo evento (servicio programado o garantía vigente) entre TODAS las
// órdenes de un vehículo -- el más cercano hacia adelante, no el más
// reciente por fecha de creación.
function proximoEvento(ordenes) {
  const eventos = [];
  ordenes.forEach(o => {
    if (o.proximo_servicio) eventos.push({ tipo: 'servicio', fecha: o.proximo_servicio });
    if (o.garantia_hasta) eventos.push({ tipo: 'garantia', fecha: o.garantia_hasta });
  });
  const futuros = eventos.filter(e => diasHasta(e.fecha) >= 0).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return futuros[0] || null;
}

function dibujar() {
  const enriquecidos = vehiculosCache.map(v => {
    const ordenes = ordenesDeVehiculo(v.id);
    return {
      ...v,
      _ordenes: ordenes,
      _gastoTotal: ordenes.reduce((s, o) => s + (Number(o.total) || 0), 0),
      _proximo: proximoEvento(ordenes)
    };
  });

  dibujarKpis(enriquecidos);
  dibujarFlota(enriquecidos);
  dibujarGasto(enriquecidos);
  dibujarAtencion(enriquecidos);
  dibujarChartMarca(enriquecidos);
  dibujarChartAnio(enriquecidos);
  dibujarChartGastoTiempo();
  dibujarChartGarantia(enriquecidos);
}

function dibujarKpis(vehiculos) {
  const clientesUnicos = new Set(vehiculos.map(v => v.cliente_id).filter(Boolean));

  const conServicioProximo = vehiculos.filter(v => v._proximo?.tipo === 'servicio' && diasHasta(v._proximo.fecha) <= VENTANA_ALERTA_DIAS);
  const conGarantiaActiva = vehiculos.filter(v => v._ordenes.some(o => o.garantia_hasta && diasHasta(o.garantia_hasta) >= 0));

  const kmPromedio = vehiculos.length ? vehiculos.reduce((s, v) => s + (Number(v.kilometraje_actual) || 0), 0) / vehiculos.length : 0;
  const mayorKm = [...vehiculos].sort((a, b) => (Number(b.kilometraje_actual) || 0) - (Number(a.kilometraje_actual) || 0))[0];

  document.getElementById('vehKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🚗', label: 'Vehículos registrados', value: fmtNum(vehiculos.length), sub: `${clientesUnicos.size} cliente(s)` }),
    kpiCard({
      acento: conServicioProximo.length ? 'orange' : 'teal', icono: '🔧', label: 'Servicio próximo',
      value: fmtNum(conServicioProximo.length), sub: `en los próximos ${VENTANA_ALERTA_DIAS} días`
    }),
    kpiCard({ acento: 'purple', icono: '🛡️', label: 'Garantías activas', value: fmtNum(conGarantiaActiva.length), sub: 'con al menos una orden vigente' }),
    kpiCard({
      acento: 'teal', icono: '📟', label: 'Kilometraje promedio', value: fmtNum(kmPromedio),
      sub: mayorKm ? `Mayor: ${escapeHtml(mayorKm.placa)} (${fmtNum(Number(mayorKm.kilometraje_actual) || 0)} km)` : 'Sin vehículos'
    })
  ].join('');
}

function dibujarFlota(vehiculos) {
  const ordenados = [...vehiculos].sort((a, b) => (a._proximo ? diasHasta(a._proximo.fecha) : Infinity) - (b._proximo ? diasHasta(b._proximo.fecha) : Infinity));

  document.getElementById('vehFlota').innerHTML = ordenados.length ? ordenados.map(v => {
    let badge = '';
    if (v._proximo) {
      const dias = diasHasta(v._proximo.fecha);
      const urgente = dias <= 7;
      const etiqueta = v._proximo.tipo === 'servicio' ? 'Servicio' : 'Garantía';
      badge = `<span class="stock-risk-badge ${urgente ? 'stock-risk-critico' : 'stock-risk-bajo'}">${etiqueta}: ${dias}d</span>`;
    }
    return `<div class="cliente-row" data-id="${v.id}">
      <div class="cliente-row-info">
        <div class="cliente-row-nombre">${escapeHtml(v.marca)} ${escapeHtml(v.modelo)}${v.anio ? ' ' + escapeHtml(String(v.anio)) : ''} · ${escapeHtml(v.placa)}</div>
        <div class="cliente-row-contacto">${escapeHtml(v.cliente_nombre || 'Sin cliente')}</div>
      </div>
      ${badge}
      <div class="cliente-row-valor">
        <div class="rank-val">${fmtNum(Number(v.kilometraje_actual) || 0)} km</div>
        <div class="cliente-row-sub">${v._ordenes.length} orden(es) de servicio</div>
      </div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay vehículos registrados.</div>';
}

function dibujarGasto(vehiculos) {
  const top = [...vehiculos].filter(v => v._gastoTotal > 0).sort((a, b) => b._gastoTotal - a._gastoTotal).slice(0, 6);
  document.getElementById('vehGasto').innerHTML = top.length
    ? top.map((v, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(v.placa)} · ${escapeHtml(v.marca)} ${escapeHtml(v.modelo)}</span><span class="rank-val">${fmtNum(v._gastoTotal)}</span></div>`).join('')
    : '<div class="rank-row">Todavía no hay órdenes de servicio registradas.</div>';
}

function dibujarAtencion(vehiculos) {
  const conAlerta = vehiculos
    .filter(v => v._proximo && diasHasta(v._proximo.fecha) <= VENTANA_ALERTA_DIAS)
    .sort((a, b) => diasHasta(a._proximo.fecha) - diasHasta(b._proximo.fecha));

  document.getElementById('vehAtencion').innerHTML = conAlerta.length ? conAlerta.slice(0, 8).map(v => {
    const dias = diasHasta(v._proximo.fecha);
    const etiqueta = v._proximo.tipo === 'servicio' ? 'Servicio' : 'Garantía vence';
    return `<div class="rank-row">
      <span class="rank-name">${escapeHtml(v.placa)}<div class="rank-sub">${escapeHtml(v.cliente_nombre || '')}</div></span>
      <span class="rank-val" style="${dias <= 7 ? 'color:var(--danger);' : ''}">${escapeHtml(etiqueta)} · ${dias}d</span>
    </div>`;
  }).join('') : '<div class="rank-row">Ningún vehículo necesita atención en los próximos 30 días.</div>';
}

// Composición de la flota por fabricante -- útil para decidir de qué marca
// conviene tener más repuestos en stock, distinto del ranking de gasto (que
// es por vehículo puntual, no por marca).
function dibujarChartMarca(vehiculos) {
  const porMarca = new Map();
  vehiculos.forEach(v => { const m = v.marca || 'Sin marca'; porMarca.set(m, (porMarca.get(m) || 0) + 1); });
  const entradas = [...porMarca.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const wrap = document.getElementById('vehChartMarcaWrap');
  wrap.innerHTML = '<canvas id="vehChartMarca"></canvas>';
  if (chartMarca) { chartMarca.destroy(); chartMarca = null; }
  if (!entradas.length) { wrap.innerHTML = '<div class="chart-empty">Todavía no hay vehículos registrados.</div>'; return; }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim();
  const ctx = document.getElementById('vehChartMarca').getContext('2d');
  chartMarca = crearGraficoBarras(ctx, { etiquetas: entradas.map(e => e[0]), valores: entradas.map(e => e[1]), label: 'Vehículos', color });
}

// Antigüedad de la flota -- una flota vieja implica más mantenimiento
// preventivo; distinto de "por marca" (fabricante, no edad).
function dibujarChartAnio(vehiculos) {
  const porAnio = new Map();
  vehiculos.forEach(v => { if (!v.anio) return; porAnio.set(v.anio, (porAnio.get(v.anio) || 0) + 1); });
  const anios = [...porAnio.keys()].sort((a, b) => a - b);

  const wrap = document.getElementById('vehChartAnioWrap');
  wrap.innerHTML = '<canvas id="vehChartAnio"></canvas>';
  if (chartAnio) { chartAnio.destroy(); chartAnio = null; }
  if (!anios.length) { wrap.innerHTML = '<div class="chart-empty">Sin año registrado en los vehículos.</div>'; return; }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--purple').trim();
  const ctx = document.getElementById('vehChartAnio').getContext('2d');
  chartAnio = crearGraficoBarras(ctx, { etiquetas: anios.map(String), valores: anios.map(a => porAnio.get(a)), label: 'Vehículos', color });
}

// Tendencia del gasto de mantenimiento de TODA la flota mes a mes --
// distinto de "Mayor gasto en mantenimiento" (que rankea vehículos
// puntuales en un solo número acumulado, sin eje de tiempo).
function dibujarChartGastoTiempo() {
  const meses = ultimosNMeses(6);
  const porMes = new Map(meses.map(m => [m, 0]));
  postventaCache.forEach(o => {
    if (!o.fecha) return;
    const mes = String(o.fecha).slice(0, 7);
    if (porMes.has(mes)) porMes.set(mes, porMes.get(mes) + (Number(o.total) || 0));
  });

  const wrap = document.getElementById('vehChartGastoWrap');
  wrap.innerHTML = '<canvas id="vehChartGastoTiempo"></canvas>';
  if (chartGastoTiempo) { chartGastoTiempo.destroy(); chartGastoTiempo = null; }
  const total = [...porMes.values()].reduce((s, n) => s + n, 0);
  if (!total) { wrap.innerHTML = '<div class="chart-empty">Sin órdenes de servicio en los últimos 6 meses.</div>'; return; }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--orange').trim();
  const ctx = document.getElementById('vehChartGastoTiempo').getContext('2d');
  chartGastoTiempo = crearGraficoLineaFecha(ctx, {
    fechas: meses.map(etiquetaMes), valores: meses.map(m => porMes.get(m)), label: 'Gasto', color, colorFondo: 'rgba(201,138,60,0.14)'
  });
}

// Proporción de la flota en cada estado de garantía -- distinto de
// "Necesitan atención pronto" (esa es una lista de vehículos puntuales;
// acá es el panorama general de toda la flota).
function dibujarChartGarantia(vehiculos) {
  let vencePronto = 0, activa = 0, sinGarantia = 0;
  vehiculos.forEach(v => {
    const vigentes = v._ordenes.filter(o => o.garantia_hasta && diasHasta(o.garantia_hasta) >= 0);
    if (!vigentes.length) { sinGarantia++; return; }
    const masProxima = [...vigentes].sort((a, b) => diasHasta(a.garantia_hasta) - diasHasta(b.garantia_hasta))[0];
    if (diasHasta(masProxima.garantia_hasta) <= VENTANA_ALERTA_DIAS) vencePronto++; else activa++;
  });
  const COLOR_POR_ESTADO = { 'Sin garantía': '#7A8CAE', 'Activa': '#0F6E56', 'Vence pronto': '#C4544B' };
  const entradas = [['Sin garantía', sinGarantia], ['Activa', activa], ['Vence pronto', vencePronto]].filter(([, n]) => n > 0);

  const wrap = document.getElementById('vehChartGarantiaWrap');
  wrap.innerHTML = '<canvas id="vehChartGarantia"></canvas>';
  if (chartGarantia) { chartGarantia.destroy(); chartGarantia = null; }
  if (!entradas.length) { wrap.innerHTML = '<div class="chart-empty">Todavía no hay vehículos registrados.</div>'; return; }
  const ctx = document.getElementById('vehChartGarantia').getContext('2d');
  chartGarantia = crearGraficoDona(ctx, {
    etiquetas: entradas.map(e => e[0]), valores: entradas.map(e => e[1]),
    colores: entradas.map(e => COLOR_POR_ESTADO[e[0]])
  });
}

function abrirFichaVehiculo(id) {
  const vehiculo = vehiculosCache.find(v => String(v.id) === String(id));
  if (!vehiculo) return;

  const ordenes = ordenesDeVehiculo(vehiculo.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  const gastoTotal = ordenes.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const proximo = proximoEvento(ordenes);

  abrirPanelLateral({
    titulo: `${vehiculo.marca} ${vehiculo.modelo} · ${vehiculo.placa}`,
    icono: '🚗',
    montar: (body) => {
      body.innerHTML = `
        <div class="perfil-cliente-contacto">
          <div>👤 ${escapeHtml(vehiculo.cliente_nombre || 'Sin cliente')}</div>
          ${vehiculo.color ? `<div>🎨 ${escapeHtml(vehiculo.color)}</div>` : ''}
          ${vehiculo.vin ? `<div>🔑 VIN: ${escapeHtml(vehiculo.vin)}</div>` : ''}
          ${vehiculo.notas ? `<div class="perfil-cliente-notas">${escapeHtml(vehiculo.notas)}</div>` : ''}
        </div>
        <div class="perfil-cliente-kpis">
          <div><div class="label">Kilometraje</div><div class="value num">${fmtNum(Number(vehiculo.kilometraje_actual) || 0)}</div></div>
          <div><div class="label">Invertido</div><div class="value num">${fmtNum(gastoTotal)}</div></div>
          <div><div class="label">Órdenes</div><div class="value num">${ordenes.length}</div></div>
        </div>
        ${proximo ? `<div class="rank-row" style="margin-top:10px;"><span class="rank-name">${proximo.tipo === 'servicio' ? 'Próximo servicio' : 'Garantía vence'}</span><span class="rank-val">${escapeHtml(String(proximo.fecha).slice(0, 10))}</span></div>` : ''}
        <h4 class="perfil-cliente-subtitulo">Historial de servicio</h4>
        <div class="perfil-cliente-timeline">
          ${ordenes.length ? ordenes.map(o => `
            <div class="timeline-item">
              <span class="timeline-icono">🛠️</span>
              <div class="timeline-info">
                <div class="timeline-texto">${escapeHtml(ETIQUETA_TIPO[o.tipo] || o.tipo)}: ${escapeHtml(o.descripcion || '')}</div>
                <div class="timeline-fecha">${escapeHtml(String(o.fecha || '').slice(0, 10))} · ${escapeHtml(ETIQUETA_ESTADO[o.estado] || o.estado)} · ${fmtNum(Number(o.total) || 0)}</div>
              </div>
            </div>`).join('') : '<div class="rank-row">Todavía no hay órdenes de servicio para este vehículo.</div>'}
        </div>
      `;
    }
  });
}
