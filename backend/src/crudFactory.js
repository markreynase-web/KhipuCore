// src/crudFactory.js
// CRUD reutilizable: en vez de escribir GET/POST/PUT/DELETE/import a mano por
// cada módulo (como se hizo primero con Ventas), cada módulo nuevo solo
// declara su tabla y sus columnas, y este archivo arma las 5 rutas.
//
// Los nombres de tabla/columnas SIEMPRE vienen de config confiable escrito por
// nosotros (src/routes/*.js), nunca del usuario final — por eso es seguro
// interpolarlos directo en el SQL. Los VALORES sí van siempre parametrizados
// ($1, $2, ...), nunca concatenados, para evitar inyección SQL de verdad.
//
// Fase 4 (Roles y Permisos) + Registro de actividad: cada módulo declara
// `modulo` (ej. 'ventas') y este archivo arma solo, para cada verbo, el
// pipeline completo: auth() → verificarPermiso('ventas.crear'/'ventas.ver'/...)
// → CRUD. Además, cada crear/editar/borrar/importar exitoso deja una fila en
// audit_log (quién, qué acción, en qué módulo, cuándo) sin que cada ruta
// tenga que acordarse de escribirla a mano.

import { Router } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import { pool } from './db.js';
import { auth } from './middleware/auth.js';
import { verificarPermiso } from './middleware/permisos.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ¿"antes" y "después" son en realidad el mismo valor? Node-postgres devuelve
// las columnas NUMERIC como string (ej. "12.50"), mientras que `datos` ya
// trae números de verdad (numeroOCero se aplicó en limpiarYValidar) -- una
// comparación con !== los vería como "distintos" aunque valgan lo mismo.
// Por eso los campos numéricos se comparan como número, y el resto como
// texto (tratando null/undefined como '').
function sonIguales(antes, despues, esNumerico) {
  if (esNumerico) return numeroOCero(antes) === numeroOCero(despues);
  return String(antes ?? '') === String(despues ?? '');
}

// Nunca debe tumbar la operación principal: si falla, se registra en consola
// pero el crear/editar/borrar ya se guardó y la respuesta al usuario sigue
// siendo exitosa. El audit log es un "además", no un requisito para guardar.
async function registrarAuditoria({ usuario, accion, modulo, registroId, detalle }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, modulo, registro_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [usuario?.id ?? null, usuario?.nombre ?? 'Desconocido', accion, modulo, registroId ? String(registroId) : null, detalle ? JSON.stringify(detalle) : null]
    );
  } catch (err) {
    console.error('No se pudo escribir en audit_log:', err.message);
  }
}

/**
 * @param {object} config
 * @param {string} config.tabla - nombre de la tabla en PostgreSQL
 * @param {string} config.modulo - nombre del módulo para permisos/auditoría (ej. 'ventas' -> 'ventas.ver', 'ventas.crear'...)
 * @param {string[]} config.columnas - todas las columnas editables (sin id/creado_el/actualizado_el)
 * @param {string[]} config.camposRequeridos - subconjunto de columnas obligatorias
 * @param {string[]} [config.camposNumericos] - subconjunto de columnas numéricas
 * @param {string} [config.columnaFecha] - columna usada para filtrar ?desde&hasta y para ORDER BY (default 'fecha')
 * @param {object} [config.valoresPorDefecto] - valor a usar si el campo llega vacío, ej. { cantidad: 1 }
 * @param {(datos:object)=>object} [config.antesDeGuardar] - calcula/ajusta campos derivados (ej. monto = cantidad*precio) antes de INSERT/UPDATE
 */
export function crearRouterCRUD(config) {
  const {
    tabla,
    modulo,
    columnas,
    camposRequeridos = [],
    camposNumericos = [],
    columnaFecha = 'fecha',
    valoresPorDefecto = {},
    antesDeGuardar
  } = config;

  if (!modulo) throw new Error(`crearRouterCRUD: falta "modulo" para la tabla ${tabla} (se necesita para permisos y auditoría).`);

  const router = Router();
  const permiso = (accion) => `${modulo}.${accion}`;

  function limpiarYValidar(bodyCrudo) {
    const datos = {};
    columnas.forEach(c => {
      let v = bodyCrudo[c];
      const vacio = v === undefined || v === null || v === '';
      if (vacio) {
        v = valoresPorDefecto[c] !== undefined ? valoresPorDefecto[c] : (camposNumericos.includes(c) ? 0 : null);
      } else if (camposNumericos.includes(c)) {
        v = numeroOCero(v);
      } else if (typeof v === 'string') {
        v = v.trim();
      }
      datos[c] = v;
    });

    if (antesDeGuardar) Object.assign(datos, antesDeGuardar(datos));

    const errores = [];
    camposRequeridos.forEach(c => {
      if (datos[c] === null || datos[c] === undefined || datos[c] === '') errores.push(`${c} es requerido`);
    });
    camposNumericos.forEach(c => {
      if (typeof datos[c] === 'number' && datos[c] < 0) errores.push(`${c} no puede ser negativo`);
    });
    return { errores, datos };
  }

  // Todo lo de este router requiere sesión válida; cada ruta abajo agrega,
  // encima, el permiso específico de esa acción.
  router.use(auth);

  // GET /?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
  router.get('/', verificarPermiso(permiso('ver')), async (req, res) => {
    const { desde, hasta } = req.query;
    const condiciones = [];
    const valores = [];
    if (desde) { valores.push(desde); condiciones.push(`${columnaFecha} >= $${valores.length}`); }
    if (hasta) { valores.push(hasta); condiciones.push(`${columnaFecha} <= $${valores.length}`); }
    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    try {
      const { rows } = await pool.query(
        `SELECT * FROM ${tabla} ${where} ORDER BY ${columnaFecha} DESC, id DESC LIMIT 5000`,
        valores
      );
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `No se pudieron leer los registros de ${tabla}.` });
    }
  });

  // POST /
  router.post('/', verificarPermiso(permiso('crear')), async (req, res) => {
    const { errores, datos } = limpiarYValidar(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join(', ') });
    const cols = Object.keys(datos);
    try {
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        cols.map(c => datos[c])
      );
      res.status(201).json(rows[0]);
      registrarAuditoria({ usuario: req.usuario, accion: 'crear', modulo, registroId: rows[0].id, detalle: datos });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `No se pudo guardar en ${tabla}.` });
    }
  });

  // PUT /:id
  router.put('/:id', verificarPermiso(permiso('editar')), async (req, res) => {
    const { errores, datos } = limpiarYValidar(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join(', ') });
    const cols = Object.keys(datos);
    try {
      // Se lee el registro ANTES de pisarlo -- es la única forma de saber,
      // después, qué cambió de verdad (y no solo que "alguien editó algo").
      const { rows: antesRows } = await pool.query(`SELECT * FROM ${tabla} WHERE id=$1`, [req.params.id]);
      if (!antesRows.length) return res.status(404).json({ error: 'Registro no encontrado.' });
      const antes = antesRows[0];

      const { rows } = await pool.query(
        `UPDATE ${tabla} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')}, actualizado_el=now()
         WHERE id=$${cols.length + 1} RETURNING *`,
        [...cols.map(c => datos[c]), req.params.id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.json(rows[0]);

      const cambios = {};
      cols.forEach(c => {
        if (!sonIguales(antes[c], datos[c], camposNumericos.includes(c))) {
          cambios[c] = { antes: antes[c], despues: datos[c] };
        }
      });
      registrarAuditoria({
        usuario: req.usuario, accion: 'editar', modulo, registroId: req.params.id,
        detalle: Object.keys(cambios).length ? cambios : 'Sin cambios en los valores (se guardó igual).'
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `No se pudo actualizar el registro de ${tabla}.` });
    }
  });

  // DELETE /:id
  router.delete('/:id', verificarPermiso(permiso('eliminar')), async (req, res) => {
    try {
      // Se guarda una "foto" completa del registro en el detalle de
      // auditoría -- una vez borrado, es la única forma de saber después
      // qué era exactamente lo que se eliminó (nombre, stock que tenía, etc).
      const { rows: antesRows } = await pool.query(`SELECT * FROM ${tabla} WHERE id=$1`, [req.params.id]);
      if (!antesRows.length) return res.status(404).json({ error: 'Registro no encontrado.' });

      const { rowCount } = await pool.query(`DELETE FROM ${tabla} WHERE id=$1`, [req.params.id]);
      if (!rowCount) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.status(204).end();
      registrarAuditoria({ usuario: req.usuario, accion: 'eliminar', modulo, registroId: req.params.id, detalle: { eliminado: antesRows[0] } });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `No se pudo borrar el registro de ${tabla}.` });
    }
  });

  // POST /import (multipart/form-data, campo "archivo")
  router.post('/import', verificarPermiso(permiso('crear')), upload.single('archivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Sube un archivo CSV en el campo "archivo".' });
    const texto = req.file.buffer.toString('utf8');
    const parsed = Papa.parse(texto, { header: true, skipEmptyLines: 'greedy' });
    const filas = parsed.data;
    if (!filas.length) return res.status(400).json({ error: 'El CSV no tiene filas con datos.' });

    let insertadas = 0;
    const erroresDetalle = [];
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      for (let i = 0; i < filas.length; i++) {
        const cruda = {};
        Object.keys(filas[i]).forEach(k => { cruda[k.trim().toLowerCase()] = filas[i][k]; });
        const { errores, datos } = limpiarYValidar(cruda);
        if (errores.length) { erroresDetalle.push(`Fila ${i + 2}: ${errores.join(', ')}`); continue; }
        const cols = Object.keys(datos);
        await cliente.query(
          `INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map((_, idx) => `$${idx + 1}`).join(',')})`,
          cols.map(c => datos[c])
        );
        insertadas++;
      }
      await cliente.query('COMMIT');
    } catch (err) {
      await cliente.query('ROLLBACK');
      console.error(err);
      return res.status(500).json({ error: 'Falló la importación; no se guardó ninguna fila (se revirtió todo).' });
    } finally {
      cliente.release();
    }

    res.json({ insertadas, errores: erroresDetalle.length, detalle: erroresDetalle.slice(0, 20) });
    registrarAuditoria({ usuario: req.usuario, accion: 'importar', modulo, detalle: { insertadas, errores: erroresDetalle.length } });
  });

  return router;
}
