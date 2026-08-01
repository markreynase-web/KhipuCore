// js/charts.js
// Construcción de gráficos Chart.js. No conoce nada del CSV ni del estado global,
// solo recibe datos ya agregados y un canvas.

import { fmtCorto } from './utils.js';

export function crearGraficoLineaFecha(ctx, { fechas, valores, label, color, colorFondo }) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: fechas, datasets: [{ label, data: valores, borderColor: color, backgroundColor: colorFondo, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { grid: { color: '#E4DCC8' } } } }
  });
}

export function crearGraficoBarras(ctx, { etiquetas, valores, label, color }) {
  return new Chart(ctx, {
    type: 'bar',
    data: { labels: etiquetas, datasets: [{ label, data: valores, backgroundColor: color }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 45 } }, y: { grid: { color: '#E4DCC8' } } } }
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
      plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, font: { size: 12 } } } },
      scales: { x: { grid: { display: false } }, y: { grid: { color: '#E6E8F0' }, ticks: { callback: v => fmtCorto(v) } } }
    }
  });
}

export function crearGraficoLineaSecundario(ctx, { fechas, valores, label, color, colorFondo }) {
  return new Chart(ctx, {
    type: 'line',
    data: { labels: fechas, datasets: [{ label, data: valores, borderColor: color, backgroundColor: colorFondo, fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 10 } } }, y: { grid: { color: '#E4DCC8' }, ticks: { maxTicksLimit: 5, font: { size: 10 }, callback: v => fmtCorto(v) } } } }
  });
}

export function crearGraficoBarrasSecundario(ctx, { etiquetas, valores, label, color }) {
  return new Chart(ctx, {
    type: 'bar',
    data: { labels: etiquetas, datasets: [{ label, data: valores, backgroundColor: color }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxRotation: 45, font: { size: 10 } } }, y: { grid: { color: '#E4DCC8' }, ticks: { maxTicksLimit: 5, font: { size: 10 }, callback: v => fmtCorto(v) } } } }
  });
}
