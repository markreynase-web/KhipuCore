// src/auditoria.js
// Un solo lugar para escribir en audit_log -- antes había 4 copias casi
// idénticas de esta función (crudFactory.js, ventas.js, inventario.js,
// finanzas.js). Recibe `db` (el pool, o un cliente de una transacción en
// curso vía pool.connect()) para que funcione igual en ambos casos.
//
// Nunca debe tumbar la operación principal: si falla, se registra en
// consola pero el crear/editar/borrar ya se guardó y la respuesta al
// usuario sigue siendo exitosa. El audit log es un "además", no un
// requisito para guardar.
// `usuario` acá es siempre req.usuario (el payload del JWT tal cual, en
// todos los call sites) -- durante una sesión de impersonación (ver
// routes/superadmin.js POST /empresas/:id/impersonar) ese payload trae
// impersonando:true e id/nombre son los del super admin, no los de nadie de
// la empresa. Por eso no hace falta que cada ruta de escritura sepa nada de
// impersonación: alcanza con leer ese flag acá, en el único lugar que
// escribe audit_log, para que quede marcado en todas partes automáticamente.
export async function registrarAuditoria(db, { usuario, accion, modulo, registroId, detalle }) {
  try {
    await db.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, modulo, registro_id, detalle, empresa_id, via_impersonacion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        usuario?.id ?? null,
        usuario?.nombre ?? 'Desconocido',
        accion,
        modulo,
        registroId ? String(registroId) : null,
        detalle ? JSON.stringify(detalle) : null,
        usuario?.empresa_id ?? null,
        usuario?.impersonando === true
      ]
    );
  } catch (err) {
    console.error('No se pudo escribir en audit_log:', err.message);
  }
}

// Igual filosofía que registrarAuditoria() de arriba (nunca tumba la
// operación principal), pero para eventos de PLATAFORMA de Super Admin que
// no pertenecen a ninguna empresa puntual (ej. alta/edición/baja de un
// módulo en el catálogo global). audit_log.empresa_id es NOT NULL a
// propósito -- cada fila ahí SIEMPRE pertenece a un tenant real (ver
// 012_empresas.sql); forzar un valor inventado para esto sería falso.
// superadmin_audit_log (migración 033) es la tabla separada para esto, sin
// esa restricción -- nunca aparece en GET /api/auditoria (que filtra por
// empresa_id), es exclusiva de Super Admin.
export async function registrarAuditoriaPlataforma(db, { usuario, accion, entidad, entidadId, detalle }) {
  try {
    await db.query(
      `INSERT INTO superadmin_audit_log (usuario_id, usuario_nombre, accion, entidad, entidad_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        usuario?.id ?? null,
        usuario?.nombre ?? 'Desconocido',
        accion,
        entidad,
        entidadId ? String(entidadId) : null,
        detalle ? JSON.stringify(detalle) : null
      ]
    );
  } catch (err) {
    console.error('No se pudo escribir en superadmin_audit_log:', err.message);
  }
}
