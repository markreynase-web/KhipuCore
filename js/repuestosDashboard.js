// js/repuestosDashboard.js
// Dashboard bespoke de Repuestos (Rediseño v3): "búsqueda rápida y
// disponibilidad" -- un buscador en vivo como pieza central (no KPIs
// primero), mostrando ubicación en almacén y stock de cada resultado, en
// vez del dashboard genérico de columnas auto-detectadas.
//
// Rotación ("Más usados"): mismo cálculo que velocidadDeVentaDeProducto()
// en backend/src/khipuAiTools.js (rama repuestos) y que ya usa
// js/inventarioDashboard.js para Inventario -- unidades usadas en los
// últimos 30 días / 30 = ritmo diario. Acá la fuente es
// postventa.cantidad_repuesto (no ventas.cantidad), porque Repuestos se
// consume desde Postventa, no desde Ventas.
//
// LIMITACIÓN REAL (no inventada): compatibilidad/equivalencias son texto
// libre, sin estructura ni relación con la tabla vehiculos (confirmado en
// el esquema y la migración) -- el buscador hace coincidencia de texto
// sobre esos campos, no un filtro real "compatible con Toyota Corolla
// 2018". Un filtro estructurado por vehículo necesitaría un modelo de
// datos nuevo, no es algo que se pueda armar solo del lado del cliente.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';
import { nivelRiesgoStock } from './stockRisk.js';

const VENTANA_VELOCIDAD_DIAS = 30;

let repuestosCache = [];
let postventaCache = [];
let terminoBusqueda = '';
let eventosListos = false;

function calcularVelocidad(repuesto, postventa) {
  const limite = new Date(); limite.setDate(limite.getDate() - VENTANA_VELOCIDAD_DIAS);
  const unidades = postventa
    .filter(o => o.repuesto_id === repuesto.id && o.fecha && new Date(o.fecha) >= limite)
    .reduce((s, o) => s + (Number(o.cantidad_repuesto) || 0), 0);
  const ritmoDiario = unidades / VENTANA_VELOCIDAD_DIAS;
  return {
    unidades,
    diasRestantes: ritmoDiario > 0 ? Math.round(Number(repuesto.stock) / ritmoDiario) : null
  };
}

export function renderRepuestosDashboard(filasCrudas, backend) {
  repuestosCache = filasCrudas || [];
  backend.listarDeModulo('postventa').then(postventa => {
    postventaCache = postventa || [];
    asegurarEventos();
    dibujar();
  });
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;
  document.getElementById('repBuscador').addEventListener('input', (e) => {
    terminoBusqueda = e.target.value.trim().toLowerCase();
    dibujarResultados(conVelocidad());
  });
}

function conVelocidad() {
  return repuestosCache.map(r => ({ ...r, _velocidad: calcularVelocidad(r, postventaCache) }));
}

function dibujar() {
  const enriquecidos = conVelocidad();
  dibujarKpis(enriquecidos);
  dibujarResultados(enriquecidos);
  dibujarMasUsados();
}

function dibujarKpis(repuestos) {
  const valor = repuestos.reduce((s, r) => s + (Number(r.stock) || 0) * (Number(r.costo_unitario) || 0), 0);
  const alertas = repuestos.map(r => nivelRiesgoStock(r.stock, r.stock_minimo)).filter(Boolean);
  const criticos = alertas.filter(a => a.nivel === 'critico').length;
  const sinMovimiento = repuestos.filter(r => (Number(r.stock) || 0) > 0 && r._velocidad.unidades === 0).length;

  const conTiempo = repuestos.filter(r => r.tiempo_reposicion_dias);
  const promedioReposicion = conTiempo.length ? conTiempo.reduce((s, r) => s + Number(r.tiempo_reposicion_dias), 0) / conTiempo.length : null;

  document.getElementById('repKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '🔧', label: 'Repuestos registrados', value: fmtNum(repuestos.length), sub: `${fmtNum(valor)} en stock` }),
    kpiCard({
      acento: alertas.length ? 'orange' : 'teal', icono: '⚠️', label: 'Alertas de stock', value: fmtNum(alertas.length),
      sub: criticos ? `${criticos} en nivel crítico` : (alertas.length ? 'Ninguno crítico todavía' : 'Todo por encima del mínimo')
    }),
    kpiCard({ acento: 'purple', icono: '🐌', label: 'Sin movimiento', value: fmtNum(sinMovimiento), sub: `Sin uso en ${VENTANA_VELOCIDAD_DIAS} días` }),
    kpiCard({
      acento: 'teal', icono: '⏱️', label: 'Reposición promedio',
      value: promedioReposicion === null ? '—' : `${fmtNum(promedioReposicion)} d`,
      sub: promedioReposicion === null ? 'Sin datos de tiempo de reposición' : 'desde que se pide hasta que llega'
    })
  ].join('');
}

function coincide(r, termino) {
  if (!termino) return true;
  const campos = [r.nombre, r.codigo_oem, r.compatibilidad, r.equivalencias, r.proveedor, r.ubicacion];
  return campos.some(c => (c || '').toLowerCase().includes(termino));
}

function dibujarResultados(repuestos) {
  const filtrados = repuestos.filter(r => coincide(r, terminoBusqueda));
  const ordenados = [...filtrados].sort((a, b) => {
    const ra = nivelRiesgoStock(a.stock, a.stock_minimo), rb = nivelRiesgoStock(b.stock, b.stock_minimo);
    const pa = ra ? (ra.nivel === 'critico' ? 0 : 1) : 2, pb = rb ? (rb.nivel === 'critico' ? 0 : 1) : 2;
    return pa - pb || String(a.nombre).localeCompare(String(b.nombre));
  });

  const contador = document.getElementById('repResultadosCount');
  contador.textContent = terminoBusqueda ? `${ordenados.length} resultado(s)` : `${ordenados.length} repuesto(s)`;

  document.getElementById('repResultados').innerHTML = ordenados.length ? ordenados.slice(0, 60).map(r => {
    const riesgo = nivelRiesgoStock(r.stock, r.stock_minimo);
    const badge = riesgo ? `<span class="stock-risk-badge stock-risk-${riesgo.nivel}">${riesgo.icono} ${riesgo.etiqueta}</span>` : '';
    const sub = [
      r.codigo_oem ? `OEM ${r.codigo_oem}` : null,
      r.ubicacion ? `📍 ${r.ubicacion}` : null,
      r.proveedor ? `Proveedor: ${r.proveedor}` : null
    ].filter(Boolean).join(' · ');
    return `<div class="rank-row">
      <span class="rank-name">${escapeHtml(r.nombre)}${sub ? `<div class="rank-sub">${escapeHtml(sub)}</div>` : ''}</span>
      ${badge}
      <span class="rank-val">${fmtNum(Number(r.stock))} u.</span>
    </div>`;
  }).join('') : `<div class="rank-row">${terminoBusqueda ? 'Sin resultados para tu búsqueda.' : 'Todavía no hay repuestos registrados.'}</div>`;
}

function dibujarMasUsados() {
  const conUso = repuestosCache
    .map(r => ({ r, unidades: calcularVelocidad(r, postventaCache).unidades }))
    .filter(x => x.unidades > 0)
    .sort((a, b) => b.unidades - a.unidades)
    .slice(0, 8);

  document.getElementById('repMasUsados').innerHTML = conUso.length
    ? conUso.map((x, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(x.r.nombre)}</span><span class="rank-val">${fmtNum(x.unidades)} u.</span></div>`).join('')
    : `<div class="rank-row">Sin uso registrado en los últimos ${VENTANA_VELOCIDAD_DIAS} días.</div>`;
}
