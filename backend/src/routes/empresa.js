// src/routes/empresa.js
// Fase A (multi-tenant): reemplaza a config/company.json. El frontend ya no
// pide un archivo estático para saber su branding/módulos habilitados --
// una vez logueado, lo pide aquí, scoped a la empresa activa del token.
//
// Endpoint nuevo en vez de inflar GET /auth/me: /me es deliberadamente
// barato (solo un eco del JWT, sin ir a la base de datos) y hoy nada del
// frontend lo llama; la branding sí necesita ir a la base cada vez (para
// que un cambio de módulos habilitados se vea sin esperar a que venza el
// token), así que tiene sentido como su propio recurso.

import { Router } from 'express';
import { pool } from '../db.js';
import { auth, requireEmpresa } from '../middleware/auth.js';

const router = Router();

router.get('/actual', auth, requireEmpresa, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.nombre AS "bizName", e.logo,
              COALESCE(json_agg(json_build_object(
                'id', m.id, 'label', m.label, 'icon', m.icon,
                'page', m.page, 'baseDeDatos', m.base_de_datos, 'enabled', true
              ) ORDER BY m.id) FILTER (WHERE m.id IS NOT NULL), '[]') AS modules
       FROM empresas e
       LEFT JOIN empresa_modulos em ON em.empresa_id = e.id
       LEFT JOIN modulos m ON m.id = em.modulo_id
       WHERE e.id = $1
       GROUP BY e.id`,
      [req.usuario.empresa_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Empresa no encontrada.' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'No se pudo leer la información de la empresa.' });
  }
});

export default router;
