// src/routes/finanzas.js
// Movimientos de ingreso/egreso. Los que vienen de una venta se insertan
// desde routes/ventas.js (origen_modulo='ventas'); este router los deja
// leer pero NO editar ni borrar directamente aquí -- si se anula la venta
// original en Ventas, ese movimiento se borra solo (ver ventas.js DELETE).
// Esto evita que Finanzas y Ventas se desincronicen por una edición manual.
//
// Los movimientos manuales (gastos, pagos a proveedores, ajustes) sí
// tienen CRUD completo.
//
// Fase A (multi-tenant): archivo 100% manual (no pasa por crudFactory.js),
// así que cada consulta agrega "empresa_id" a mano.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { resolverRestriccionSucursal } from '../middleware/sucursal.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, resolverRestriccionSucursal, requireModulo('finanzas'));

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Paginación (Fase 3, Eje A) opt-in, mismo criterio que crudFactory.js/
// ventas.js: sin ?pagina=/?page=, responde igual que siempre (array plano,
// hasta 5000 filas) -- js/modoBackend.js asume un array plano acá también.
router.get('/', verificarPermiso('finanzas.ver'), async (req, res) => {
  const { desde, hasta, limite, pagina, page, sucursal_id } = req.query;
  const valores = [req.usuario.empresa_id];
  const condiciones = [`empresa_id = $1`];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  // Opt-in, igual que en ventas.js/inventario.js -- sin el query param, se
  // sigue viendo todo el detalle de la empresa como siempre.
  //
  // Sub-fase D: si el usuario está restringido, su sucursal SIEMPRE gana --
  // nunca el query param del cliente en ese caso (ver ventas.js GET, mismo criterio).
  const sucursalEfectiva = req.sucursalRestringida ?? sucursal_id;
  if (sucursalEfectiva) { valores.push(sucursalEfectiva); condiciones.push(`sucursal_id = $${valores.length}`); }
  const where = `WHERE ${condiciones.join(' AND ')}`;
  try {
    const paginaCruda = pagina ?? page;
    if (paginaCruda !== undefined) {
      const paginaFinal = Math.max(parseInt(paginaCruda, 10) || 1, 1);
      const limiteFinal = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 100);
      const offset = (paginaFinal - 1) * limiteFinal;
      const [{ rows: datos }, { rows: totalRows }] = await Promise.all([
        pool.query(`SELECT * FROM finanzas ${where} ORDER BY fecha DESC, id DESC LIMIT ${limiteFinal} OFFSET ${offset}`, valores),
        pool.query(`SELECT count(*)::int AS total FROM finanzas ${where}`, valores)
      ]);
      const total = totalRows[0].total;
      return res.json({
        datos,
        meta: { total, pagina: paginaFinal, limite: limiteFinal, paginasTotales: Math.ceil(total / limiteFinal) }
      });
    }
    const { rows } = await pool.query(`SELECT * FROM finanzas ${where} ORDER BY fecha DESC, id DESC LIMIT 5000`, valores);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer los movimientos de finanzas.' });
  }
});

// GET /resumen-sucursales?desde&hasta -- cuánto ganó (ingreso - egreso) cada
// sucursal, más un total general. Gateado SOLO por finanzas.ver -- a
// propósito no exige sucursales.ver aparte: alguien con acceso nada más a
// Finanzas tiene que poder ver esto sin que le falte otro permiso (el
// nombre de cada sucursal sale de un JOIN interno, no de que el usuario
// pueda pegarle a GET /api/sucursales).
//
// "sinSucursal" es su propio bucket, no se pierde en ningún lado: movimientos
// manuales (compras, RRHH, ajustes) o ventas de antes de esta sub-fase no
// tienen sucursal_id, y sin este bucket esa plata desaparecería del
// desglose en vez de aparecer como "sin asignar".
//
// El filtro de fecha va en el ON del LEFT JOIN, no en un WHERE aparte --
// un WHERE ahí eliminaría del resultado a cualquier sucursal sin ningún
// movimiento en el período (f.fecha sería NULL, y NULL >= $x nunca es true),
// que es exactamente el caso que el LEFT JOIN existe para conservar (una
// sucursal nueva o inactiva en el período debe aparecer igual, con 0/0/0).
router.get('/resumen-sucursales', verificarPermiso('finanzas.ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const empresaId = req.usuario.empresa_id;
  // Sub-fase D: un usuario restringido a una sucursal solo ve SU propia
  // fila -- ni las demás sucursales, ni el bucket "sin asignar" (eso es
  // información a nivel empresa, no de su sede). No hay pedido explícito
  // de otra sucursal que rechazar acá (este endpoint no acepta
  // ?sucursal_id=), así que no aplica el 403 -- se resuelve filtrando la
  // query en sí misma.
  const restringido = req.sucursalRestringida ?? null;
  try {
    const condicionesJoin = ['f.sucursal_id = s.id', 'f.empresa_id = s.empresa_id'];
    const valoresJoin = [empresaId];
    if (desde) { valoresJoin.push(desde); condicionesJoin.push(`f.fecha >= $${valoresJoin.length}`); }
    if (hasta) { valoresJoin.push(hasta); condicionesJoin.push(`f.fecha <= $${valoresJoin.length}`); }

    const condicionesSucursales = ['s.empresa_id = $1'];
    if (restringido != null) { valoresJoin.push(restringido); condicionesSucursales.push(`s.id = $${valoresJoin.length}`); }

    const condicionesSin = ['empresa_id = $1', 'sucursal_id IS NULL'];
    const valoresSin = [empresaId];
    if (desde) { valoresSin.push(desde); condicionesSin.push(`fecha >= $${valoresSin.length}`); }
    if (hasta) { valoresSin.push(hasta); condicionesSin.push(`fecha <= $${valoresSin.length}`); }

    const [{ rows: porSucursalRows }, { rows: sinSucursalRows }] = await Promise.all([
      pool.query(
        `SELECT s.id AS sucursal_id, s.nombre AS sucursal_nombre, s.principal,
                COALESCE(SUM(CASE WHEN f.tipo = 'ingreso' THEN f.monto ELSE 0 END), 0) AS ingresos,
                COALESCE(SUM(CASE WHEN f.tipo = 'egreso' THEN f.monto ELSE 0 END), 0) AS egresos
         FROM sucursales s
         LEFT JOIN finanzas f ON ${condicionesJoin.join(' AND ')}
         WHERE ${condicionesSucursales.join(' AND ')}
         GROUP BY s.id, s.nombre, s.principal
         ORDER BY s.principal DESC, s.nombre ASC`,
        valoresJoin
      ),
      // Restringido: nunca consulta el bucket "sin asignar" -- no es su
      // sucursal, así que ni vale la pena la query.
      restringido != null
        ? Promise.resolve({ rows: [{ ingresos: 0, egresos: 0 }] })
        : pool.query(
            `SELECT COALESCE(SUM(CASE WHEN tipo = 'ingreso' THEN monto ELSE 0 END), 0) AS ingresos,
                    COALESCE(SUM(CASE WHEN tipo = 'egreso' THEN monto ELSE 0 END), 0) AS egresos
             FROM finanzas WHERE ${condicionesSin.join(' AND ')}`,
            valoresSin
          )
    ]);

    const conGanancia = (r) => ({ ingresos: +Number(r.ingresos).toFixed(2), egresos: +Number(r.egresos).toFixed(2), ganancia: +(Number(r.ingresos) - Number(r.egresos)).toFixed(2) });

    const porSucursal = porSucursalRows.map(r => ({
      sucursal_id: r.sucursal_id, sucursal_nombre: r.sucursal_nombre, principal: r.principal,
      ...conGanancia(r)
    }));
    const sinSucursal = conGanancia(sinSucursalRows[0]);
    const total = {
      ingresos: +(porSucursal.reduce((a, s) => a + s.ingresos, 0) + sinSucursal.ingresos).toFixed(2),
      egresos: +(porSucursal.reduce((a, s) => a + s.egresos, 0) + sinSucursal.egresos).toFixed(2),
      ganancia: +(porSucursal.reduce((a, s) => a + s.ganancia, 0) + sinSucursal.ganancia).toFixed(2)
    };

    res.json({ porSucursal, sinSucursal, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo calcular el resumen por sucursal.' });
  }
});

// D.5 (Sub-fase D): sucursal_id es OPCIONAL para un usuario sin restricción
// -- puede elegir etiquetar el movimiento (aparece en su sucursal en el
// resumen) o dejarlo sin asignar (cae en el bucket "sinSucursal" de
// siempre). Para un usuario restringido, resolverRestriccionSucursal ya
// rechazó con 403 cualquier valor que no sea el suyo -- si no mandó nada,
// se autocompleta acá abajo, igual que en inventario.js POST.
// Sub-fase E: turno_caja_id también OPCIONAL -- para poder registrar un
// retiro/ingreso de efectivo DENTRO de un turno (sin esto, el arqueo de
// cajas.js nunca vería estos movimientos manuales, y "diferencia" nunca
// cuadraría). Si se manda, tiene que ser un turno ABIERTO de esta empresa,
// y su sucursal (la de su caja) GANA sobre cualquier sucursal_id que
// también se haya mandado -- un movimiento atado a un turno pertenece a la
// sucursal de ese turno, no puede ser una combinación inconsistente.
router.post('/', verificarPermiso('finanzas.crear'), async (req, res) => {
  const { fecha, tipo, categoria, concepto, monto, notas, turno_caja_id } = req.body;
  const errores = [];
  if (!fecha) errores.push('fecha es requerido');
  if (!['ingreso', 'egreso'].includes(tipo)) errores.push('tipo debe ser "ingreso" o "egreso"');
  if (!concepto) errores.push('concepto es requerido');
  // El signo del movimiento lo da "tipo" (ingreso/egreso), no "monto" -- un
  // monto negativo aquí resta de los totales de ingresos/egresos en vez de
  // sumar, sin ningún error.
  if (monto !== undefined && monto !== '' && numeroOCero(monto) < 0) errores.push('monto no puede ser negativo');
  if (turno_caja_id !== undefined && turno_caja_id !== null && turno_caja_id !== '' && !Number.isInteger(turno_caja_id)) {
    errores.push('turno_caja_id debe ser un número entero.');
  }

  // '' y null/undefined se tratan igual ("no lo especificó") -- un usuario
  // restringido que mande sucursal_id:'' de todos modos cae en la suya, no
  // se le permite "vaciarlo" a propósito (D.5: no puede dejar costos sin
  // asignar, tiene que quedar atribuido a su sucursal).
  const bodyVacio = req.body.sucursal_id === undefined || req.body.sucursal_id === null || req.body.sucursal_id === '';
  const sucursalIdCruda = bodyVacio ? (req.sucursalRestringida ?? null) : req.body.sucursal_id;
  let sucursalId = null;
  if (sucursalIdCruda !== null && sucursalIdCruda !== undefined && sucursalIdCruda !== '') {
    const n = Number(sucursalIdCruda);
    if (!Number.isInteger(n)) errores.push('sucursal_id debe ser un número entero, o vacío para dejarlo sin asignar.');
    else sucursalId = n;
  }
  if (errores.length) return res.status(400).json({ error: errores.join(', ') });

  try {
    let turnoCajaIdFinal = null;
    if (turno_caja_id !== undefined && turno_caja_id !== null && turno_caja_id !== '') {
      const { rows: turnoRows } = await pool.query(
        `SELECT t.id, c.sucursal_id FROM turnos_caja t JOIN cajas c ON c.id = t.caja_id
         WHERE t.id = $1 AND t.empresa_id = $2 AND t.estado = 'abierto'`,
        [turno_caja_id, req.usuario.empresa_id]
      );
      if (!turnoRows.length) return res.status(400).json({ error: 'El turno indicado no está abierto o no existe.' });
      const turno = turnoRows[0];
      if (req.sucursalRestringida != null && turno.sucursal_id !== req.sucursalRestringida) {
        return res.status(400).json({ error: 'El turno indicado no corresponde a tu sucursal.' });
      }
      turnoCajaIdFinal = turno.id;
      sucursalId = turno.sucursal_id; // la sucursal del turno gana sobre cualquier sucursal_id mandado
    }

    // 404 si mandaron una sucursal que no existe o es de otra empresa --
    // misma razón de "no confirmar existencia ajena" que en inventario.js.
    // Defensa en profundidad: aunque el middleware ya validó que coincide
    // con la del usuario restringido (si aplica), la query es quien decide.
    // Se saltea si sucursalId ya vino resuelta y confirmada por el turno.
    if (sucursalId !== null && turnoCajaIdFinal === null) {
      const { rows: sucursalRows } = await pool.query('SELECT id FROM sucursales WHERE id = $1 AND empresa_id = $2', [sucursalId, req.usuario.empresa_id]);
      if (!sucursalRows.length) return res.status(404).json({ error: 'La sucursal indicada no existe.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, notas, empresa_id, sucursal_id, turno_caja_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [fecha, tipo, categoria || null, concepto, numeroOCero(monto), notas || null, req.usuario.empresa_id, sucursalId, turnoCajaIdFinal]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'finanzas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo guardar el movimiento.' });
  }
});

router.put('/:id', verificarPermiso('finanzas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  // Sub-fase D: acceso indirecto por id -- en el WHERE de la SELECT inicial.
  // Un restringido tampoco puede editar un movimiento "sin asignar" (NULL):
  // no es suyo, es de nivel empresa.
  const { rows: actuales } = await pool.query(
    `SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2 AND ($3::int IS NULL OR sucursal_id = $3)`,
    [req.params.id, empresaId, req.sucursalRestringida ?? null]
  );
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se edita directo aquí.' });
  }
  const antes = actuales[0];

  const { fecha, tipo, categoria, concepto, monto, notas } = req.body;
  if (monto !== undefined && monto !== '' && numeroOCero(monto) < 0) {
    return res.status(400).json({ error: 'monto no puede ser negativo' });
  }
  try {
    const montoNuevo = numeroOCero(monto);
    const { rows } = await pool.query(
      `UPDATE finanzas SET fecha=COALESCE($1,fecha), tipo=COALESCE($2,tipo), categoria=$3, concepto=COALESCE($4,concepto),
       monto=$5, notas=$6, actualizado_el=now() WHERE id=$7 AND empresa_id=$8 RETURNING *`,
      [fecha || null, tipo || null, categoria || null, concepto || null, montoNuevo, notas || null, req.params.id, empresaId]
    );
    res.json(rows[0]);

    // Diff simple antes/después -- suficiente para este módulo (no tiene
    // tantos campos como ventas.js), no hace falta el helper sonIguales()
    // de crudFactory.js.
    const cambios = {};
    ['fecha', 'tipo', 'categoria', 'concepto', 'monto', 'notas'].forEach(campo => {
      let antesVal = antes[campo];
      let despuesVal = rows[0][campo];
      if (campo === 'monto') { antesVal = Number(antesVal); despuesVal = Number(despuesVal); }
      else {
        if (antesVal instanceof Date) antesVal = antesVal.toISOString().slice(0, 10);
        if (despuesVal instanceof Date) despuesVal = despuesVal.toISOString().slice(0, 10);
      }
      const iguales = campo === 'monto' ? antesVal === despuesVal : String(antesVal ?? '') === String(despuesVal ?? '');
      if (!iguales) cambios[campo] = { antes: antesVal, despues: despuesVal };
    });
    registrarAuditoria(pool, {
      usuario: req.usuario, accion: 'editar', modulo: 'finanzas', registroId: req.params.id,
      detalle: Object.keys(cambios).length ? cambios : 'Sin cambios en los valores (se guardó igual).'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar el movimiento.' });
  }
});

router.delete('/:id', verificarPermiso('finanzas.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  // Sub-fase D: mismo criterio que PUT -- ver comentario arriba.
  const { rows: actuales } = await pool.query(
    `SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2 AND ($3::int IS NULL OR sucursal_id = $3)`,
    [req.params.id, empresaId, req.sucursalRestringida ?? null]
  );
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se borra directo aquí.' });
  }

  try {
    await pool.query(
      `DELETE FROM finanzas WHERE id = $1 AND empresa_id = $2 AND ($3::int IS NULL OR sucursal_id = $3)`,
      [req.params.id, empresaId, req.sucursalRestringida ?? null]
    );
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'finanzas', registroId: req.params.id, detalle: { eliminado: actuales[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el movimiento.' });
  }
});

export default router;
