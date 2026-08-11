// js/finanzasDashboard.js
// Dashboard bespoke de Finanzas (Rediseño v3): "salud financiera", no un
// dashboard de KPIs genéricos -- balance como pieza central (estilo
// resumen bancario), gastos por categoría, y un libro de movimientos
// recientes (ledger cronológico) en vez de un ranking. A propósito la
// experiencia visual más distinta de las tres bespoke ya hechas (Ventas:
// tabs+rankings: Clientes: segmentos+perfil), tal como pidió el usuario
// para este módulo en particular.
//
// Reemplaza el motor genérico de js/dashboard.js (incluida la rama especial
// que tenía js/app.js solo para Finanzas -- opcionesGraficoPrincipal()/
// dibujarGraficoFinanzas() -- que ahora queda sin uso, ver la limpieza en
// ese archivo).

import { fmtNum, escapeHtml } from './utils.js';
import { filtrarPeriodo } from './filters.js';
import { crearGraficoLineasComparativo } from './charts.js';
import { kpiCard } from './kpiCard.js';

let filasCache = [];
let periodoActual = 'mes';
let eventosListos = false;
let chartTendencia = null;

function rangoDePeriodo(periodo) {
  const hoy = new Date();
  const hastaStr = hoy.toISOString().slice(0, 10);
  if (periodo === 'mes') return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10), hasta: hastaStr };
  if (periodo === '30d') { const d = new Date(hoy); d.setDate(d.getDate() - 29); return { desde: d.toISOString().slice(0, 10), hasta: hastaStr }; }
  return { desde: new Date(hoy.getFullYear(), 0, 1).toISOString().slice(0, 10), hasta: hastaStr };
}

function sumaPorTipo(filas, tipo) {
  return filas.filter(f => f.tipo === tipo).reduce((s, f) => s + (Number(f.monto) || 0), 0);
}

export function renderFinanzasDashboard(filasCrudas) {
  filasCache = (filasCrudas || []).map(f => ({ ...f, _fecha: f.fecha ? String(f.fecha).slice(0, 10) : null }));
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;

  document.querySelectorAll('#finPeriodoTabs .periodo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#finPeriodoTabs .periodo-tab').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      periodoActual = btn.dataset.periodo;
      document.getElementById('finPeriodoCustom').style.display = periodoActual === 'personalizado' ? '' : 'none';
      dibujar();
    });
  });
  document.getElementById('finDesde').addEventListener('change', dibujar);
  document.getElementById('finHasta').addEventListener('change', dibujar);
}

function dibujar() {
  let desde, hasta;
  if (periodoActual === 'personalizado') {
    desde = document.getElementById('finDesde').value;
    hasta = document.getElementById('finHasta').value;
    if (!desde || !hasta) { dibujarVacio(); return; }
  } else {
    ({ desde, hasta } = rangoDePeriodo(periodoActual));
  }

  const { actual, anterior } = filtrarPeriodo(filasCache, desde, hasta);
  dibujarHero(actual, anterior);
  dibujarKpis(actual, desde, hasta);
  dibujarTendencia(actual);
  dibujarCategorias(actual);
  dibujarMovimientos(actual);
}

function dibujarVacio() {
  ['finBalance', 'finBalanceDelta', 'finIngresos', 'finEgresos'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = '—'; });
  document.getElementById('finKpis').innerHTML = '';
  document.getElementById('finChartTendenciaWrap').innerHTML = '';
  document.getElementById('finCategorias').innerHTML = '';
  document.getElementById('finMovimientos').innerHTML = '<div class="rank-row">Elegí un rango de fechas para ver el resumen.</div>';
}

function dibujarHero(actual, anterior) {
  const ingresos = sumaPorTipo(actual, 'ingreso');
  const egresos = sumaPorTipo(actual, 'egreso');
  const balance = ingresos - egresos;
  const balanceAnterior = sumaPorTipo(anterior, 'ingreso') - sumaPorTipo(anterior, 'egreso');
  // deltaPorcentaje() genérico asume un "anterior" positivo -- un balance
  // anterior en negativo (más egresos que ingresos ese período) invertiría
  // el signo del cambio. Mismo ajuste que ya se hizo en pages/inicio.html
  // para el KPI de Balance: dividir por el valor absoluto.
  const delta = balanceAnterior
    ? { direccion: balance >= balanceAnterior ? 'up' : 'down', texto: `${Math.abs(((balance - balanceAnterior) / Math.abs(balanceAnterior)) * 100).toFixed(1)}% vs. período anterior` }
    : null;

  document.getElementById('finBalance').textContent = fmtNum(balance);
  document.getElementById('finIngresos').textContent = fmtNum(ingresos);
  document.getElementById('finEgresos').textContent = fmtNum(egresos);

  const deltaEl = document.getElementById('finBalanceDelta');
  if (delta) {
    deltaEl.textContent = `${delta.direccion === 'up' ? '▲' : '▼'} ${delta.texto}`;
    deltaEl.className = `fin-hero-delta ${delta.direccion}`;
  } else {
    deltaEl.textContent = `${actual.length} movimiento(s) en el período`;
    deltaEl.className = 'fin-hero-delta';
  }
}

function dibujarKpis(actual, desde, hasta) {
  const ingresos = sumaPorTipo(actual, 'ingreso');
  const egresos = sumaPorTipo(actual, 'egreso');
  const margen = ingresos > 0 ? ((ingresos - egresos) / ingresos) * 100 : null;

  const porCategoria = new Map();
  actual.filter(f => f.tipo === 'egreso').forEach(f => {
    const cat = f.categoria || 'Sin categoría';
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + (Number(f.monto) || 0));
  });
  const topCategoria = [...porCategoria.entries()].sort((a, b) => b[1] - a[1])[0];

  const dias = Math.max(1, Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1);
  const promedioDiario = egresos / dias;

  document.getElementById('finKpis').innerHTML = [
    kpiCard({
      acento: margen === null ? 'blue' : (margen >= 0 ? 'teal' : 'orange'), icono: '📈', label: 'Margen neto',
      value: margen === null ? '—' : `${margen.toFixed(1)}%`,
      sub: margen === null ? 'Sin ingresos en el período' : (margen >= 0 ? 'Ingresos cubren los egresos' : 'Egresos superan los ingresos')
    }),
    kpiCard({
      acento: 'orange', icono: '🏷️', label: 'Mayor categoría de gasto',
      value: topCategoria ? escapeHtml(topCategoria[0]) : '—',
      sub: topCategoria ? `${fmtNum(topCategoria[1])} en el período` : 'Sin egresos en el período'
    }),
    kpiCard({
      acento: 'purple', icono: '📆', label: 'Gasto promedio diario', value: fmtNum(promedioDiario),
      sub: `sobre ${dias} día(s)`
    })
  ].join('');
}

function dibujarTendencia(actual) {
  const porDiaIngreso = new Map(), porDiaEgreso = new Map();
  actual.forEach(f => {
    if (!f._fecha) return;
    const mapa = f.tipo === 'ingreso' ? porDiaIngreso : porDiaEgreso;
    mapa.set(f._fecha, (mapa.get(f._fecha) || 0) + (Number(f.monto) || 0));
  });
  const fechas = [...new Set([...porDiaIngreso.keys(), ...porDiaEgreso.keys()])].sort();

  const wrap = document.getElementById('finChartTendenciaWrap');
  wrap.innerHTML = '<canvas id="finChartTendencia"></canvas>';
  if (chartTendencia) { chartTendencia.destroy(); chartTendencia = null; }
  if (!fechas.length) {
    wrap.innerHTML = '<div class="chart-empty">Sin movimientos en este período.</div>';
    return;
  }
  const estilos = getComputedStyle(document.documentElement);
  const ctx = document.getElementById('finChartTendencia').getContext('2d');
  chartTendencia = crearGraficoLineasComparativo(ctx, {
    etiquetas: fechas,
    serieA: fechas.map(f => porDiaIngreso.get(f) || 0), serieB: fechas.map(f => porDiaEgreso.get(f) || 0),
    labelA: 'Ingresos', labelB: 'Egresos',
    colorA: estilos.getPropertyValue('--teal').trim(), colorB: estilos.getPropertyValue('--danger').trim()
  });
}

function dibujarCategorias(actual) {
  const egresos = actual.filter(f => f.tipo === 'egreso');
  const porCategoria = new Map();
  egresos.forEach(f => {
    const cat = f.categoria || 'Sin categoría';
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + (Number(f.monto) || 0));
  });
  const total = [...porCategoria.values()].reduce((s, v) => s + v, 0);
  const entradas = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  document.getElementById('finCategorias').innerHTML = entradas.length ? entradas.map(([cat, monto]) => {
    const pct = total ? (monto / total) * 100 : 0;
    return `<div class="cat-row">
      <div class="top"><span>${escapeHtml(cat)}</span><span>${fmtNum(monto)} · ${pct.toFixed(0)}%</span></div>
      <div class="cat-bar-bg"><div class="cat-bar-fill" style="width:${pct.toFixed(0)}%; background:var(--danger);"></div></div>
    </div>`;
  }).join('') : '<div class="rank-row">Sin egresos en este período.</div>';
}

function dibujarMovimientos(actual) {
  const ordenados = [...actual].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || (b.id - a.id)).slice(0, 12);

  document.getElementById('finMovimientos').innerHTML = ordenados.length ? ordenados.map(f => {
    const esIngreso = f.tipo === 'ingreso';
    return `<div class="movimiento-row">
      <span class="movimiento-icono ${esIngreso ? 'ingreso' : 'egreso'}">${esIngreso ? '↑' : '↓'}</span>
      <div class="movimiento-info">
        <div class="movimiento-concepto">${escapeHtml(f.concepto || 'Sin concepto')}</div>
        <div class="movimiento-meta">${escapeHtml(f.categoria || 'Sin categoría')} · ${escapeHtml(String(f.fecha || '').slice(0, 10))}</div>
      </div>
      <div class="movimiento-monto ${esIngreso ? 'ingreso' : 'egreso'}">${esIngreso ? '+' : '−'}${fmtNum(Number(f.monto) || 0)}</div>
    </div>`;
  }).join('') : '<div class="rank-row">Sin movimientos en este período.</div>';
}
