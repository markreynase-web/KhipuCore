// components/formularioRegistro.js
// Formulario genérico de "Nuevo registro": recibe un esquema (ver js/esquemas.js)
// y arma el HTML + la validación mínima, en vez de que cada módulo tenga su
// propio formulario escrito a mano (así era Ventas antes de este refactor).
//
// onGuardar(valores) debe devolver el registro guardado (o null si falló);
// este componente solo se encarga de la UI y de leer/limpiar los inputs.
//
// Fase 5 (Ventas <-> Inventario <-> Clientes): agrega soporte a campos
// type:'select'. Las opciones pueden venir ya resueltas en el esquema
// (c.opciones, estático) o resueltas por quien llama antes de renderizar
// (c.opcionesResueltas -- ver poblarSelectsVentas() en app.js, que las llena
// pidiendo /inventario y /clientes frescos al backend cada vez que se abre
// el formulario). Un campo con ayudaStock:true además muestra "Disponible: N"
// y limita la cantidad máxima que se puede escribir, para que la alerta de
// stock aparezca ANTES de enviar, no solo cuando el backend la rechace.

// componentes/formularioRegistro.js
// Fase 5: los <option> de cliente/producto traen o.label armado con nombres
// que el usuario escribió libremente en Clientes/Inventario (ver
// poblarSelectsVentas() en app.js) -- pasan por escapeHtml() antes de
// insertarse con innerHTML, igual que el resto de datos "de usuario" en la app.

import { escapeHtml } from '../js/utils.js';

function valorInicial(campo) {
  return campo.defecto !== undefined ? campo.defecto : '';
}

function renderCampoInput(c, idInput) {
  return `<input
    id="${idInput}"
    type="${c.type}"
    ${c.required ? 'required' : ''}
    ${c.min !== undefined ? `min="${c.min}"` : ''}
    ${c.step ? `step="${c.step}"` : ''}
    value="${valorInicial(c)}"
    placeholder="${c.placeholder || ''}"
  >`;
}

function renderCampoSelect(c, idInput) {
  const opciones = c.opcionesResueltas || c.opciones || [];
  const optionsHtml = opciones.map(o =>
    `<option value="${escapeHtml(o.value)}" ${o.extra ? `data-extra='${escapeHtml(JSON.stringify(o.extra))}'` : ''}>${escapeHtml(o.label)}</option>`
  ).join('');
  return `<select id="${idInput}" ${c.required ? 'required' : ''}>
    <option value="">${escapeHtml(c.vacio || 'Selecciona…')}</option>
    ${optionsHtml}
  </select>`;
}

export function renderFormulario(contenedorId, esquema, onGuardar, { puedeCrear = true, onAccionExtra, obtenerUltimoError } = {}) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return null;

  if (!puedeCrear) {
    cont.innerHTML = '<p class="tabla-vacia">Tu rol no tiene permiso para agregar registros aquí. Puedes verlos, pero no crearlos.</p>';
    return null;
  }

  const idInput = (campo) => `campo_${campo.id}`;

  cont.innerHTML = `
    <form class="form-registro">
      ${esquema.campos.map(c => `
        <div class="campo${c.ancho ? ` campo-ancho-${c.ancho}` : ''}">
          <label for="${idInput(c)}">
            ${c.label}
            ${c.accionExtra ? `<button type="button" class="campo-accion-extra" data-evento="${c.accionExtra.evento}">${c.accionExtra.texto}</button>` : ''}
          </label>
          ${c.type === 'select' ? renderCampoSelect(c, idInput(c)) : renderCampoInput(c, idInput(c))}
          ${c.ayudaStock ? `<span class="campo-ayuda" data-rol="ayuda-${c.id}"></span>` : ''}
        </div>
      `).join('')}
      <div class="campo campo-accion">
        <button type="submit" class="btn btn-ochre">💾 Guardar ${esquema.etiqueta}</button>
        <span class="form-status" data-rol="status"></span>
      </div>
    </form>
  `;

  const form = cont.querySelector('form');
  const statusEl = cont.querySelector('[data-rol="status"]');
  const btn = form.querySelector('button[type="submit"]');

  // Botones "+ Nuevo cliente" y similares: el formulario no sabe abrir otro
  // panel por su cuenta, solo avisa hacia afuera (onAccionExtra) para que
  // app.js decida qué hacer (ej. abrir el panel lateral de Clientes encima).
  cont.querySelectorAll('.campo-accion-extra').forEach(boton => {
    boton.addEventListener('click', () => {
      if (onAccionExtra) onAccionExtra(boton.dataset.evento);
    });
  });

  // Campo con ayudaStock:true (hoy, el producto en Ventas): al elegir un
  // producto, muestra cuánto stock queda y limita el máximo del campo
  // 'cantidad' para que el usuario vea la alerta antes de intentar guardar.
  esquema.campos.forEach(c => {
    if (!c.ayudaStock || c.type !== 'select') return;
    const select = document.getElementById(idInput(c));
    const ayudaEl = cont.querySelector(`[data-rol="ayuda-${c.id}"]`);
    const campoCantidad = esquema.campos.find(cm => cm.id === 'cantidad');
    const inputCantidad = campoCantidad ? document.getElementById(idInput(campoCantidad)) : null;

    select.addEventListener('change', () => {
      const opcion = select.selectedOptions[0];
      const extra = opcion && opcion.dataset.extra ? JSON.parse(opcion.dataset.extra) : null;
      if (!extra) { ayudaEl.textContent = ''; return; }
      ayudaEl.textContent = `Disponible: ${extra.stock} unidad(es)`;
      ayudaEl.style.color = extra.stock > 0 ? 'var(--muted)' : 'var(--coral)';
      if (inputCantidad) inputCantidad.max = extra.stock;

      (c.sugiere || []).forEach(idCampoSugerido => {
        const campoSugerido = esquema.campos.find(cm => cm.id === idCampoSugerido);
        if (!campoSugerido) return;
        const inputSugerido = document.getElementById(idInput(campoSugerido));
        if (!inputSugerido) return;
        if (idCampoSugerido === 'categoria' && extra.categoria) inputSugerido.value = extra.categoria;
        if (idCampoSugerido === 'precio_unitario' && extra.precioSugerido) inputSugerido.value = extra.precioSugerido;
      });
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const valores = {};
    let faltaAlgo = false;
    let errorStock = null;

    esquema.campos.forEach(c => {
      const input = document.getElementById(idInput(c));
      let v = input.value;
      if (c.type === 'number') v = v === '' ? '' : parseFloat(v);
      if (c.required && (v === '' || v === null || (c.type === 'number' && (Number.isNaN(v) || v <= 0)))) faltaAlgo = true;
      valores[c.id] = v;

      // Alerta de stock ANTES de mandar la venta al backend (el backend
      // también valida esto -- ver routes/ventas.js -- pero avisar acá
      // evita el viaje de ida y vuelta innecesario).
      if (c.id === 'cantidad' && input.max && v !== '' && Number(v) > Number(input.max)) {
        errorStock = `Solo hay ${input.max} unidad(es) disponibles. Reduce la cantidad.`;
      }
    });

    if (faltaAlgo) {
      statusEl.textContent = 'Completa los campos requeridos.';
      statusEl.style.color = 'var(--coral)';
      return;
    }
    if (errorStock) {
      statusEl.textContent = errorStock;
      statusEl.style.color = 'var(--coral)';
      return;
    }

    btn.disabled = true;
    const res = await onGuardar(valores);
    btn.disabled = false;
    if (!res) {
      const mensajeReal = obtenerUltimoError ? obtenerUltimoError() : null;
      statusEl.textContent = mensajeReal || 'No se pudo guardar. Revisa la conexión con el backend.';
      statusEl.style.color = 'var(--coral)';
      return;
    }
    statusEl.textContent = `${esquema.etiqueta[0].toUpperCase()}${esquema.etiqueta.slice(1)} guardado.`;
    statusEl.style.color = 'var(--teal)';
    esquema.campos.forEach(c => {
      const input = document.getElementById(idInput(c));
      if (c.type === 'select') input.value = '';
      else input.value = valorInicial(c);
    });
  });

  return { form };
}
