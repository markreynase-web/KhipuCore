// js/storage.js
// Persistencia en localStorage. Recibe un "namespace" (ej. 'ventas', 'inventario')
// para que cada página/módulo del dashboard tenga su propia clave y no se pisen
// datos entre sí cuando lleguemos a la Fase 5 (multipágina).
//
// Fase A (multi-tenant): la clave también incluye la empresa activa de la
// sesión, para que dos empresas distintas usando el mismo navegador no se
// pisen los datos locales (ej. un CSV parseado en el navegador antes de
// mandarlo). Esto solo protege a los módulos con backend (los que exigen
// login, que es justo de donde sale el empresa_id) -- los módulos sin
// backend (compras/rrhh/producción/marketing) no tienen empresa_id
// disponible y ese riesgo de colisión ya existía antes; Fase A no lo
// resuelve.

import { obtenerSesion } from './sesion.js';

const PREFIJO = 'panelDatos_v2_';

function claveStorage(namespace) {
  const empresaId = obtenerSesion()?.usuario?.empresa_id;
  return PREFIJO + (empresaId ? `${empresaId}_` : '') + (namespace || 'default');
}

export function guardarDatosLocal(namespace, { datos, ultimoResultado, bizName }) {
  if (!datos || !ultimoResultado) return false;
  try {
    const payload = {
      filas: datos,
      archivo: ultimoResultado.archivo,
      mapa: ultimoResultado.mapa,
      stats: ultimoResultado.stats,
      cols: ultimoResultado.cols,
      bizName,
      guardadoEl: Date.now()
    };
    localStorage.setItem(claveStorage(namespace), JSON.stringify(payload));
    return true;
  } catch (err) {
    // Cuota excedida u otro error de almacenamiento: la app sigue funcionando, solo no persiste.
    return false;
  }
}

export function cargarDatosLocal(namespace) {
  try {
    const crudo = localStorage.getItem(claveStorage(namespace));
    if (!crudo) return null;
    return JSON.parse(crudo);
  } catch (err) {
    return null;
  }
}

export function borrarDatosLocal(namespace) {
  localStorage.removeItem(claveStorage(namespace));
}
