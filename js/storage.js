// js/storage.js
// Persistencia en localStorage. Recibe un "namespace" (ej. 'ventas', 'inventario')
// para que cada página/módulo del dashboard tenga su propia clave y no se pisen
// datos entre sí cuando lleguemos a la Fase 5 (multipágina).

const PREFIJO = 'panelDatos_v2_';

function claveStorage(namespace) {
  return PREFIJO + (namespace || 'default');
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
