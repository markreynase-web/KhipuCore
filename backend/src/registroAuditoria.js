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
