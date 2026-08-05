// components/sidebar.js
// Reemplaza a components/nav.js (menú horizontal) por el sidebar vertical
// fijo del nuevo diseño. Mismo criterio de antes: un módulo con
// baseDeDatos:true solo aparece si el usuario tiene "{modulo}.ver"; los
// módulos deshabilitados en config/company.json ni siquiera se agregan al DOM.
//
// Agrega una sección fija "CONFIGURACIÓN" con Usuarios y Auditoría (Fase 6):
// esas dos SÍ están conectadas a endpoints reales del backend
// (/api/usuarios, /api/auditoria) y solo se muestran si el usuario tiene
// "usuarios.ver" / "auditoria.ver". No hay una sección "Reportes" todavía
// -- decidimos no ponerla hasta tener algo real detrás, para no dejar un
// link muerto en el menú.

import { modulosHabilitados } from '../js/config.js';
import { tienePermiso, tieneAlgunPermiso, haySesionActiva, obtenerSesion, cerrarSesion } from '../js/sesion.js';

function itemHtml(m, activo) {
  return `
    <a class="sidebar-item${activo ? ' active' : ''}" href="${m.href}">
      <span class="sidebar-icon">${m.icon || '•'}</span>
      <span>${m.label}</span>
    </a>`;
}

export function renderSidebar(config, paginaActualId) {
  const cont = document.getElementById('sidebar');
  if (!cont) return;

  const sinSesion = !haySesionActiva();

  const modulosPrincipales = modulosHabilitados(config).filter(m => {
    // Khipu AI no es una página navegable (no tiene captura/Vista Ejecutiva
    // ni un .html real detrás) -- es solo un flag de catálogo para que el
    // panel de super admin pueda habilitarlo/deshabilitarlo por empresa. Sin
    // este filtro caía en la rama de abajo (baseDeDatos:false = "módulo
    // libre, mostrar siempre", pensada para Compras/RRHH) y aparecía como
    // pestaña rota -> 404 al hacer clic (ver components/khipuAiWidget.js
    // para el botón flotante, que es la única UI real de este módulo).
    if (m.id === 'khipu_ai') return false;
    if (!m.baseDeDatos) return true;
    if (sinSesion) return true; // el guard de app.js ya redirige a login antes si el módulo lo exige
    return tienePermiso(`${m.id}.ver`);
  });

  const seccionConfig = [];
  if (sinSesion || tieneAlgunPermiso('usuarios')) {
    seccionConfig.push({ id: 'usuarios', label: 'Usuarios', icon: '👤', href: 'usuarios.html' });
  }
  if (sinSesion || tieneAlgunPermiso('auditoria')) {
    seccionConfig.push({ id: 'auditoria', label: 'Auditoría', icon: '🛡️', href: 'auditoria.html' });
  }

  asegurarFavicon();

  cont.innerHTML = `
    <div class="sidebar-brand">
      <img class="mark" src="../assets/logo-icon.png" alt="KhipuCore">
      <div class="sidebar-brand-text">
        <input class="biz-name" id="bizName" value="${config.bizName || 'Gestor de Datos Empresariales'}" />
        <div class="sidebar-subtitle" id="sidebarSubtitle"></div>
      </div>
    </div>
    <nav class="sidebar-nav">
      ${!sinSesion ? `
        <div class="sidebar-group">
          ${itemHtml({ id: 'inicio', label: 'Inicio', icon: '🏠', href: 'inicio.html' }, paginaActualId === 'inicio')}
        </div>` : ''}
      ${modulosPrincipales.length ? `
        <div class="sidebar-group">
          <div class="sidebar-group-label">Módulo principal</div>
          ${modulosPrincipales.map(m => itemHtml({ ...m, href: m.page }, m.id === paginaActualId)).join('')}
        </div>` : ''}
      ${seccionConfig.length ? `
        <div class="sidebar-group">
          <div class="sidebar-group-label">Configuración</div>
          ${seccionConfig.map(m => itemHtml(m, m.id === paginaActualId)).join('')}
        </div>` : ''}
    </nav>
    <div class="sidebar-footer" id="sidebarFooter"></div>
  `;

  renderSidebarFooter();
  asegurarControlesMovil();
}

// Ícono de pestaña del navegador -- se agrega una sola vez por página, acá
// en vez de tener que repetir <link rel="icon"> en las 11 páginas que usan
// el sidebar (login.html y privacidad.html, que no usan el sidebar, lo
// declaran directo en su <head>).
function asegurarFavicon() {
  if (document.querySelector('link[rel="icon"]')) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = '../assets/logo-icon.png';
  document.head.appendChild(link);
}

// Botón hamburguesa (topbar) + overlay oscuro (body), para el menú tipo
// drawer en celular (ver @media max-width:640px en css/layout.css). Se
// generan una sola vez desde acá -- así no hay que agregar este mismo
// bloque de HTML a mano en las 11 páginas que usan el sidebar.
function asegurarControlesMovil() {
  if (!document.getElementById('btnMenuMovil')) {
    const topbar = document.querySelector('.topbar');
    if (topbar) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'btnMenuMovil';
      btn.className = 'sidebar-toggle-movil';
      btn.setAttribute('aria-label', 'Abrir menú');
      btn.textContent = '☰';
      topbar.prepend(btn);
      btn.addEventListener('click', () => toggleSidebarMovil(true));
    }
  }

  if (!document.getElementById('sidebarOverlayMovil')) {
    const overlay = document.createElement('div');
    overlay.id = 'sidebarOverlayMovil';
    overlay.className = 'sidebar-overlay-movil';
    overlay.addEventListener('click', () => toggleSidebarMovil(false));
    document.body.appendChild(overlay);
  }
}

function toggleSidebarMovil(abrir) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlayMovil');
  if (!sidebar || !overlay) return;
  sidebar.classList.toggle('abierto', abrir);
  overlay.classList.toggle('activo', abrir);
  document.body.classList.toggle('sidebar-movil-abierto', abrir);
}

function renderSidebarFooter() {
  const cont = document.getElementById('sidebarFooter');
  if (!cont) return;
  const sesion = obtenerSesion();

  if (!sesion || !sesion.usuario) {
    cont.innerHTML = `<a class="sidebar-login-link" href="login.html">Iniciar sesión</a>`;
    return;
  }

  const inicial = (sesion.usuario.nombre || '?').trim().charAt(0).toUpperCase();
  // empresa_nombre solo existe desde Fase A -- sesiones viejas (si alguien
  // no cerró sesión antes del deploy) no lo tienen, por eso el guard.
  const empresaHtml = sesion.usuario.empresa_nombre
    ? `<div class="sidebar-footer-rol" title="Empresa activa">${sesion.usuario.rol} · ${sesion.usuario.empresa_nombre}</div>`
    : `<div class="sidebar-footer-rol">${sesion.usuario.rol}</div>`;
  cont.innerHTML = `
    <div class="sidebar-avatar">${inicial}</div>
    <div class="sidebar-footer-info">
      <div class="sidebar-footer-nombre">${sesion.usuario.nombre}</div>
      ${empresaHtml}
    </div>
    <button type="button" class="sidebar-logout" id="btnCerrarSesionSidebar" title="Cerrar sesión">⎋</button>
  `;
  document.getElementById('btnCerrarSesionSidebar').addEventListener('click', () => {
    cerrarSesion();
    location.reload();
  });
}
