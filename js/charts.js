// js/charts.js
// Construcción de gráficos Chart.js. No conoce nada del CSV ni del estado global,
// solo recibe datos ya agregados y un canvas.
//
// Paleta: mismos tonos que css/base.css (coral, azul, verde, naranja, morado)
// para que los gráficos combinen con las tarjetas KPI y el resto del rediseño,
// en vez de los ochre/teal de la versión "papel" original.

import { fmtCorto, fmtNum } from './utils.js';

const GRID = '#E1E7F0';

// Colores para gráficos con varias porciones/series a la vez (dona, barras
// agrupadas). Se repite en orden -- con las 8 categorías que ya recorta el
// dashboard (slice(0,8)) alcanza sin repetir.
export const PALETA_CATEGORICA = ['#E85C4A', '#1A4FBF', '#0F6E56', '#B8871F', '#5B4FE0', '#2FA8A0', '#C8493A', '#7A8CAE'];

export function crearGraficoLineaFecha(ctx, { fechas, valores, label, color, colorFondo }) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: fechas, datasets: [{ label, data: valores, borderColor: color, backgroundColor: colorFondo, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 20, pointHoverBackgroundColor: color, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      // mode:'index' + intersect:false: el tooltip aparece con solo pasar el
      // mouse por la posición X que sea, sin tener que acertarle al punto
      // exacto (que además es invisible -- pointRadius:0 -- mientras no se
      // pasa el mouse encima).
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctxItem => ` ${label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: GRID } } }
    }
  });
}

export function crearGraficoBarras(ctx, { etiquetas, valores, label, color }) {
  return new Chart(ctx, {
    type: 'bar',
    data: { labels: etiquetas, datasets: [{ label, data: valores, backgroundColor: color, borderRadius: 6, borderSkipped: false, maxBarThickness: 46 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctxItem => ` ${label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { grid: { color: GRID } } }
    }
  });
}

// Dos series (Ingresos/Egresos) en el mismo eje X, con tooltip combinado
// (mode:'index' -- al pasar el mouse sobre un mes muestra ambos valores a
// la vez). Para el panel "Resumen de ingresos vs. egresos" de Inicio.
export function crearGraficoLineasComparativo(ctx, { etiquetas, serieA, serieB, labelA, labelB, colorA, colorB }) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: etiquetas,
      datasets: [
        { label: labelA, data: serieA, borderColor: colorA, backgroundColor: colorA, fill: false, tension: 0.3, pointRadius: 3, pointBackgroundColor: colorA, borderWidth: 2 },
        { label: labelB, data: serieB, borderColor: colorB, backgroundColor: colorB, fill: false, tension: 0.3, pointRadius: 3, pointBackgroundColor: colorB, borderWidth: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctxItem => ` ${ctxItem.dataset.label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false } }, y: { grid: { color: GRID }, ticks: { callback: v => fmtCorto(v) } } }
    }
  });
}

// Dona para "Distribución por X": mismo dato que antes se mostraba como
// barras de progreso apiladas (cat-row), ahora como proporción del total,
// que es lo que un gráfico circular comunica mejor. El hueco central (cutout)
// deja espacio para leer las porciones más chicas sin que se aplasten.
export function crearGraficoDona(ctx, { etiquetas, valores, colores = PALETA_CATEGORICA }) {
  return new Chart(ctx, {
    type: 'doughnut',
    data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores, borderColor: '#fff', borderWidth: 2, hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 }, padding: 10 } },
        tooltip: { callbacks: { label: ctxItem => ` ${ctxItem.label}: ${fmtCorto(ctxItem.parsed)}` } }
      }
    }
  });
}

// Dos series en barras agrupadas lado a lado (ej. "Costo vs. valor de venta
// por categoría", "Abiertos vs. completados por mes") -- mismo patrón de
// tooltip combinado que crearGraficoLineasComparativo, pero en barras
// porque acá se compara categorías discretas, no una tendencia continua.
export function crearGraficoBarrasComparativo(ctx, { etiquetas, serieA, serieB, labelA, labelB, colorA, colorB }) {
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: [
        { label: labelA, data: serieA, backgroundColor: colorA, borderRadius: 5, borderSkipped: false, maxBarThickness: 28 },
        { label: labelB, data: serieB, backgroundColor: colorB, borderRadius: 5, borderSkipped: false, maxBarThickness: 28 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { size: 12 } } },
        tooltip: { callbacks: { label: ctxItem => ` ${ctxItem.dataset.label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { grid: { color: GRID } } }
    }
  });
}

export function crearGraficoLineaSecundario(ctx, { fechas, valores, label, color, colorFondo }) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: fechas, datasets: [{ label, data: valores, borderColor: color, backgroundColor: colorFondo, fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 20, pointHoverBackgroundColor: color, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctxItem => ` ${label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { maxTicksLimit: 5, font: { size: 10 }, callback: v => fmtCorto(v) } } }
    }
  });
}

export function crearGraficoBarrasSecundario(ctx, { etiquetas, valores, label, color }) {
  return new Chart(ctx, {
    type: 'bar',
    data: { labels: etiquetas, datasets: [{ label, data: valores, backgroundColor: color, borderRadius: 5, borderSkipped: false }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctxItem => ` ${label}: ${fmtNum(ctxItem.parsed.y)}` } }
      },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }, y: { grid: { color: GRID }, ticks: { maxTicksLimit: 5, font: { size: 10 }, callback: v => fmtCorto(v) } } }
    }
  });
}
