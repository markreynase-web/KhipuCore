// js/ventasDashboard.js
// Dashboard bespoke de Ventas (Rediseño v3): reemplaza el motor genérico de
// js/dashboard.js para este módulo -- "sales analytics + gestión comercial"
// con KPIs de negocio reales (ticket promedio, clientes recurrentes,
// producto estrella) en vez de columnas auto-detectadas de un CSV.
//
// Se engancha en js/app.js vía RENDERERS_BESPOKE, que le pasa las filas
// CRUDAS de /api/ventas (fecha, cliente, cliente_id, producto, producto_id,
// categoria, cantidad, precio_unitario, monto, notas) -- a propósito NO las
// filas transformadas de js/modoBackend.js (esas pierden cliente_id/
// producto_id y los campos crudos: solo guardan _fecha/_numero/_cat1/_cat2,
// pensadas para el motor genérico que no necesita más que eso).
//
// La tabla de registros (crear/editar/borrar una venta, "Vista Operativa")
// sigue siendo 100% genérica (components/formularioRegistro.js +
// tablaRegistros.js, dirigida por ESQUEMAS.ventas) -- este archivo solo
// reemplaza la "Vista Ejecutiva" (KPIs + gráficos + rankings).

import { fmtNum, escapeHtml } from './utils.js';
import { filtrarPeriodo } from './filters.js';
import { crearGraficoLineaFecha, crearGraficoDona } from './charts.js';
import { kpiCard, deltaPorcentaje } from './kpiCard.js';

let filasCache = [];
let periodoActual = 'mes';
let eventosListos = false;
let chartTendencia = null;
let chartCategoria = null;

function rangoDePeriodo(periodo) {
  const hoy = new Date();
  const hastaStr = hoy.toISOString().slice(0, 10);
  if (periodo === 'mes') {
    return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10), hasta: hastaStr };
  }
  if (periodo === '30d') {
    const d = new Date(hoy); d.setDate(d.getDate() - 29);
    return { desde: d.toISOString().slice(0, 10), hasta: hastaStr };
  }
  // 'anio'
  return { desde: new Date(hoy.getFullYear(), 0, 1).toISOString().slice(0, 10), hasta: hastaStr };
}

export function renderVentasDashboard(filasCrudas) {
  // filtrarPeriodo() (js/filters.js) espera un campo _fecha -- se agrega acá
  // en vez de tocar filters.js, que es genérico y lo usan otros módulos tal
  // cual está.
  filasCache = (filasCrudas || []).map(f => ({ ...f, _fecha: f.fecha ? String(f.fecha).slice(0, 10) : null }));
  asegurarEventos();
  dibujar();
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;

  document.querySelectorAll('#ventasPeriodoTabs .periodo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#ventasPeriodoTabs .periodo-tab').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      periodoActual = btn.dataset.periodo;
      document.getElementById('ventasPeriodoCustom').style.display = periodoActual === 'personalizado' ? '' : 'none';
      dibujar();
    });
  });
  document.getElementById('ventasDesde').addEventListener('change', dibujar);
  document.getElementById('ventasHasta').addEventListener('change', dibujar);
}

function dibujar() {
  let desde, hasta;
  if (periodoActual === 'personalizado') {
    desde = document.getElementById('ventasDesde').value;
    hasta = document.getElementById('ventasHasta').value;
    if (!desde || !hasta) { dibujarVacio(); return; }
  } else {
    ({ desde, hasta } = rangoDePeriodo(periodoActual));
  }

  const { actual, anterior } = filtrarPeriodo(filasCache, desde, hasta);
  dibujarKpis(actual, anterior);
  dibujarTendencia(actual);
  dibujarRankingProductos(actual);
  dibujarRankingClientes(actual);
  dibujarCategorias(actual);
}

function dibujarVacio() {
  document.getElementById('ventasKpis').innerHTML = '<div class="rank-row">Elegí un rango de fechas para ver el resumen.</div>';
  document.getElementById('ventasChartTendenciaWrap').innerHTML = '';
  document.getElementById('ventasChartCategoriaWrap').innerHTML = '';
  document.getElementById('ventasRankProductos').innerHTML = '';
  document.getElementById('ventasRankClientes').innerHTML = '';
}

function dibujarKpis(actual, anterior) {
  const totalActual = actual.reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const totalAnterior = anterior.reduce((s, f) => s + (Number(f.monto) || 0), 0);

  const ticketActual = actual.length ? totalActual / actual.length : 0;
  const ticketAnterior = anterior.length ? totalAnterior / anterior.length : 0;

  // cliente_id cuando existe (venta creada vía el selector real de cliente),
  // el nombre como respaldo (ventas importadas por CSV pueden no traer id).
  const clave = f => f.cliente_id || f.cliente;
  const clientesActuales = new Set(actual.map(clave).filter(Boolean));
  const clientesAnteriores = new Set(anterior.map(clave).filter(Boolean));
  const recurrentes = [...clientesActuales].filter(c => clientesAnteriores.has(c));

  const porProducto = new Map();
  actual.forEach(f => porProducto.set(f.producto, (porProducto.get(f.producto) || 0) + (Number(f.monto) || 0)));
  const topProducto = [...porProducto.entries()].sort((a, b) => b[1] - a[1])[0];

  document.getElementById('ventasKpis').innerHTML = [
    kpiCard({
      acento: 'teal', icono: '💰', label: 'Ventas del período', value: fmtNum(totalActual),
      sub: `${actual.length} venta(s)`, delta: deltaPorcentaje(totalActual, totalAnterior)
    }),
    kpiCard({
      acento: 'blue', icono: '🧾', label: 'Ticket promedio', value: fmtNum(ticketActual),
      sub: 'por venta', delta: deltaPorcentaje(ticketActual, ticketAnterior)
    }),
    kpiCard({
      acento: 'purple', icono: '👥', label: 'Clientes que compraron', value: fmtNum(clientesActuales.size),
      sub: clientesActuales.size ? `${recurrentes.length} recurrente(s) del período anterior` : 'Sin compras en el período'
    }),
    kpiCard({
      acento: 'orange', icono: '⭐', label: 'Producto estrella',
      value: topProducto ? escapeHtml(topProducto[0]) : '—',
      sub: topProducto ? `${fmtNum(topProducto[1])} en el período` : 'Sin ventas en el período'
    })
  ].join('');
}

function dibujarTendencia(actual) {
  const porDia = new Map();
  actual.forEach(f => { if (f._fecha) porDia.set(f._fecha, (porDia.get(f._fecha) || 0) + (Number(f.monto) || 0)); });
  const fechas = [...porDia.keys()].sort();

  const wrap = document.getElementById('ventasChartTendenciaWrap');
  wrap.innerHTML = '<canvas id="ventasChartTendencia"></canvas>';
  if (chartTendencia) { chartTendencia.destroy(); chartTendencia = null; }
  if (!fechas.length) {
    wrap.innerHTML = '<div class="chart-empty">Sin ventas en este período.</div>';
    return;
  }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim();
  const ctx = document.getElementById('ventasChartTendencia').getContext('2d');
  chartTendencia = crearGraficoLineaFecha(ctx, {
    fechas, valores: fechas.map(f => porDia.get(f)), label: 'Ventas', color, colorFondo: 'rgba(15,166,156,0.12)'
  });
}

function dibujarRankingProductos(actual) {
  const porProducto = new Map();
  actual.forEach(f => porProducto.set(f.producto, (porProducto.get(f.producto) || 0) + (Number(f.monto) || 0)));
  const top = [...porProducto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  document.getElementById('ventasRankProductos').innerHTML = top.length
    ? top.map((r, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(r[0])}</span><span class="rank-val">${fmtNum(r[1])}</span></div>`).join('')
    : '<div class="rank-row">Sin ventas en este período.</div>';
}

function dibujarRankingClientes(actual) {
  const porCliente = new Map();
  actual.forEach(f => {
    const nombre = f.cliente || 'Sin cliente';
    porCliente.set(nombre, (porCliente.get(nombre) || 0) + (Number(f.monto) || 0));
  });
  const top = [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  document.getElementById('ventasRankClientes').innerHTML = top.length
    ? top.map((r, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(r[0])}</span><span class="rank-val">${fmtNum(r[1])}</span></div>`).join('')
    : '<div class="rank-row">Sin ventas en este período.</div>';
}

function dibujarCategorias(actual) {
  const porCategoria = new Map();
  actual.forEach(f => {
    const cat = f.categoria || 'Sin categoría';
    porCategoria.set(cat, (porCategoria.get(cat) || 0) + (Number(f.monto) || 0));
  });
  const entradas = [...porCategoria.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const wrap = document.getElementById('ventasChartCategoriaWrap');
  wrap.innerHTML = '<canvas id="ventasChartCategoria"></canvas>';
  if (chartCategoria) { chartCategoria.destroy(); chartCategoria = null; }
  if (!entradas.length) {
    wrap.innerHTML = '<div class="chart-empty">Sin ventas en este período.</div>';
    return;
  }
  const ctx = document.getElementById('ventasChartCategoria').getContext('2d');
  chartCategoria = crearGraficoDona(ctx, { etiquetas: entradas.map(e => e[0]), valores: entradas.map(e => e[1]) });
}
