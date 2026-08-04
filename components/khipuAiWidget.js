// components/khipuAiWidget.js
// Fase D: botón flotante "Khipu AI", visible en toda página que cargue
// js/app.js (ver el único punto de inyección en app.js, después de
// renderSidebar). Reutiliza components/panelLateral.js (ya genérico, ya
// probado) para el drawer de chat -- no se construye un modal nuevo.

import { buscarModulo } from '../js/config.js';
import { tienePermiso } from '../js/sesion.js';
import { preguntarKhipuAi } from '../js/khipuAi.js';
import { abrirPanelLateral } from './panelLateral.js';

// Vive en memoria de esta carga de página -- se pierde al recargar, a
// propósito (mismo criterio de "generación en vivo" del resto de la Fase D:
// nada de historial persistido en el servidor).
let historial = [];

export function renderKhipuAiWidget(config) {
  const habilitado = !!buscarModulo(config, 'khipu_ai') && tienePermiso('khipu_ai.ver');
  const boton = document.getElementById('khipuAiBoton');

  if (!habilitado) {
    if (boton) boton.remove();
    return;
  }

  asegurarEstilos();
  asegurarBoton();
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

function asegurarBoton() {
  if (document.getElementById('khipuAiBoton')) return;
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.id = 'khipuAiBoton';
  boton.className = 'khipu-ai-boton';
  boton.setAttribute('aria-label', 'Abrir Khipu AI');
  boton.innerHTML = '<span>🤖</span>';
  boton.addEventListener('click', abrirChat);
  document.body.appendChild(boton);
}

function abrirChat() {
  abrirPanelLateral({
    titulo: 'Khipu AI',
    icono: '🤖',
    montar: (body) => {
      body.innerHTML = `
        <div class="khipu-ai-chat">
          <div class="khipu-ai-mensajes" id="khipuAiMensajes"></div>
          <div class="khipu-ai-estado" id="khipuAiEstado"></div>
          <form class="khipu-ai-form" id="khipuAiForm">
            <input type="text" id="khipuAiInput" placeholder="Pregúntale a Khipu AI sobre tu negocio..." autocomplete="off" />
            <button type="submit" class="btn btn-ochre" id="khipuAiEnviarBtn">Enviar</button>
          </form>
        </div>
      `;
      renderMensajes();
      document.getElementById('khipuAiForm').addEventListener('submit', onEnviar);
      document.getElementById('khipuAiInput').focus();
    }
  });
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

  // El scroll real vive en el panel compartido (#panelLateralBody), no en
  // este contenedor -- ver css/panel-lateral.css.
  document.getElementById('panelLateralBody')?.scrollTo(0, 999999);
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
