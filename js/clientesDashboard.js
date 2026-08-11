// js/clientesDashboard.js
// Dashboard bespoke de Clientes (Rediseño v3): "CRM-style" -- segmentación
// real por comportamiento de compra (no inventada: se deriva de ventas.js y
// clientes.compras_totales), un listado inteligente filtrable por segmento,
// y un perfil de cliente (panel lateral) con timeline de ventas + postventa
// combinadas. Reemplaza el motor genérico de js/dashboard.js para este
// módulo, igual que js/ventasDashboard.js ya hace con Ventas.
//
// A diferencia de Ventas, este dashboard necesita datos de OTROS módulos
// (ventas y postventa, para el historial de cada cliente) -- por eso
// js/app.js le pasa también `backend` (el objeto de js/modoBackend.js), no
// solo las filas de clientes. No existe un endpoint tipo
// GET /clientes/:id/ventas en el backend (confirmado): se trae todo una vez
// y se filtra client-side, mismo patrón ya usado en ventasDashboard.js.

import { fmtNum, escapeHtml } from './utils.js';
import { filtrarPeriodo } from './filters.js';
import { kpiCard, deltaPorcentaje } from './kpiCard.js';
import { abrirPanelLateral } from '../components/panelLateral.js';
import { crearGraficoDona, crearGraficoBarras } from './charts.js';

const SEGMENTOS = {
  vip:           { label: 'VIP',           icono: '👑' },
  recurrente:    { label: 'Recurrente',    icono: '🔁' },
  activo:        { label: 'Activo',        icono: '🟢' },
  en_riesgo:     { label: 'En riesgo',     icono: '⚠️' },
  sin_actividad: { label: 'Sin actividad', icono: '⚪' }
};
const ETIQUETA_POSTVENTA = { mantenimiento: 'Mantenimiento', garantia: 'Garantía', reparacion: 'Reparación', revision: 'Revisión' };

// Un cliente sin compras hace más de este umbral se marca "en riesgo"
// (siempre que ya haya comprado antes -- un cliente que nunca compró es
// "sin actividad", no "en riesgo").
const DIAS_RIESGO = 60;

let clientesCache = [];
let ventasCache = [];
let postventaCache = [];
let periodoActual = 'mes';
let segmentoFiltro = null;
let eventosListos = false;
let chartSegmento = null;
let chartNuevos = null;
let chartValor = null;
let chartFrecuencia = null;

function rangoDePeriodo(periodo) {
  const hoy = new Date();
  const hastaStr = hoy.toISOString().slice(0, 10);
  if (periodo === 'mes') return { desde: new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10), hasta: hastaStr };
  if (periodo === '30d') { const d = new Date(hoy); d.setDate(d.getDate() - 29); return { desde: d.toISOString().slice(0, 10), hasta: hastaStr }; }
  return { desde: new Date(hoy.getFullYear(), 0, 1).toISOString().slice(0, 10), hasta: hastaStr };
}

function tiempoRelativo(fechaStr) {
  if (!fechaStr) return 'Sin compras';
  const dias = Math.floor((Date.now() - new Date(fechaStr).getTime()) / 86400000);
  if (dias <= 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  if (dias < 30) return `Hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `Hace ${meses} mes${meses === 1 ? '' : 'es'}`;
  return `Hace ${Math.floor(meses / 12)} año${Math.floor(meses / 12) === 1 ? '' : 's'}`;
}

// Ventas de un cliente puntual: por cliente_id cuando existe, por nombre
// como respaldo (ventas importadas por CSV pueden no traer id).
function ventasDeCliente(clienteId, nombreCliente) {
  return ventasCache.filter(f => (f.cliente_id && clienteId && f.cliente_id === clienteId) || (!f.cliente_id && f.cliente === nombreCliente));
}

export function renderClientesDashboard(filasCrudas, backend) {
  clientesCache = filasCrudas || [];
  // listarDeModulo() nunca rechaza (js/api.js's listarRegistros() devuelve
  // null ante cualquier error, incluido "la empresa no tiene Postventa
  // habilitado") -- por eso alcanza con `|| []`, sin try/catch.
  Promise.all([
    backend.listarDeModulo('ventas'),
    backend.listarDeModulo('postventa')
  ]).then(([ventas, postventa]) => {
    ventasCache = ventas || [];
    postventaCache = postventa || [];
    asegurarEventos();
    dibujar();
  });
}

function asegurarEventos() {
  if (eventosListos) return;
  eventosListos = true;

  document.querySelectorAll('#clientesPeriodoTabs .periodo-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#clientesPeriodoTabs .periodo-tab').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      periodoActual = btn.dataset.periodo;
      dibujar();
    });
  });

  document.getElementById('clientesSegmentos').addEventListener('click', (e) => {
    const chip = e.target.closest('.segmento-chip');
    if (!chip) return;
    const id = chip.dataset.segmento;
    segmentoFiltro = segmentoFiltro === id ? null : id;
    dibujar();
  });

  document.getElementById('clientesLista').addEventListener('click', (e) => {
    const fila = e.target.closest('.cliente-row');
    if (fila) abrirPerfilCliente(fila.dataset.id);
  });
}

function calcularSegmento(cliente, umbralVip) {
  const total = Number(cliente.compras_totales) || 0;
  if (total === 0 && cliente._compras === 0) return 'sin_actividad';
  const diasSinComprar = cliente._ultimaCompra ? Math.floor((Date.now() - new Date(cliente._ultimaCompra).getTime()) / 86400000) : Infinity;
  if (diasSinComprar > DIAS_RIESGO) return 'en_riesgo';
  if (umbralVip !== null && total >= umbralVip) return 'vip';
  if (cliente._compras >= 2) return 'recurrente';
  return 'activo';
}

function dibujar() {
  const { desde, hasta } = rangoDePeriodo(periodoActual);

  const enriquecidos = clientesCache.map(c => {
    const historial = ventasDeCliente(c.id, c.nombre);
    const ultima = historial.reduce((max, f) => (!max || f.fecha > max) ? f.fecha : max, null);
    return { ...c, _compras: historial.length, _ultimaCompra: ultima };
  });

  // Umbral VIP: top 20% por compras_totales entre los que compraron algo --
  // se recalcula del propio negocio, no un monto fijo inventado.
  const conCompras = enriquecidos.filter(c => Number(c.compras_totales) > 0).sort((a, b) => Number(b.compras_totales) - Number(a.compras_totales));
  const umbralVip = conCompras.length ? Number(conCompras[Math.max(0, Math.ceil(conCompras.length * 0.2) - 1)].compras_totales) : null;

  const segmentados = enriquecidos.map(c => ({ ...c, _segmento: calcularSegmento(c, umbralVip) }));

  dibujarKpis(desde, hasta, segmentados);
  dibujarSegmentos(segmentados);
  dibujarLista(segmentados);
  dibujarChartSegmento(segmentados);
  dibujarChartNuevosPorMes();
  dibujarChartValorPorSegmento(segmentados);
  dibujarChartFrecuencia(segmentados);
}

function dibujarKpis(desde, hasta, segmentados) {
  const { actual: ventasActual, anterior: ventasAnterior } = filtrarPeriodo(ventasCache, desde, hasta);
  const clave = f => f.cliente_id || f.cliente;
  const activosActual = new Set(ventasActual.map(clave).filter(Boolean));
  const activosAnterior = new Set(ventasAnterior.map(clave).filter(Boolean));

  const clientesConFecha = clientesCache.map(c => ({ ...c, _fecha: c.fecha_registro ? String(c.fecha_registro).slice(0, 10) : null }));
  const { actual: nuevosActual, anterior: nuevosAnterior } = filtrarPeriodo(clientesConFecha, desde, hasta);

  const retenidos = [...activosAnterior].filter(c => activosActual.has(c));
  const tasaRetencion = activosAnterior.size ? (retenidos.length / activosAnterior.size) * 100 : null;

  const conValor = clientesCache.filter(c => Number(c.compras_totales) > 0);
  const valorPromedio = conValor.length ? conValor.reduce((s, c) => s + Number(c.compras_totales), 0) / conValor.length : 0;

  document.getElementById('clientesKpis').innerHTML = [
    kpiCard({
      acento: 'teal', icono: '🟢', label: 'Clientes activos', value: fmtNum(activosActual.size),
      sub: `${clientesCache.length} en total`, delta: deltaPorcentaje(activosActual.size, activosAnterior.size)
    }),
    kpiCard({
      acento: 'blue', icono: '✨', label: 'Clientes nuevos', value: fmtNum(nuevosActual.length),
      sub: 'en el período', delta: deltaPorcentaje(nuevosActual.length, nuevosAnterior.length)
    }),
    kpiCard({
      acento: 'purple', icono: '💎', label: 'Valor promedio por cliente', value: fmtNum(valorPromedio),
      sub: `${conValor.length} con compras registradas`
    }),
    kpiCard({
      acento: 'orange', icono: '🔁', label: 'Retención', value: tasaRetencion === null ? '—' : `${tasaRetencion.toFixed(0)}%`,
      sub: tasaRetencion === null ? 'Sin datos del período anterior' : 'de los activos del período anterior'
    })
  ].join('');
}

function dibujarSegmentos(segmentados) {
  const conteos = Object.fromEntries(Object.keys(SEGMENTOS).map(id => [id, 0]));
  segmentados.forEach(c => { conteos[c._segmento]++; });

  // "seleccionado", no "activo": el segmento con id 'activo' (cliente que
  // compró pero no califica para VIP/recurrente/en_riesgo) chocaría con la
  // clase de "este chip es el filtro elegido" si usaran el mismo nombre.
  document.getElementById('clientesSegmentos').innerHTML = Object.entries(SEGMENTOS).map(([id, meta]) => `
    <button type="button" class="segmento-chip ${id} ${segmentoFiltro === id ? 'seleccionado' : ''}" data-segmento="${id}">
      <span>${meta.icono}</span> ${meta.label} <span class="segmento-chip-count">${conteos[id]}</span>
    </button>`).join('');
}

function dibujarLista(segmentados) {
  const filtrados = segmentoFiltro ? segmentados.filter(c => c._segmento === segmentoFiltro) : segmentados;
  const ordenados = [...filtrados].sort((a, b) => Number(b.compras_totales) - Number(a.compras_totales));

  document.getElementById('clientesLista').innerHTML = ordenados.length ? ordenados.map(c => {
    const meta = SEGMENTOS[c._segmento];
    return `<div class="cliente-row" data-id="${c.id}">
      <div class="cliente-row-info">
        <div class="cliente-row-nombre">${escapeHtml(c.nombre)}</div>
        <div class="cliente-row-contacto">${escapeHtml(c.email || c.telefono || 'Sin contacto')}</div>
      </div>
      <span class="segmento-badge ${c._segmento}">${meta.icono} ${meta.label}</span>
      <div class="cliente-row-valor">
        <div class="rank-val">${fmtNum(Number(c.compras_totales) || 0)}</div>
        <div class="cliente-row-sub">${c._compras} compra(s) · ${tiempoRelativo(c._ultimaCompra)}</div>
      </div>
    </div>`;
  }).join('') : '<div class="rank-row">No hay clientes en este segmento.</div>';
}

// Complementa los chips de segmento (que ya muestran el conteo como
// número) con la proporción visual -- útil quando hay varios segmentos con
// conteos parecidos y cuesta comparar solo con números.
function dibujarChartSegmento(segmentados) {
  const conteos = new Map();
  segmentados.forEach(c => { const meta = SEGMENTOS[c._segmento]; conteos.set(meta.label, (conteos.get(meta.label) || 0) + 1); });
  const entradas = [...conteos.entries()].filter(([, n]) => n > 0);

  const wrap = document.getElementById('clientesChartSegmentoWrap');
  wrap.innerHTML = '<canvas id="clientesChartSegmento"></canvas>';
  if (chartSegmento) { chartSegmento.destroy(); chartSegmento = null; }
  if (!entradas.length) { wrap.innerHTML = '<div class="chart-empty">Sin clientes registrados.</div>'; return; }
  const ctx = document.getElementById('clientesChartSegmento').getContext('2d');
  chartSegmento = crearGraficoDona(ctx, { etiquetas: entradas.map(e => e[0]), valores: entradas.map(e => e[1]) });
}

// Independiente de los tabs de período de arriba (esos solo afectan los
// KPIs) -- acá siempre se muestra una ventana fija de 12 meses porque es un
// gráfico de tendencia de adquisición, no un corte puntual.
function dibujarChartNuevosPorMes() {
  const hoy = new Date();
  const meses = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const conteoPorMes = new Map(meses.map(m => [m, 0]));
  clientesCache.forEach(c => {
    if (!c.fecha_registro) return;
    const mes = String(c.fecha_registro).slice(0, 7);
    if (conteoPorMes.has(mes)) conteoPorMes.set(mes, conteoPorMes.get(mes) + 1);
  });

  const wrap = document.getElementById('clientesChartNuevosWrap');
  wrap.innerHTML = '<canvas id="clientesChartNuevos"></canvas>';
  if (chartNuevos) { chartNuevos.destroy(); chartNuevos = null; }
  const etiquetas = meses.map(m => { const [y, mm] = m.split('-'); return new Date(Number(y), Number(mm) - 1, 1).toLocaleDateString('es-PE', { month: 'short', year: '2-digit' }); });
  const color = getComputedStyle(document.documentElement).getPropertyValue('--teal').trim();
  const ctx = document.getElementById('clientesChartNuevos').getContext('2d');
  chartNuevos = crearGraficoBarras(ctx, { etiquetas, valores: meses.map(m => conteoPorMes.get(m)), label: 'Clientes nuevos', color });
}

// Distinto de la dona de segmentos (que cuenta clientes): acá se compara
// cuánto vale en promedio un cliente de cada segmento -- confirma (o no) que
// los VIP realmente valen más, en vez de asumirlo por el nombre del segmento.
function dibujarChartValorPorSegmento(segmentados) {
  const porSegmento = new Map();
  segmentados.forEach(c => {
    const acc = porSegmento.get(c._segmento) || { total: 0, cantidad: 0 };
    acc.total += Number(c.compras_totales) || 0;
    acc.cantidad += 1;
    porSegmento.set(c._segmento, acc);
  });
  const entradas = Object.keys(SEGMENTOS)
    .map(id => ({ id, label: SEGMENTOS[id].label, datos: porSegmento.get(id) }))
    .filter(e => e.datos && e.datos.cantidad > 0);

  const wrap = document.getElementById('clientesChartValorWrap');
  wrap.innerHTML = '<canvas id="clientesChartValor"></canvas>';
  if (chartValor) { chartValor.destroy(); chartValor = null; }
  if (!entradas.length) { wrap.innerHTML = '<div class="chart-empty">Sin clientes registrados.</div>'; return; }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--purple').trim();
  const ctx = document.getElementById('clientesChartValor').getContext('2d');
  chartValor = crearGraficoBarras(ctx, {
    etiquetas: entradas.map(e => e.label), valores: entradas.map(e => e.datos.total / e.datos.cantidad),
    label: 'Valor promedio', color
  });
}

// Retención en otra forma: no "cuánto vale" (eso es el chart anterior) sino
// "cuántas veces vuelve" -- cuántos clientes están en cada franja de
// cantidad de compras. Ayuda a ver si el negocio depende de compradores
// únicos o de clientes que repiten.
function dibujarChartFrecuencia(segmentados) {
  const franjas = [
    { label: '0 compras', test: n => n === 0 },
    { label: '1 compra', test: n => n === 1 },
    { label: '2-3 compras', test: n => n >= 2 && n <= 3 },
    { label: '4-6 compras', test: n => n >= 4 && n <= 6 },
    { label: '7+ compras', test: n => n >= 7 }
  ];
  const conteos = franjas.map(f => segmentados.filter(c => f.test(c._compras)).length);

  const wrap = document.getElementById('clientesChartFrecuenciaWrap');
  wrap.innerHTML = '<canvas id="clientesChartFrecuencia"></canvas>';
  if (chartFrecuencia) { chartFrecuencia.destroy(); chartFrecuencia = null; }
  if (!segmentados.length) { wrap.innerHTML = '<div class="chart-empty">Sin clientes registrados.</div>'; return; }
  const color = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim();
  const ctx = document.getElementById('clientesChartFrecuencia').getContext('2d');
  chartFrecuencia = crearGraficoBarras(ctx, { etiquetas: franjas.map(f => f.label), valores: conteos, label: 'Clientes', color });
}

function abrirPerfilCliente(id) {
  const cliente = clientesCache.find(c => String(c.id) === String(id));
  if (!cliente) return;

  const historialVentas = ventasDeCliente(cliente.id, cliente.nombre);
  const historialPostventa = postventaCache.filter(f => f.cliente_id === cliente.id);
  const totalCompras = historialVentas.reduce((s, f) => s + (Number(f.monto) || 0), 0);

  const eventos = [
    ...historialVentas.map(f => ({ fecha: f.fecha, icono: '💰', texto: `Compró ${f.producto}`, monto: f.monto })),
    ...historialPostventa.map(f => ({ fecha: f.fecha, icono: '🛠️', texto: `${ETIQUETA_POSTVENTA[f.tipo] || 'Servicio'}: ${f.descripcion || ''}`, monto: f.total }))
  ].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

  abrirPanelLateral({
    titulo: cliente.nombre,
    icono: '👤',
    montar: (body) => {
      body.innerHTML = `
        <div class="perfil-cliente-contacto">
          ${cliente.email ? `<div>✉️ ${escapeHtml(cliente.email)}</div>` : ''}
          ${cliente.telefono ? `<div>📞 ${escapeHtml(cliente.telefono)}</div>` : ''}
          ${cliente.direccion ? `<div>📍 ${escapeHtml(cliente.direccion)}</div>` : ''}
          ${cliente.notas ? `<div class="perfil-cliente-notas">${escapeHtml(cliente.notas)}</div>` : ''}
        </div>
        <div class="perfil-cliente-kpis">
          <div><div class="label">Total comprado</div><div class="value num">${fmtNum(totalCompras)}</div></div>
          <div><div class="label">Compras</div><div class="value num">${historialVentas.length}</div></div>
          <div><div class="label">Cliente desde</div><div class="value" style="font-size:14px;">${escapeHtml(String(cliente.fecha_registro || '').slice(0, 10))}</div></div>
        </div>
        <h4 class="perfil-cliente-subtitulo">Historial</h4>
        <div class="perfil-cliente-timeline">
          ${eventos.length ? eventos.map(ev => `
            <div class="timeline-item">
              <span class="timeline-icono">${ev.icono}</span>
              <div class="timeline-info">
                <div class="timeline-texto">${escapeHtml(ev.texto)}</div>
                <div class="timeline-fecha">${escapeHtml(String(ev.fecha || '').slice(0, 10))}${ev.monto ? ' · ' + fmtNum(Number(ev.monto)) : ''}</div>
              </div>
            </div>`).join('') : '<div class="rank-row">Todavía no hay actividad registrada.</div>'}
        </div>
      `;
    }
  });
}
