// components/tablaRegistros.js
// Tabla genérica con buscador, paginación y acciones por fila (ver/editar/
// borrar). La edición sigue siendo inline (los <td> se convierten en inputs);
// "ver" expande una fila de detalle debajo, sin necesitar un modal aparte.
// Reutilizable por cualquier módulo que tenga columnasTabla en su esquema
// (ver js/esquemas.js).
//
// Todo lo que venga de una fila (nombre de producto, cliente, notas...) pasa
// por escapeHtml() antes de insertarse con innerHTML -- son texto libre que
// cualquier usuario con permiso de crear pudo escribir, incluido HTML/JS.

import { escapeHtml } from '../js/utils.js';

const FILAS_POR_PAGINA = 10;

function formatoCelda(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor)) return escapeHtml(valor.slice(0, 10));
  return escapeHtml(valor);
}

export function renderTabla(contenedorId, filasOriginales, esquema, { onGuardarEdicion, onBorrar, puedeEditar = true, puedeBorrar = true, terminoInicial = '' }) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;

  if (!filasOriginales.length) {
    cont.innerHTML = '<p class="tabla-vacia">Todavía no hay registros. Usa "+ Nuevo" para agregar el primero.</p>';
    return;
  }

  const cols = esquema.columnasTabla;
  const sinAcciones = !puedeEditar && !puedeBorrar;

  // Estado local de la tabla (búsqueda/página). Vive solo mientras esta
  // instancia de renderTabla esté montada -- si app.js vuelve a llamar
  // renderTabla (ej. tras guardar un registro) arranca de nuevo en la
  // página 1, salvo terminoInicial (llegada desde la búsqueda global del
  // topbar, ver components/topbar.js + js/app.js). Es una limitación
  // aceptada a cambio de no tener que sincronizar estado con el padre.
  let termino = terminoInicial;
  let pagina = 1;

  function filasFiltradas() {
    if (!termino.trim()) return filasOriginales;
    const t = termino.trim().toLowerCase();
    return filasOriginales.filter(f => cols.some(c => String(f[c.key] ?? '').toLowerCase().includes(t)));
  }

  function dibujar() {
    const filas = filasFiltradas();
    const totalPaginas = Math.max(1, Math.ceil(filas.length / FILAS_POR_PAGINA));
    pagina = Math.min(pagina, totalPaginas);
    const inicio = (pagina - 1) * FILAS_POR_PAGINA;
    const filasPagina = filas.slice(inicio, inicio + FILAS_POR_PAGINA);

    cont.innerHTML = `
      <div class="tabla-toolbar">
        <div class="tabla-buscador">
          <span class="ico">🔍</span>
          <input type="search" id="tablaBuscador" placeholder="Buscar registros…" value="${escapeHtml(termino)}">
        </div>
        <button type="button" class="btn btn-ghost" id="tablaFiltrosBtn" title="Próximamente">▤ Filtros</button>
        <span class="tabla-contador">${filas.length} registro${filas.length === 1 ? '' : 's'}</span>
      </div>

      <div class="tabla-registros-wrap">
        <table class="tabla-registros">
          <thead>
            <tr>
              ${cols.map(c => `<th>${c.label}</th>`).join('')}
              ${sinAcciones ? '' : '<th class="col-acciones"></th>'}
            </tr>
          </thead>
          <tbody>
            ${filasPagina.length ? filasPagina.map(f => {
              const alerta = esquema.alertaStock &&
                Number(f[esquema.alertaStock.campo]) <= Number(f[esquema.alertaStock.minimo]);
              return `
              <tr data-id="${f.id}"${alerta ? ' class="fila-alerta-stock"' : ''}>
                ${cols.map(c => `<td data-key="${c.key}"><span class="valor">${formatoCelda(f[c.key])}</span>${alerta && c.key === esquema.alertaStock.campo ? ' <span class="badge-alerta" title="Stock en el mínimo o por debajo">⚠ bajo</span>' : ''}</td>`).join('')}
                ${sinAcciones ? '' : `
                <td class="col-acciones">
                  <button type="button" class="btn-guardar-fila" data-accion="guardar" style="display:none;">💾 Guardar</button>
                  <div class="acciones-icono">
                    <button type="button" class="icon-btn" data-accion="ver" title="Ver detalle">👁️</button>
                    ${puedeEditar ? '<button type="button" class="icon-btn" data-accion="editar" title="Editar">✏️</button>' : ''}
                    ${puedeBorrar ? '<button type="button" class="icon-btn peligro" data-accion="borrar" title="Borrar">🗑️</button>' : ''}
                  </div>
                </td>`}
              </tr>
              <tr class="fila-detalle" data-detalle-de="${f.id}" hidden>
                <td colspan="${cols.length + (sinAcciones ? 0 : 1)}">
                  <div class="fila-detalle-grid">
                    ${cols.map(c => `<div><span class="fila-detalle-label">${c.label}</span><span class="fila-detalle-valor">${formatoCelda(f[c.key]) || '—'}</span></div>`).join('')}
                  </div>
                </td>
              </tr>
            `; }).join('') : `<tr><td colspan="${cols.length + (sinAcciones ? 0 : 1)}" class="tabla-sin-resultados">Ningún registro coincide con "${escapeHtml(termino)}".</td></tr>`}
          </tbody>
        </table>
      </div>

      ${filas.length ? `
      <div class="tabla-paginacion">
        <span>Mostrando ${filas.length ? inicio + 1 : 0} a ${Math.min(inicio + FILAS_POR_PAGINA, filas.length)} de ${filas.length} registro${filas.length === 1 ? '' : 's'}</span>
        <div class="tabla-paginacion-botones">
          <button type="button" class="pag-btn" id="pagAnterior" ${pagina <= 1 ? 'disabled' : ''}>‹</button>
          <span class="pag-actual">${pagina}</span>
          <button type="button" class="pag-btn" id="pagSiguiente" ${pagina >= totalPaginas ? 'disabled' : ''}>›</button>
        </div>
      </div>` : ''}
    `;

    wireDom(filas, filasPagina);
  }

  function wireDom(filasVisiblesTotal, filasPagina) {
    const buscador = document.getElementById('tablaBuscador');
    buscador.addEventListener('input', () => { termino = buscador.value; pagina = 1; dibujar(); buscador.focus(); buscador.setSelectionRange(termino.length, termino.length); });

    // "Filtros" queda decorativo por ahora -- no hay criterios de filtro
    // definidos todavía (por fecha/categoría/etc.), solo el buscador de texto.
    document.getElementById('tablaFiltrosBtn').addEventListener('click', () => {
      alert('Los filtros avanzados todavía no están disponibles. Por ahora puedes usar el buscador.');
    });

    const totalPaginas = Math.max(1, Math.ceil(filasVisiblesTotal.length / FILAS_POR_PAGINA));
    document.getElementById('pagAnterior')?.addEventListener('click', () => { if (pagina > 1) { pagina--; dibujar(); } });
    document.getElementById('pagSiguiente')?.addEventListener('click', () => { if (pagina < totalPaginas) { pagina++; dibujar(); } });

    if (sinAcciones) return;

    cont.querySelectorAll('tr[data-id]').forEach(tr => {
      const id = tr.dataset.id;
      const fila = filasPagina.find(f => String(f.id) === id);
      const filaDetalle = cont.querySelector(`tr[data-detalle-de="${id}"]`);
      const btnVer = tr.querySelector('[data-accion="ver"]');
      const btnEditar = tr.querySelector('[data-accion="editar"]');
      const btnBorrar = tr.querySelector('[data-accion="borrar"]');
      const btnGuardar = tr.querySelector('[data-accion="guardar"]');

      btnVer?.addEventListener('click', () => {
        const abierto = !filaDetalle.hidden;
        cont.querySelectorAll('.fila-detalle').forEach(fd => fd.hidden = true);
        filaDetalle.hidden = abierto;
      });

      btnBorrar?.addEventListener('click', async () => {
        if (!confirm('¿Borrar este registro? No se puede deshacer.')) return;
        btnBorrar.disabled = true;
        const ok = await onBorrar(id);
        if (ok) { tr.remove(); filaDetalle.remove(); }
        else { btnBorrar.disabled = false; alert('No se pudo borrar. Revisa la conexión con el backend.'); }
      });

      if (!btnEditar) return;

      function entrarEnEdicion() {
        cols.forEach(c => {
          const td = tr.querySelector(`td[data-key="${c.key}"]`);
          const valorActual = fila[c.key] !== null && fila[c.key] !== undefined ? formatoCelda(fila[c.key]) : '';
          // Columnas que son la foto de una relación (cliente/producto en
          // Ventas) no se editan aquí -- cambiar el texto no movería la
          // relación real en el backend -- se muestran fijas.
          if (c.soloLectura) return;
          const campo = esquema.campos.find(cm => cm.id === c.key);
          const tipo = campo ? campo.type : 'text';
          td.innerHTML = `<input type="${tipo}" value="${valorActual}" data-key="${c.key}">`;
        });
        tr.classList.add('editando');
        filaDetalle.hidden = true;
        btnGuardar.style.display = 'inline-flex';
        tr.querySelector('.acciones-icono').style.display = 'none';
      }

      function salirDeEdicion() {
        tr.classList.remove('editando');
        btnGuardar.style.display = 'none';
        tr.querySelector('.acciones-icono').style.display = '';
      }

      btnEditar.addEventListener('click', entrarEnEdicion);
      btnGuardar.addEventListener('click', () => {
        guardarFila(tr, fila, esquema, onGuardarEdicion).then(salirDeEdicion);
      });
    });
  }

  async function guardarFila(tr, filaOriginal, esquema, onGuardarEdicion) {
    const cambios = {};
    tr.querySelectorAll('input[data-key]').forEach(input => {
      const campo = esquema.campos.find(c => c.id === input.dataset.key);
      cambios[input.dataset.key] = campo && campo.type === 'number' ? parseFloat(input.value) || 0 : input.value.trim();
    });
    const actualizado = await onGuardarEdicion(filaOriginal.id, cambios);
    if (!actualizado) { alert('No se pudo guardar el cambio.'); return; }
    Object.assign(filaOriginal, actualizado);
    esquema.columnasTabla.forEach(c => {
      const td = tr.querySelector(`td[data-key="${c.key}"]`);
      td.innerHTML = `<span class="valor">${formatoCelda(filaOriginal[c.key])}</span>`;
    });
  }

  dibujar();
}
