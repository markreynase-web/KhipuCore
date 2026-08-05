// src/routes/postventa.js
// Órdenes de servicio (Fase C, vertical automotriz). Mismo patrón
// transaccional que ventas.js: repuesto_id es OPCIONAL (a diferencia de
// ventas.producto_id, que es obligatorio) -- una orden puede no usar ningún
// repuesto estructurado (solo mano de obra), o usar uno "principal" cuyo
// stock se descuenta igual que en Ventas. costo_repuestos queda siempre
// editable a mano para cubrir órdenes con más de un repuesto sin necesitar
// un carrito de líneas (esa infraestructura no existe hoy en ningún
// módulo). mano_obra siempre manual. total siempre calculado acá, nunca
// confiado del cliente.
//
// cliente_id, vehiculo_id y repuesto_id son INMUTABLES después de creada la
// orden -- igual que ventas.js no deja cambiar producto_id/cliente_id en un
// PUT. Corregir una elección equivocada es borrar y volver a crear la orden.
//
// No genera un ingreso automático en Finanzas (a diferencia de ventas.js):
// cuándo una orden "cuenta como ingreso real" depende de su estado, y esa
// es una decisión de negocio que se deja fuera de esta fase -- un
// movimiento manual en Finanzas cubre el caso mientras tanto.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { registrarAuditoria } from '../auditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const TIPOS_VALIDOS = ['mantenimiento', 'garantia', 'reparacion', 'revision'];
const ESTADOS_VALIDOS = ['pendiente', 'en_proceso', 'completado'];

router.get('/', verificarPermiso('postventa.ver'), async (req, res) => {
  const { desde, hasta } = req.query;
  const valores = [req.usuario.empresa_id];
  const condiciones = [`empresa_id = $1`];
  if (desde) { valores.push(desde); condiciones.push(`fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`fecha <= $${valores.length}`); }
  const where = `WHERE ${condiciones.join(' AND ')}`;
  try {
    const { rows } = await pool.query(`SELECT * FROM postventa ${where} ORDER BY fecha DESC, id DESC LIMIT 5000`, valores);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudieron leer las órdenes de servicio.' });
  }
});

router.post('/', verificarPermiso('postventa.crear'), async (req, res) => {
  const { fecha, cliente_id, vehiculo_id, tipo, kilometraje, descripcion, repuesto_id, cantidad_repuesto, costo_repuestos, mano_obra, estado, proximo_servicio, garantia_hasta, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un cliente.' });
  if (!vehiculo_id) return res.status(400).json({ error: 'Selecciona un vehículo.' });
  if (!TIPOS_VALIDOS.includes(tipo)) return res.status(400).json({ error: `tipo debe ser uno de: ${TIPOS_VALIDOS.join(', ')}` });
  if (!descripcion) return res.status(400).json({ error: 'Describe el trabajo realizado.' });

  const cantRepuesto = cantidad_repuesto !== undefined && cantidad_repuesto !== '' ? numeroOCero(cantidad_repuesto) : 1;
  if (repuesto_id && cantRepuesto <= 0) return res.status(400).json({ error: 'La cantidad de repuesto debe ser mayor a 0.' });
  // costo_repuestos/mano_obra son siempre manuales (ver nota de arriba) -- sin
  // este candado, un monto negativo produce un total negativo guardado tal
  // cual, sin ningún error.
  if (costo_repuestos !== undefined && costo_repuestos !== '' && numeroOCero(costo_repuestos) < 0) {
    return res.status(400).json({ error: 'El costo de repuestos no puede ser negativo.' });
  }
  if (mano_obra !== undefined && mano_obra !== '' && numeroOCero(mano_obra) < 0) {
    return res.status(400).json({ error: 'La mano de obra no puede ser negativa.' });
  }
  const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : 'pendiente';

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');

    const { rows: cliRows } = await cliente.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El cliente seleccionado no existe.' }); }

    const { rows: vehRows } = await cliente.query(`SELECT placa, marca, modelo, anio FROM vehiculos WHERE id=$1 AND empresa_id=$2`, [vehiculo_id, empresaId]);
    if (!vehRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El vehículo seleccionado no existe.' }); }
    const veh = vehRows[0];
    const vehiculoDescripcion = `${veh.marca} ${veh.modelo}${veh.anio ? ' ' + veh.anio : ''} · ${veh.placa}`;

    let repuestoNombre = null;
    const costoRepuestosFinal = numeroOCero(costo_repuestos);
    if (repuesto_id) {
      // FOR UPDATE: bloquea la fila del repuesto hasta el COMMIT/ROLLBACK,
      // mismo motivo que ventas.js con inventario -- evitar que dos órdenes
      // simultáneas lean el mismo stock "viejo" a la vez.
      const { rows: repRows } = await cliente.query(`SELECT nombre, stock FROM repuestos WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [repuesto_id, empresaId]);
      if (!repRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El repuesto seleccionado no existe.' }); }
      const rep = repRows[0];
      if (Number(rep.stock) < cantRepuesto) {
        await cliente.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuficiente: quedan ${rep.stock} unidad(es) de "${rep.nombre}" y se pidieron ${cantRepuesto}.`,
          stockDisponible: Number(rep.stock)
        });
      }
      repuestoNombre = rep.nombre;
    }

    const total = +(costoRepuestosFinal + numeroOCero(mano_obra)).toFixed(2);

    const { rows: ordenRows } = await cliente.query(
      `INSERT INTO postventa (fecha, cliente_id, cliente_nombre, vehiculo_id, vehiculo_descripcion, tipo, kilometraje, descripcion,
         repuesto_id, repuesto_nombre, cantidad_repuesto, costo_repuestos, mano_obra, total, estado, proximo_servicio, garantia_hasta, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, vehiculo_id, vehiculoDescripcion, tipo,
       kilometraje !== undefined && kilometraje !== '' ? numeroOCero(kilometraje) : null,
       descripcion, repuesto_id || null, repuestoNombre, repuesto_id ? cantRepuesto : 1,
       costoRepuestosFinal, numeroOCero(mano_obra), total, estadoFinal,
       proximo_servicio || null, garantia_hasta || null, notas || null, empresaId]
    );
    const orden = ordenRows[0];

    if (repuesto_id) {
      await cliente.query(`UPDATE repuestos SET stock = stock - $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`, [cantRepuesto, repuesto_id, empresaId]);
    }

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'crear', modulo: 'postventa', registroId: orden.id, detalle: orden });
    await cliente.query('COMMIT');
    res.status(201).json(orden);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la orden de servicio.' });
  } finally {
    cliente.release();
  }
});

// No acepta cliente_id/vehiculo_id/repuesto_id -- inmutables (ver nota de
// arriba). Si cambia cantidad_repuesto y la orden tiene repuesto_id, ajusta
// el stock por la diferencia (mismo patrón que ventas.js).
router.put('/:id', verificarPermiso('postventa.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, tipo, kilometraje, descripcion, cantidad_repuesto, costo_repuestos, mano_obra, estado, proximo_servicio, garantia_hasta, notas } = req.body;

  // Mismos candados que el POST -- faltaban acá. Sin el de cantidad_repuesto,
  // un valor negativo hace que "stock - diferencia" aumente el stock gratis
  // (mismo bug que ventas.js PUT); sin los de costo/mano de obra, el total
  // guardado puede quedar negativo.
  if (cantidad_repuesto !== undefined && cantidad_repuesto !== '' && numeroOCero(cantidad_repuesto) <= 0) {
    return res.status(400).json({ error: 'La cantidad de repuesto debe ser mayor a 0.' });
  }
  if (costo_repuestos !== undefined && costo_repuestos !== '' && numeroOCero(costo_repuestos) < 0) {
    return res.status(400).json({ error: 'El costo de repuestos no puede ser negativo.' });
  }
  if (mano_obra !== undefined && mano_obra !== '' && numeroOCero(mano_obra) < 0) {
    return res.status(400).json({ error: 'La mano de obra no puede ser negativa.' });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows: ordenRows } = await cliente.query(`SELECT * FROM postventa WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!ordenRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const orden = ordenRows[0];

    let cantidadFinal = Number(orden.cantidad_repuesto);
    if (orden.repuesto_id && cantidad_repuesto !== undefined && cantidad_repuesto !== '') {
      const nuevaCant = numeroOCero(cantidad_repuesto);
      if (nuevaCant !== Number(orden.cantidad_repuesto)) {
        const diferencia = nuevaCant - Number(orden.cantidad_repuesto); // positivo = usa mas, negativo = devuelve
        const { rows: repRows } = await cliente.query(`SELECT stock FROM repuestos WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [orden.repuesto_id, empresaId]);
        if (!repRows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'El repuesto de esta orden ya no existe.' }); }
        if (diferencia > 0 && Number(repRows[0].stock) < diferencia) {
          await cliente.query('ROLLBACK');
          return res.status(409).json({ error: `Stock insuficiente para aumentar la cantidad: solo quedan ${repRows[0].stock} unidad(es) mas.` });
        }
        await cliente.query(`UPDATE repuestos SET stock = stock - $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`, [diferencia, orden.repuesto_id, empresaId]);
        cantidadFinal = nuevaCant;
      }
    }

    const costoFinal = costo_repuestos !== undefined && costo_repuestos !== '' ? numeroOCero(costo_repuestos) : Number(orden.costo_repuestos);
    const manoObraFinal = mano_obra !== undefined && mano_obra !== '' ? numeroOCero(mano_obra) : Number(orden.mano_obra);
    const total = +(costoFinal + manoObraFinal).toFixed(2);
    const estadoFinal = ESTADOS_VALIDOS.includes(estado) ? estado : orden.estado;
    const tipoFinal = TIPOS_VALIDOS.includes(tipo) ? tipo : orden.tipo;

    const { rows: actualizada } = await cliente.query(
      `UPDATE postventa SET
         fecha = COALESCE($1, fecha), tipo = $2,
         kilometraje = COALESCE($3, kilometraje), descripcion = COALESCE($4, descripcion),
         cantidad_repuesto = $5, costo_repuestos = $6, mano_obra = $7, total = $8, estado = $9,
         proximo_servicio = COALESCE($10, proximo_servicio), garantia_hasta = COALESCE($11, garantia_hasta),
         notas = COALESCE($12, notas), actualizado_el = now()
       WHERE id = $13 AND empresa_id = $14 RETURNING *`,
      [fecha || null, tipoFinal, kilometraje !== undefined && kilometraje !== '' ? numeroOCero(kilometraje) : null,
       descripcion || null, cantidadFinal, costoFinal, manoObraFinal, total, estadoFinal,
       proximo_servicio || null, garantia_hasta || null, notas !== undefined ? notas : null,
       req.params.id, empresaId]
    );

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'editar', modulo: 'postventa', registroId: req.params.id, detalle: { antes: orden, despues: actualizada[0] } });
    await cliente.query('COMMIT');
    res.json(actualizada[0]);
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la orden de servicio.' });
  } finally {
    cliente.release();
  }
});

router.delete('/:id', verificarPermiso('postventa.eliminar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(`SELECT * FROM postventa WHERE id=$1 AND empresa_id=$2 FOR UPDATE`, [req.params.id, empresaId]);
    if (!rows.length) { await cliente.query('ROLLBACK'); return res.status(404).json({ error: 'Orden no encontrada.' }); }
    const orden = rows[0];

    if (orden.repuesto_id) {
      await cliente.query(`UPDATE repuestos SET stock = stock + $1, actualizado_el = now() WHERE id = $2 AND empresa_id = $3`, [orden.cantidad_repuesto, orden.repuesto_id, empresaId]);
    }
    await cliente.query(`DELETE FROM postventa WHERE id = $1 AND empresa_id = $2`, [orden.id, empresaId]);

    await registrarAuditoria(cliente, { usuario: req.usuario, accion: 'eliminar', modulo: 'postventa', registroId: orden.id, detalle: { eliminado: orden } });
    await cliente.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await cliente.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'No se pudo anular la orden de servicio.' });
  } finally {
    cliente.release();
  }
});

export default router;
