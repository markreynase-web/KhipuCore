// components/panelLateral.js
// Panel lateral (drawer) reutilizable para no tener el formulario de "Nuevo
// registro" ocupando espacio permanente junto a la tabla (Fase de rediseño
// UX/UI, punto 1: "Panel lateral/modal para formularios").
//
// Uso:
//   import { abrirPanelLateral, cerrarPanelLateral } from './panelLateral.js';
//
//   abrirPanelLateral({
//     titulo: 'Nueva venta',
//     montar: (body) => {
//       body.innerHTML = '<div id="formularioCaptura"></div>';
//       renderFormulario('formularioCaptura', esquema, onGuardar, { puedeCrear });
//     }
//   });
//
// `montar(body)` recibe el contenedor vacío del panel: ahí se decide qué
// se dibuja adentro (hoy, el formulario genérico; el mismo panel sirve a
// futuro para edición, historial, etc. sin duplicar el shell).

let elPanel = null;
let elOverlay = null;
let alCerrar = null;

function asegurarDom() {
  if (elPanel) return;

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="panel-lateral-overlay" id="panelLateralOverlay"></div>
    <aside class="panel-lateral" id="panelLateral" role="dialog" aria-modal="true">
      <div class="panel-lateral-header">
        <div class="panel-lateral-titulo-wrap">
          <span class="panel-lateral-icono" id="panelLateralIcono"></span>
          <h3 id="panelLateralTitulo"></h3>
        </div>
        <button type="button" class="panel-lateral-cerrar" id="panelLateralCerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="panel-lateral-body" id="panelLateralBody"></div>
    </aside>
  `;
  document.body.appendChild(wrap);

  elOverlay = document.getElementById('panelLateralOverlay');
  elPanel = document.getElementById('panelLateral');

  elOverlay.addEventListener('click', cerrarPanelLateral);
  document.getElementById('panelLateralCerrar').addEventListener('click', cerrarPanelLateral);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && elPanel.classList.contains('activo')) cerrarPanelLateral();
  });
}

export function abrirPanelLateral({ titulo = '', icono = '📝', montar, onCerrar } = {}) {
  asegurarDom();
  document.getElementById('panelLateralTitulo').textContent = titulo;
  document.getElementById('panelLateralIcono').textContent = icono;

  const body = document.getElementById('panelLateralBody');
  body.innerHTML = '';
  alCerrar = onCerrar || null;

  if (typeof montar === 'function') montar(body);

  // requestAnimationFrame para que la transición CSS anime la entrada
  // (si agregamos .activo en el mismo tick que insertamos el DOM, el
  // navegador no siempre alcanza a animar el paso de "cerrado" a "abierto").
  requestAnimationFrame(() => {
    elOverlay.classList.add('activo');
    elPanel.classList.add('activo');
  });
  document.body.classList.add('panel-lateral-abierto');
}

export function cerrarPanelLateral() {
  if (!elPanel) return;
  elOverlay.classList.remove('activo');
  elPanel.classList.remove('activo');
  document.body.classList.remove('panel-lateral-abierto');
  if (alCerrar) { alCerrar(); alCerrar = null; }
}

export function panelLateralEstaAbierto() {
  return !!(elPanel && elPanel.classList.contains('activo'));
}
