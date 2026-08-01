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
