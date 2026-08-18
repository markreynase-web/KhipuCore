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
import { auth, requireEmpresa, requireModulo } from './middleware/auth.js';
import { verificarPermiso } from './middleware/permisos.js';
import { registrarAuditoria } from './registroAuditoria.js';

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
 * @param {string[]} [config.columnasBusqueda] - columnas de texto en las que ?buscar= hace ILIKE (ver GET / abajo). Opt-in: un módulo que no la declara mantiene el comportamiento de siempre.
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
    antesDeGuardar,
    columnasBusqueda = []
  } = config;

  if (!modulo) throw new Error(`crearRouterCRUD: falta "modulo" para la tabla ${tabla} (se necesita para permisos y auditoría).`);

  const router = Router();
  const permiso = (accion) => `${modulo}.${accion}`;

  // esEdicion:true (PUT) -- una columna AUSENTE del body (no enviada) no se
  // toca: se excluye de `datos` entera para que el UPDATE dinámico de abajo
  // ni siquiera la mencione. Antes, cualquier columna que no viniera en el
  // body (ej. porque tablaRegistros.js solo manda las columnas visibles en
  // columnasTabla) se trataba igual que "vacía" y se pisaba con null/0 --
  // cada edición inline borraba en silencio cualquier campo que no
  // estuviera en la tabla. En POST/import (esEdicion:false) el
  // comportamiento no cambia: todo columna ausente sigue tomando su valor
  // por defecto, porque ahí sí es una fila nueva completa.
  function limpiarYValidar(bodyCrudo, { esEdicion = false } = {}) {
    const datos = {};
    columnas.forEach(c => {
      let v = bodyCrudo[c];
      if (esEdicion && v === undefined) return; // no se tocó: se conserva el valor actual en la base
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
      // En edición, un campo requerido que ni siquiera vino en el body no
      // es un error -- significa que no se tocó, no que se vació a propósito.
      if (esEdicion && !Object.prototype.hasOwnProperty.call(datos, c)) return;
      if (datos[c] === null || datos[c] === undefined || datos[c] === '') errores.push(`${c} es requerido`);
    });
    camposNumericos.forEach(c => {
      if (typeof datos[c] === 'number' && datos[c] < 0) errores.push(`${c} no puede ser negativo`);
    });
    return { errores, datos };
  }

  // Todo lo de este router requiere sesión válida CON empresa resuelta Y esa
  // empresa con el módulo contratado; cada ruta abajo agrega, encima, el
  // permiso específico de esa acción.
  router.use(auth, requireEmpresa, requireModulo(modulo));

  // GET /?desde=AAAA-MM-DD&hasta=AAAA-MM-DD&buscar=texto&limite=20
  // ?buscar= solo tiene efecto si el módulo declaró columnasBusqueda -- si no
  // la declaró, el parámetro se ignora y el comportamiento es el de siempre
  // (pensado para el buscador-mientras-escribís de Ventas, ver componentes/
  // comboboxBusqueda.js, pero cualquier módulo puede sumarse solo agregando
  // columnasBusqueda a su config). unaccent() (migración 029) hace que
  // "costeno" encuentre "Costeño" -- ver esa migración para por qué existe
  // la extensión de Postgres.
  router.get('/', verificarPermiso(permiso('ver')), async (req, res) => {
    const { desde, hasta, buscar, limite } = req.query;
    // empresa_id SIEMPRE va primero y SIEMPRE está presente -- a diferencia
    // de desde/hasta, no es un filtro opcional: sin esto, cualquier empresa
    // vería los datos de todas las demás.
    const valores = [req.usuario.empresa_id];
    const condiciones = [`empresa_id = $1`];
    if (desde) { valores.push(desde); condiciones.push(`${columnaFecha} >= $${valores.length}`); }
    if (hasta) { valores.push(hasta); condiciones.push(`${columnaFecha} <= $${valores.length}`); }

    const termino = typeof buscar === 'string' ? buscar.trim() : '';
    if (termino && columnasBusqueda.length) {
      valores.push(`%${termino}%`);
      const posicion = valores.length;
      const porColumna = columnasBusqueda.map(c => `unaccent(${c}) ILIKE unaccent($${posicion})`);
      condiciones.push(`(${porColumna.join(' OR ')})`);
    }

    const where = `WHERE ${condiciones.join(' AND ')}`;
    // Sin ?buscar=, se mantiene el límite de siempre (5000, pensado para
    // cargar todo un módulo). Con ?buscar=, es un autocomplete: no tiene
    // sentido devolver más de un puñado de resultados, y ?limite= deja que
    // quien llama lo ajuste (con techo de 50 para no volverse, por error, un
    // "tráeme todo" disfrazado).
    const limiteFinal = termino && columnasBusqueda.length
      ? Math.min(Math.max(parseInt(limite, 10) || 20, 1), 50)
      : 5000;

    try {
      const { rows } = await pool.query(
        `SELECT * FROM ${tabla} ${where} ORDER BY ${columnaFecha} DESC, id DESC LIMIT ${limiteFinal}`,
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
    // Siempre server-side, nunca desde req.body -- por eso "empresa_id" no
    // debe agregarse jamás a la lista `columnas` de ningún módulo.
    datos.empresa_id = req.usuario.empresa_id;
    const cols = Object.keys(datos);
    try {
      const { rows } = await pool.query(
        `INSERT INTO ${tabla} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
        cols.map(c => datos[c])
      );
      res.status(201).json(rows[0]);
      registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo, registroId: rows[0].id, detalle: datos });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: `No se pudo guardar en ${tabla}.` });
    }
  });

  // PUT /:id
  router.put('/:id', verificarPermiso(permiso('editar')), async (req, res) => {
    const { errores, datos } = limpiarYValidar(req.body, { esEdicion: true });
    if (errores.length) return res.status(400).json({ error: errores.join(', ') });
    if (!Object.keys(datos).length) return res.status(400).json({ error: 'No se envió ningún campo para actualizar.' });
    const cols = Object.keys(datos);
    try {
      // Se lee el registro ANTES de pisarlo -- es la única forma de saber,
      // después, qué cambió de verdad (y no solo que "alguien editó algo").
      // Scoped por empresa_id: si el id existe pero es de otra empresa, se
      // responde 404 (no 403) para no confirmar que ese id existe en otro lado.
      const { rows: antesRows } = await pool.query(
        `SELECT * FROM ${tabla} WHERE id=$1 AND empresa_id=$2`,
        [req.params.id, req.usuario.empresa_id]
      );
      if (!antesRows.length) return res.status(404).json({ error: 'Registro no encontrado.' });
      const antes = antesRows[0];

      const { rows } = await pool.query(
        `UPDATE ${tabla} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')}, actualizado_el=now()
         WHERE id=$${cols.length + 1} AND empresa_id=$${cols.length + 2} RETURNING *`,
        [...cols.map(c => datos[c]), req.params.id, req.usuario.empresa_id]
      );
      if (!rows.length) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.json(rows[0]);

      const cambios = {};
      cols.forEach(c => {
        if (!sonIguales(antes[c], datos[c], camposNumericos.includes(c))) {
          cambios[c] = { antes: antes[c], despues: datos[c] };
        }
      });
      registrarAuditoria(pool, {
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
      const { rows: antesRows } = await pool.query(
        `SELECT * FROM ${tabla} WHERE id=$1 AND empresa_id=$2`,
        [req.params.id, req.usuario.empresa_id]
      );
      if (!antesRows.length) return res.status(404).json({ error: 'Registro no encontrado.' });

      const { rowCount } = await pool.query(
        `DELETE FROM ${tabla} WHERE id=$1 AND empresa_id=$2`,
        [req.params.id, req.usuario.empresa_id]
      );
      if (!rowCount) return res.status(404).json({ error: 'Registro no encontrado.' });
      res.status(204).end();
      registrarAuditoria(pool, { usuario: req.usuario, accion: 'eliminar', modulo, registroId: req.params.id, detalle: { eliminado: antesRows[0] } });
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
        datos.empresa_id = req.usuario.empresa_id;
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
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'importar', modulo, detalle: { insertadas, errores: erroresDetalle.length } });
  });

  return router;
}
