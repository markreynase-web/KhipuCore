// js/rrhhDashboard.js
// Dashboard bespoke de RRHH: reemplaza la vista previa con datos de
// ejemplo que tenía esta página antes -- todo acá sale de empleados reales
// (backend/src/routes/rrhh.js). Sin asistencia, cumpleaños ni evaluaciones
// de desempeño -- no existe ninguna de esas tablas todavía, no se inventan.

import { fmtNum, escapeHtml } from './utils.js';
import { kpiCard } from './kpiCard.js';

const ETIQUETA_ESTADO = {
  activo: { texto: 'Activo', color: 'teal' },
  inactivo: { texto: 'Inactivo', color: 'danger' },
  vacaciones: { texto: 'Vacaciones', color: 'blue' },
  licencia: { texto: 'Licencia', color: 'purple' }
};

let empleadosCache = [];

export function renderRrhhDashboard(filasCrudas) {
  empleadosCache = filasCrudas || [];
  dibujar();
}

function esteMes(fechaStr) {
  if (!fechaStr) return false;
  const hoy = new Date();
  const f = new Date(fechaStr);
  return f.getFullYear() === hoy.getFullYear() && f.getMonth() === hoy.getMonth();
}

function dibujar() {
  dibujarKpis();
  dibujarLista();
  dibujarPorDepartamento();
}

function dibujarKpis() {
  const activos = empleadosCache.filter(e => e.estado === 'activo');
  const nominaMensual = activos.reduce((s, e) => s + (Number(e.salario) || 0), 0);
  const ausentes = empleadosCache.filter(e => ['vacaciones', 'licencia'].includes(e.estado)).length;
  const contratadosMes = empleadosCache.filter(e => esteMes(e.fecha_contratacion)).length;

  document.getElementById('rrhhKpis').innerHTML = [
    kpiCard({ acento: 'blue', icono: '👥', label: 'Empleados activos', value: fmtNum(activos.length), sub: `${empleadosCache.length} en total` }),
    kpiCard({ acento: 'purple', icono: '💰', label: 'Nómina mensual estimada', value: fmtNum(nominaMensual), sub: 'suma de salarios activos' }),
    kpiCard({ acento: ausentes ? 'orange' : 'teal', icono: '🏖️', label: 'Vacaciones / licencia', value: fmtNum(ausentes), sub: 'ausentes ahora' }),
    kpiCard({ acento: 'teal', icono: '✨', label: 'Contratados este mes', value: fmtNum(contratadosMes), sub: 'nuevos ingresos' })
  ].join('');
}

function dibujarLista() {
  const ordenados = [...empleadosCache].sort((a, b) => a.nombre.localeCompare(b.nombre));
  document.getElementById('rrhhCount').textContent = `${ordenados.length} empleado(s)`;

  document.getElementById('rrhhLista').innerHTML = ordenados.length ? ordenados.map(e => {
    const est = ETIQUETA_ESTADO[e.estado] || { texto: e.estado, color: 'muted' };
    const sub = [e.puesto, e.departamento].filter(Boolean).join(' · ') || 'Sin puesto asignado';
    return `<div class="cliente-row">
      <div class="cliente-row-info">
        <div class="cliente-row-nombre">${escapeHtml(e.nombre)}</div>
        <div class="cliente-row-contacto">${escapeHtml(sub)}</div>
      </div>
      <span class="evento-badge evento-badge-${est.color}">${escapeHtml(est.texto)}</span>
      <div class="cliente-row-valor">
        <div class="rank-val">${fmtNum(Number(e.salario) || 0)}</div>
        <div class="cliente-row-sub">desde ${escapeHtml(String(e.fecha_contratacion || '').slice(0, 10))}</div>
      </div>
    </div>`;
  }).join('') : '<div class="rank-row">Todavía no hay empleados registrados.</div>';
}

function dibujarPorDepartamento() {
  const porDepto = new Map();
  empleadosCache.forEach(e => {
    const depto = e.departamento || 'Sin departamento';
    porDepto.set(depto, (porDepto.get(depto) || 0) + 1);
  });
  const top = [...porDepto.entries()].sort((a, b) => b[1] - a[1]);
  document.getElementById('rrhhPorDepartamento').innerHTML = top.length
    ? top.map((r, i) => `<div class="rank-row"><span class="rank-num">${i + 1}</span><span class="rank-name">${escapeHtml(r[0])}</span><span class="rank-val">${fmtNum(r[1])}</span></div>`).join('')
    : '<div class="rank-row">Todavía no hay empleados registrados.</div>';
}
