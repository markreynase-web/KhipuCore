// components/khipuAiWidget.js
// Fase D: botón flotante "Khipu AI" + ventana de chat tipo burbuja
// (Facebook Messenger) -- una ventanita fija que se despliega junto al
// botón, no el panel lateral de ancho completo que usa el resto de la app
// (decisión explícita del usuario: NO reutiliza components/panelLateral.js).

import { buscarModulo } from '../js/config.js';
import { tienePermiso } from '../js/sesion.js';
import { preguntarKhipuAi } from '../js/khipuAi.js';

// Vive en memoria de esta carga de página -- se pierde al recargar, a
// propósito (mismo criterio de "generación en vivo" del resto de la Fase D:
// nada de historial persistido en el servidor).
let historial = [];
let abierta = false;

export function renderKhipuAiWidget(config) {
  const habilitado = !!buscarModulo(config, 'khipu_ai') && tienePermiso('khipu_ai.ver');
  const widget = document.getElementById('khipuAiWidget');

  if (!habilitado) {
    if (widget) widget.remove();
    return;
  }

  asegurarEstilos();
  asegurarWidget();
}

// Igual que asegurarFavicon() en components/sidebar.js: se inyecta una sola
// vez, así ninguna de las páginas de módulo necesita un <link> a mano.
function asegurarEstilos() {
  if (document.querySelector('link[data-khipu-ai-css]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '../css/khipu-ai-widget.css';
  link.setAttribute('data-khipu-ai-css', '');
  document.head.appendChild(link);
}

function asegurarWidget() {
  if (document.getElementById('khipuAiWidget')) return;

  const wrap = document.createElement('div');
  wrap.id = 'khipuAiWidget';
  wrap.className = 'khipu-ai-widget';
  wrap.innerHTML = `
    <div class="khipu-ai-ventana" id="khipuAiVentana">
      <div class="khipu-ai-ventana-header">
        <span class="khipu-ai-ventana-titulo">🤖 Khipu AI</span>
        <button type="button" class="khipu-ai-ventana-cerrar" id="khipuAiCerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="khipu-ai-mensajes" id="khipuAiMensajes"></div>
      <div class="khipu-ai-estado" id="khipuAiEstado"></div>
      <form class="khipu-ai-form" id="khipuAiForm">
        <input type="text" id="khipuAiInput" placeholder="Pregúntale a Khipu AI..." autocomplete="off" />
        <button type="submit" class="btn btn-ochre" id="khipuAiEnviarBtn">Enviar</button>
      </form>
    </div>
    <button type="button" class="khipu-ai-boton" id="khipuAiBoton" aria-label="Abrir Khipu AI"><span>🤖</span></button>
  `;
  document.body.appendChild(wrap);

  document.getElementById('khipuAiBoton').addEventListener('click', () => setVentana(!abierta));
  document.getElementById('khipuAiCerrar').addEventListener('click', () => setVentana(false));
  document.getElementById('khipuAiForm').addEventListener('submit', onEnviar);

  renderMensajes();
}

function setVentana(mostrar) {
  abierta = mostrar;
  document.getElementById('khipuAiVentana')?.classList.toggle('activa', abierta);
  document.getElementById('khipuAiBoton')?.classList.toggle('activo', abierta);
  if (abierta) document.getElementById('khipuAiInput')?.focus();
}

function renderMensajes() {
  const cont = document.getElementById('khipuAiMensajes');
  if (!cont) return;

  if (!historial.length) {
    cont.innerHTML = '<div class="khipu-ai-msg khipu-ai-msg-asistente">Hola, soy Khipu AI 👋 Pregúntame sobre tus ventas, inventario, finanzas o clientes.</div>';
  } else {
    cont.innerHTML = historial.map(m => {
      const clase = m.rol === 'user' ? 'khipu-ai-msg-user' : 'khipu-ai-msg-asistente';
      const fuentes = m.herramientas?.length
        ? `<div class="khipu-ai-fuentes">Consulté: ${m.herramientas.join(', ')}</div>`
        : '';
      return `<div class="khipu-ai-msg ${clase}">${escaparHtml(m.texto)}${fuentes}</div>`;
    }).join('');
  }
  cont.scrollTop = cont.scrollHeight;
}

async function onEnviar(e) {
  e.preventDefault();
  const input = document.getElementById('khipuAiInput');
  const boton = document.getElementById('khipuAiEnviarBtn');
  const estado = document.getElementById('khipuAiEstado');
  const pregunta = input.value.trim();
  if (!pregunta) return;

  historial.push({ rol: 'user', texto: pregunta });
  renderMensajes();
  input.value = '';
  input.disabled = true;
  boton.disabled = true;
  estado.textContent = 'Khipu AI está pensando...';

  try {
    const historialParaBackend = historial.slice(0, -1).map(m => ({ rol: m.rol, texto: m.texto }));
    const { respuesta, herramientas_usadas } = await preguntarKhipuAi(pregunta, historialParaBackend);
    historial.push({ rol: 'assistant', texto: respuesta, herramientas: herramientas_usadas });
  } catch (err) {
    historial.push({ rol: 'assistant', texto: `⚠️ ${err.message}` });
  } finally {
    estado.textContent = '';
    input.disabled = false;
    boton.disabled = false;
    renderMensajes();
    input.focus();
  }
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML.replace(/\n/g, '<br>');
}
