// scripts/dr/dataset.js
// Config compartida por TODOS los scripts de C3 -- una sola fuente de
// verdad de qué tablas/columnas entran en el snapshot/manifiesto, para que
// seed/snapshot/simulateLoss/verifyLoss/verifyIntegrity nunca se
// desincronicen entre sí sobre qué es "el dataset QA-DR".
//
// Puro dato/config -- sin conexión a base, sin nada destructivo. Seguro de
// importar y correr en cualquier momento.

export const PREFIJO_DR = 'QA-DR-';

// Contraseña sintética del usuario QA-DR -- nunca se escribe en
// dr_manifest.json. Configurable vía DR_QA_PASSWORD; con un valor por
// defecto conocido si no se define. Vive acá (no en seed.js) para que
// verifyFunctional.js pueda usarla sin tener que importar seed.js (que se
// autoejecuta al importarse -- volvería a sembrar datos por accidente).
export const DR_PASSWORD = process.env.DR_QA_PASSWORD || 'DrRecovery-2026-QA';

// Orden FIJO de tablas -- se usa tal cual para el hash global (hash de
// hashes) y para el resumen humano. Si esto cambiara de orden, cambiaría
// el hash aunque los datos fueran idénticos -- por eso vive en un solo
// lugar, nunca se deriva de Object.keys() de algo dinámico.
export const ORDEN_TABLAS = [
  'empresas', 'usuarios', 'usuario_empresa', 'clientes', 'inventario', 'ventas', 'finanzas', 'mascotas'
];

// usuario_empresa se agrega respecto a la lista mínima original a
// propósito: es la tabla que de verdad prueba "el usuario pertenece a la
// empresa correcta, con el rol correcto" (C3.9) -- dejarla afuera del
// snapshot habría dejado un hueco real en lo que el hash demuestra.

// Columnas explícitas por tabla, en el orden en que se serializan --
// NUNCA "SELECT *". Incluye id y timestamps a propósito: pg_dump captura
// su valor LITERAL (no la expresión DEFAULT now()), así que un restore
// correcto debe reproducirlos exactos -- si no coinciden es una diferencia
// real a investigar, no ruido esperado a descartar (ver diseño C3.3).
export const COLUMNAS = {
  empresas: ['id', 'nombre', 'activo', 'creado_el', 'actualizado_el'],
  usuarios: ['id', 'nombre', 'email', 'activo', 'creado_el', 'actualizado_el'],
  usuario_empresa: ['usuario_id', 'empresa_id', 'rol_id', 'activo'],
  clientes: ['id', 'empresa_id', 'nombre', 'compras_totales', 'creado_el', 'actualizado_el'],
  inventario: ['id', 'empresa_id', 'nombre', 'categoria', 'stock', 'precio_unitario', 'creado_el', 'actualizado_el'],
  ventas: ['id', 'empresa_id', 'cliente_id', 'producto_id', 'cantidad', 'precio_unitario', 'monto', 'creado_el', 'actualizado_el'],
  finanzas: ['id', 'empresa_id', 'tipo', 'categoria', 'concepto', 'monto', 'origen_modulo', 'origen_id', 'creado_el', 'actualizado_el'],
  mascotas: ['id', 'empresa_id', 'cliente_id', 'nombre', 'especie', 'creado_el', 'actualizado_el']
};

// usuario_empresa no tiene columna id propia (ver fixtures.js/routes) --
// se ordena por su llave natural en vez de "id ASC".
export const ORDEN_POR = {
  usuario_empresa: ['usuario_id', 'empresa_id']
};

export function ordenPorDefecto(tabla) {
  return ORDEN_POR[tabla] || ['id'];
}

// Directorio de salida para manifiesto/snapshots -- backend/backups/ ya
// está en .gitignore (agregado en C1.2), así que todo lo de dr/ queda
// cubierto sin necesitar otra entrada nueva.
export const DIR_SALIDA_DR = 'backups/dr';
