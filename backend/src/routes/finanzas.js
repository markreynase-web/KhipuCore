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
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('finanzas'));

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
  if (sucursal_id) { valores.push(sucursal_id); condiciones.push(`sucursal_id = $${valores.length}`); }
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
  try {
    const condicionesJoin = ['f.sucursal_id = s.id', 'f.empresa_id = s.empresa_id'];
    const valoresJoin = [empresaId];
    if (desde) { valoresJoin.push(desde); condicionesJoin.push(`f.fecha >= $${valoresJoin.length}`); }
    if (hasta) { valoresJoin.push(hasta); condicionesJoin.push(`f.fecha <= $${valoresJoin.length}`); }

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
         WHERE s.empresa_id = $1
         GROUP BY s.id, s.nombre, s.principal
         ORDER BY s.principal DESC, s.nombre ASC`,
        valoresJoin
      ),
      pool.query(
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

router.post('/', verificarPermiso('finanzas.crear'), async (req, res) => {
  const { fecha, tipo, categoria, concepto, monto, notas } = req.body;
  const errores = [];
  if (!fecha) errores.push('fecha es requerido');
  if (!['ingreso', 'egreso'].includes(tipo)) errores.push('tipo debe ser "ingreso" o "egreso"');
  if (!concepto) errores.push('concepto es requerido');
  // El signo del movimiento lo da "tipo" (ingreso/egreso), no "monto" -- un
  // monto negativo aquí resta de los totales de ingresos/egresos en vez de
  // sumar, sin ningún error.
  if (monto !== undefined && monto !== '' && numeroOCero(monto) < 0) errores.push('monto no puede ser negativo');
  if (errores.length) return res.status(400).json({ error: errores.join(', ') });

  try {
    const { rows } = await pool.query(
      `INSERT INTO finanzas (fecha, tipo, categoria, concepto, monto, notas, empresa_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [fecha, tipo, categoria || null, concepto, numeroOCero(monto), notas || null, req.usuario.empresa_id]
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
  const { rows: actuales } = await pool.query(`SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
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
  const { rows: actuales } = await pool.query(`SELECT * FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
  if (!actuales.length) return res.status(404).json({ error: 'Movimiento no encontrado.' });
  if (actuales[0].origen_modulo) {
    return res.status(409).json({ error: 'Este movimiento viene de una venta. Anúlala en Ventas para revertirlo; no se borra directo aquí.' });
  }

  try {
    await pool.query(`DELETE FROM finanzas WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId]);
    res.status(204).end();
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo: 'finanzas', registroId: req.params.id, detalle: { eliminado: actuales[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo borrar el movimiento.' });
  }
});

export default router;
