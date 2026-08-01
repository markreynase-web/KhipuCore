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

  cont.innerHTML = `
    <div class="sidebar-brand">
      <div class="mark">${config.logo || 'GDE'}</div>
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
  cont.innerHTML = `
    <div class="sidebar-avatar">${inicial}</div>
    <div class="sidebar-footer-info">
      <div class="sidebar-footer-nombre">${sesion.usuario.nombre}</div>
      <div class="sidebar-footer-rol">${sesion.usuario.rol}</div>
    </div>
    <button type="button" class="sidebar-logout" id="btnCerrarSesionSidebar" title="Cerrar sesión">⎋</button>
  `;
  document.getElementById('btnCerrarSesionSidebar').addEventListener('click', () => {
    cerrarSesion();
    location.reload();
  });
}
