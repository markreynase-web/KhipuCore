// src/routes/recetasOpticas.js
// Historial clínico + receta óptica (vertical Oculista). POST/PUT manuales
// por el snapshot de cliente_nombre (mismo motivo que el resto de la app).
//
// A diferencia de "costo" en otros módulos, esfera/cilindro SÍ pueden ser
// negativos (miopía = negativo, hipermetropía = positivo) -- no se valida
// que sean "no negativos", solo que el eje esté en 0-180° (rango real de
// un eje de astigmatismo) y que adición/distancia pupilar no sean negativas.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa);

function numeroOVacio(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validarCampos({ eje_od, eje_oi, adicion, distancia_pupilar }) {
  for (const [nombre, v] of [['eje_od', eje_od], ['eje_oi', eje_oi]]) {
    const n = numeroOVacio(v);
    if (n !== null && (n < 0 || n > 180)) return `${nombre} debe estar entre 0 y 180 grados.`;
  }
  const ad = numeroOVacio(adicion);
  if (ad !== null && ad < 0) return 'La adición no puede ser negativa.';
  const dp = numeroOVacio(distancia_pupilar);
  if (dp !== null && dp < 0) return 'La distancia pupilar no puede ser negativa.';
  return null;
}

router.post('/', verificarPermiso('recetas_opticas.crear'), async (req, res) => {
  const { fecha, cliente_id, esfera_od, cilindro_od, eje_od, esfera_oi, cilindro_oi, eje_oi, adicion, distancia_pupilar, diagnostico, notas } = req.body;
  const empresaId = req.usuario.empresa_id;

  if (!fecha) return res.status(400).json({ error: 'fecha es requerido' });
  if (!cliente_id) return res.status(400).json({ error: 'Selecciona un paciente.' });
  const errorValidacion = validarCampos(req.body);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  try {
    const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO recetas_opticas (fecha, cliente_id, cliente_nombre, esfera_od, cilindro_od, eje_od, esfera_oi, cilindro_oi, eje_oi, adicion, distancia_pupilar, diagnostico, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [fecha, cliente_id, cliRows[0].nombre, numeroOVacio(esfera_od), numeroOVacio(cilindro_od), numeroOVacio(eje_od),
       numeroOVacio(esfera_oi), numeroOVacio(cilindro_oi), numeroOVacio(eje_oi), numeroOVacio(adicion), numeroOVacio(distancia_pupilar),
       diagnostico || null, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'recetas_opticas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la receta.' });
  }
});

router.put('/:id', verificarPermiso('recetas_opticas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { fecha, cliente_id, esfera_od, cilindro_od, eje_od, esfera_oi, cilindro_oi, eje_oi, adicion, distancia_pupilar, diagnostico, notas } = req.body;
  const errorValidacion = validarCampos(req.body);
  if (errorValidacion) return res.status(400).json({ error: errorValidacion });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM recetas_opticas WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Receta no encontrada.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El paciente seleccionado no existe.' });
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    const campo = (v, actual) => v !== undefined ? numeroOVacio(v) : actual;
    const { rows } = await pool.query(
      `UPDATE recetas_opticas SET
         fecha = COALESCE($1, fecha), cliente_id = $2, cliente_nombre = $3,
         esfera_od = $4, cilindro_od = $5, eje_od = $6, esfera_oi = $7, cilindro_oi = $8, eje_oi = $9,
         adicion = $10, distancia_pupilar = $11, diagnostico = $12, notas = $13, actualizado_el = now()
       WHERE id=$14 AND empresa_id=$15 RETURNING *`,
      [fecha || null, clienteId, clienteNombre,
       campo(esfera_od, antes.esfera_od), campo(cilindro_od, antes.cilindro_od), campo(eje_od, antes.eje_od),
       campo(esfera_oi, antes.esfera_oi), campo(cilindro_oi, antes.cilindro_oi), campo(eje_oi, antes.eje_oi),
       campo(adicion, antes.adicion), campo(distancia_pupilar, antes.distancia_pupilar),
       diagnostico !== undefined ? diagnostico : antes.diagnostico, notas !== undefined ? notas : antes.notas,
       req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Receta no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'recetas_opticas', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la receta.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'recetas_opticas',
  modulo: 'recetas_opticas',
  columnas: ['fecha', 'cliente_id', 'cliente_nombre', 'esfera_od', 'cilindro_od', 'eje_od', 'esfera_oi', 'cilindro_oi', 'eje_oi', 'adicion', 'distancia_pupilar', 'diagnostico', 'notas'],
  camposRequeridos: ['fecha', 'cliente_id', 'cliente_nombre'],
  camposNumericos: ['cliente_id', 'esfera_od', 'cilindro_od', 'eje_od', 'esfera_oi', 'cilindro_oi', 'eje_oi', 'adicion', 'distancia_pupilar'],
  columnaFecha: 'fecha'
}));

export default router;
