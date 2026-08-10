// js/kpiCard.js
// Tarjeta KPI reutilizable entre dashboards bespoke (Inicio, Ventas, y los
// que sigan -- Rediseño v3: "cada módulo tiene su propia experiencia" pero
// comparten los mismos bloques de UI). Antes vivía duplicado como función
// local dentro del <script> inline de pages/inicio.html; se movió acá para
// que Ventas (y los próximos módulos bespoke) no tengan que reescribirlo.

import { escapeHtml } from './utils.js';

export function kpiCard({ acento, icono, label, value, sub, barra = 85, delta = null }) {
  const deltaHtml = delta
    ? `<div class="kpi-card-delta ${delta.direccion}">${delta.direccion === 'up' ? '▲' : '▼'} ${delta.texto}</div>`
    : '';
  return `<div class="kpi-card" data-acento="${acento}">
    <div class="kpi-card-icon">${icono}</div>
    <div class="label">${escapeHtml(label)}</div>
    <div class="value num">${value}</div>
    ${deltaHtml}
    <div class="sub">${sub || ''}</div>
    <div class="kpi-card-bar"><div class="kpi-card-bar-fill" style="width:${barra}%"></div></div>
  </div>`;
}

// Compara dos sumas ya calculadas (período actual vs. anterior) y arma el
// objeto {direccion, texto} que espera kpiCard(). null si el período
// anterior es 0 -- un "% vs. anterior" calculado desde cero sería un
// número inventado, no una tendencia real.
export function deltaPorcentaje(actual, anterior, sufijo = 'vs. período anterior') {
  if (!anterior) return null;
  const pct = ((actual - anterior) / anterior) * 100;
  return { direccion: pct >= 0 ? 'up' : 'down', texto: `${Math.abs(pct).toFixed(1)}% ${sufijo}` };
}

// Caso especial de deltaPorcentaje: mes calendario actual vs. mes calendario
// anterior, sumando un campo monto sobre filas con un campo fecha. Lo usa
// Inicio, donde el "período" siempre es el mes -- no un rango que el
// usuario elige (a diferencia de Ventas, que sí tiene su propio selector).
export function calcularDeltaMensual(filas, campoFecha, campoMonto, filtroTipo) {
  const hoy = new Date();
  const mesActual = hoy.getMonth(), anioActual = hoy.getFullYear();
  const refPrevio = new Date(anioActual, mesActual - 1, 1);
  const sumaMes = (mes, anio) => filas
    .filter(f => (!filtroTipo || filtroTipo(f)) && f[campoFecha])
    .filter(f => { const d = new Date(f[campoFecha]); return d.getMonth() === mes && d.getFullYear() === anio; })
    .reduce((s, f) => s + (Number(f[campoMonto]) || 0), 0);
  return deltaPorcentaje(sumaMes(mesActual, anioActual), sumaMes(refPrevio.getMonth(), refPrevio.getFullYear()));
}
