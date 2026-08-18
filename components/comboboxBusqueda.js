// components/comboboxBusqueda.js
// Searchable combobox genérico: campo de texto que busca mientras el
// usuario escribe (debounce), muestra resultados en un panel flotante y
// deja seleccionar con mouse o teclado (↑/↓/Enter/Esc). No sabe nada de
// productos/ventas -- recibe funciones de búsqueda y de render por fuera,
// así cualquier campo con muchas opciones (no solo Producto en Ventas)
// puede reusarlo más adelante sin tocar este archivo.
//
// Reemplaza un <select> nativo cuando la fuente tiene demasiadas filas para
// cargarlas todas de una vez (ver crudFactory.js ?buscar=). El valor
// elegido vive en un <input type="hidden"> con el mismo id que tendría el
// <select> que reemplaza -- por eso el resto de formularioRegistro.js
// (lectura de valores al enviar, validación de "required") no necesita
// saber que este campo es distinto por dentro.

import { escapeHtml } from '../js/utils.js';

const DEBOUNCE_MS = 250;

/**
 * @param {string} contenedorId - id del elemento donde montar el combobox
 * @param {object} opciones
 * @param {string} opciones.idHidden - id del <input type="hidden"> con el value elegido (lo que lee el resto del formulario)
 * @param {string} [opciones.placeholder] - placeholder del campo de búsqueda
 * @param {boolean} [opciones.required]
 * @param {(termino:string) => Promise<any[]|null>} opciones.buscar - trae resultados crudos desde el backend
 * @param {(item:any) => string} opciones.renderResultado - HTML de una fila de resultado (ya debe traer su propio escapeHtml)
 * @param {(item:any) => string} opciones.etiquetaSeleccionado - texto a mostrar en el campo una vez elegido
 * @param {(item:any) => string|number} opciones.valorSeleccionado - qué guardar en el input hidden (normalmente item.id)
 * @param {(item:any) => void} [opciones.onSeleccionar] - side-effects al elegir (ej. autocompletar precio sugerido)
 * @param {() => void} [opciones.onLimpiar] - side-effects al borrar la selección
 */
export function renderComboboxBusqueda(contenedorId, opciones) {
  const {
    idHidden, placeholder = 'Buscar…', required = false,
    buscar, renderResultado, etiquetaSeleccionado, valorSeleccionado,
    onSeleccionar, onLimpiar
  } = opciones;

  const cont = document.getElementById(contenedorId);
  if (!cont) return;

  const idTexto = `${idHidden}_texto`;
  cont.innerHTML = `
    <div class="combobox-busqueda">
      <input type="hidden" id="${idHidden}" value="" ${required ? 'data-required="true"' : ''}>
      <input type="text" id="${idTexto}" class="combobox-input" placeholder="${escapeHtml(placeholder)}" autocomplete="off">
      <div class="combobox-resultados" id="${idTexto}_resultados" hidden></div>
    </div>
  `;

  const inputTexto = document.getElementById(idTexto);
  const inputHidden = document.getElementById(idHidden);
  const panel = document.getElementById(`${idTexto}_resultados`);

  let items = [];
  let indiceActivo = -1;
  let debounceRef = null;
  let ultimaConsulta = 0;

  function cerrarPanel() {
    panel.hidden = true;
    panel.innerHTML = '';
    items = [];
    indiceActivo = -1;
  }

  function marcarActivo() {
    panel.querySelectorAll('.combobox-resultado').forEach((el, i) => {
      el.classList.toggle('activo', i === indiceActivo);
    });
    const activo = panel.querySelector('.combobox-resultado.activo');
    if (activo) activo.scrollIntoView({ block: 'nearest' });
  }

  function abrirPanelConResultados(lista) {
    items = lista;
    indiceActivo = lista.length ? 0 : -1;
    if (!lista.length) {
      panel.innerHTML = '<div class="combobox-sin-resultados">Sin resultados.</div>';
      panel.hidden = false;
      return;
    }
    panel.innerHTML = lista.map((item, i) => `
      <button type="button" class="combobox-resultado" data-idx="${i}">${renderResultado(item)}</button>
    `).join('');
    panel.hidden = false;
    marcarActivo();
    panel.querySelectorAll('.combobox-resultado').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        // mousedown (no click): dispara antes que el blur del input, así
        // seleccionar con el mouse no se pisa con el cierre-al-perder-foco.
        e.preventDefault();
        elegir(items[Number(btn.dataset.idx)]);
      });
    });
  }

  function elegir(item) {
    inputHidden.value = valorSeleccionado(item);
    inputTexto.value = etiquetaSeleccionado(item);
    cerrarPanel();
    if (onSeleccionar) onSeleccionar(item);
  }

  function limpiarSeleccion() {
    if (inputHidden.value === '') return;
    inputHidden.value = '';
    if (onLimpiar) onLimpiar();
  }

  async function ejecutarBusqueda(termino) {
    const consultaId = ++ultimaConsulta;
    const resultados = await buscar(termino);
    if (consultaId !== ultimaConsulta) return; // el usuario ya escribió otra cosa: se descarta esta respuesta tardía
    abrirPanelConResultados(resultados || []);
  }

  inputTexto.addEventListener('input', () => {
    limpiarSeleccion();
    const termino = inputTexto.value.trim();
    if (debounceRef) clearTimeout(debounceRef);
    if (!termino) { cerrarPanel(); return; }
    debounceRef = setTimeout(() => ejecutarBusqueda(termino), DEBOUNCE_MS);
  });

  inputTexto.addEventListener('keydown', (e) => {
    if (panel.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      indiceActivo = Math.min(indiceActivo + 1, items.length - 1);
      marcarActivo();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      indiceActivo = Math.max(indiceActivo - 1, 0);
      marcarActivo();
    } else if (e.key === 'Enter') {
      if (indiceActivo >= 0) { e.preventDefault(); elegir(items[indiceActivo]); }
    } else if (e.key === 'Escape') {
      cerrarPanel();
    }
  });

  inputTexto.addEventListener('blur', () => {
    // Pequeño delay: si el blur vino de hacer click en un resultado, el
    // mousedown de arriba ya alcanzó a correr antes de que esto cierre el panel.
    setTimeout(cerrarPanel, 120);
  });

  return {
    limpiar() {
      inputTexto.value = '';
      inputHidden.value = '';
      cerrarPanel();
    }
  };
}
