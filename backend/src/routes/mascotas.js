// src/routes/mascotas.js
// Mascotas de CLIENTES (vertical Veterinaria) -- mismo rol que
// vehiculos.js en Automotriz: el registro base del que cuelgan las demás
// piezas del vertical (atenciones, planes, seguros).
//
// POST y PUT son manuales porque necesitan resolver cliente_nombre (la
// "foto" del nombre del dueño -- crudFactory no hace JOIN en su SELECT
// genérico, ver 024_veterinaria.sql). GET, DELETE y POST /import no tienen
// ese problema, se quedan en el CRUD genérico.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa, requireModulo } from '../middleware/auth.js';
import { verificarPermiso } from '../middleware/permisos.js';
import { crearRouterCRUD } from '../crudFactory.js';
import { registrarAuditoria } from '../registroAuditoria.js';

const router = Router();
router.use(auth, requireEmpresa, requireModulo('mascotas'));

const SEXOS_VALIDOS = ['macho', 'hembra'];

function numeroOCero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

router.post('/', verificarPermiso('mascotas.crear'), async (req, res) => {
  const { cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, notas } = req.body;
  if (!cliente_id || !nombre || !especie) {
    return res.status(400).json({ error: 'cliente_id, nombre y especie son requeridos.' });
  }
  if (sexo && !SEXOS_VALIDOS.includes(sexo)) return res.status(400).json({ error: 'sexo debe ser "macho" o "hembra".' });
  if (peso_kg !== undefined && peso_kg !== '' && numeroOCero(peso_kg) < 0) return res.status(400).json({ error: 'El peso no puede ser negativo.' });
  const empresaId = req.usuario.empresa_id;

  try {
    const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
    if (!cliRows.length) return res.status(404).json({ error: 'El cliente seleccionado no existe.' });

    const { rows } = await pool.query(
      `INSERT INTO mascotas (cliente_id, cliente_nombre, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, notas, empresa_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [cliente_id, cliRows[0].nombre, String(nombre).trim(), String(especie).trim(), raza || null,
       sexo || null, fecha_nacimiento || null, peso_kg !== undefined && peso_kg !== '' ? numeroOCero(peso_kg) : null, notas || null, empresaId]
    );
    res.status(201).json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'crear', modulo: 'mascotas', registroId: rows[0].id, detalle: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo registrar la mascota.' });
  }
});

// cliente_id SÍ se puede cambiar (una mascota puede pasar a otro dueño,
// ej. adopción) -- mismo criterio que vehiculos.js.
router.put('/:id', verificarPermiso('mascotas.editar'), async (req, res) => {
  const empresaId = req.usuario.empresa_id;
  const { cliente_id, nombre, especie, raza, sexo, fecha_nacimiento, peso_kg, notas } = req.body;
  if (sexo && !SEXOS_VALIDOS.includes(sexo)) return res.status(400).json({ error: 'sexo debe ser "macho" o "hembra".' });
  if (peso_kg !== undefined && peso_kg !== '' && numeroOCero(peso_kg) < 0) return res.status(400).json({ error: 'El peso no puede ser negativo.' });

  try {
    const { rows: antesRows } = await pool.query(`SELECT * FROM mascotas WHERE id=$1 AND empresa_id=$2`, [req.params.id, empresaId]);
    if (!antesRows.length) return res.status(404).json({ error: 'Mascota no encontrada.' });
    const antes = antesRows[0];

    let clienteId = antes.cliente_id, clienteNombre = antes.cliente_nombre;
    if (cliente_id !== undefined && cliente_id !== '' && Number(cliente_id) !== antes.cliente_id) {
      const { rows: cliRows } = await pool.query(`SELECT nombre FROM clientes WHERE id=$1 AND empresa_id=$2`, [cliente_id, empresaId]);
      if (!cliRows.length) return res.status(404).json({ error: 'El cliente seleccionado no existe.' });
      clienteId = cliente_id; clienteNombre = cliRows[0].nombre;
    }

    const { rows } = await pool.query(
      `UPDATE mascotas SET
         cliente_id = $1, cliente_nombre = $2, nombre = COALESCE($3, nombre), especie = COALESCE($4, especie),
         raza = $5, sexo = $6, fecha_nacimiento = $7, peso_kg = $8, notas = $9, actualizado_el = now()
       WHERE id=$10 AND empresa_id=$11 RETURNING *`,
      [clienteId, clienteNombre, nombre || null, especie || null,
       raza !== undefined ? raza : antes.raza, sexo !== undefined ? sexo : antes.sexo,
       fecha_nacimiento !== undefined ? fecha_nacimiento : antes.fecha_nacimiento,
       peso_kg !== undefined && peso_kg !== '' ? numeroOCero(peso_kg) : antes.peso_kg,
       notas !== undefined ? notas : antes.notas, req.params.id, empresaId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Mascota no encontrada.' });
    res.json(rows[0]);
    registrarAuditoria(pool, { usuario: req.usuario, accion: 'editar', modulo: 'mascotas', registroId: req.params.id, detalle: { antes, despues: rows[0] } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo actualizar la mascota.' });
  }
});

router.use(crearRouterCRUD({
  tabla: 'mascotas',
  modulo: 'mascotas',
  columnas: ['cliente_id', 'cliente_nombre', 'nombre', 'especie', 'raza', 'sexo', 'fecha_nacimiento', 'peso_kg', 'notas'],
  camposRequeridos: ['cliente_id', 'cliente_nombre', 'nombre', 'especie'],
  camposNumericos: ['cliente_id', 'peso_kg'],
  columnaFecha: 'creado_el',
  valoresPorDefecto: {}
}));

export default router;
