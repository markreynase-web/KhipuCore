-- Fase D: Khipu AI -- agente de IA (Claude) con herramientas de datos
-- (backend/src/khipuAiTools.js), expuesto como widget flotante en toda la
-- app (no una página de módulo propia).
--
-- Se modela como una fila más del catálogo "modulos" a propósito: así el
-- panel de super administrador (pages/superadmin.html, ya genérico) puede
-- habilitar/deshabilitar Khipu AI por empresa sin código nuevo ahí. "page"
-- queda con un valor no-nulo por la constraint de la tabla pero no se usa
-- para navegación -- el widget no aparece en el sidebar (ver
-- components/khipuAiWidget.js). base_de_datos=false porque no tiene
-- captura ni Vista Ejecutiva como ventas/inventario/etc.

INSERT INTO permisos (nombre) VALUES ('khipu_ai.ver')
ON CONFLICT (nombre) DO NOTHING;

-- Mismo criterio que finanzas.ver (008): datos agregados de negocio, para
-- roles de gestión -- no para roles operativos como "ventas"/"inventario".
DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos WHERE nombre = 'khipu_ai.ver'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos WHERE nombre = 'khipu_ai.ver'
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos WHERE nombre = 'khipu_ai.ver'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

INSERT INTO modulos (id, label, icon, page, base_de_datos) VALUES
  ('khipu_ai', 'Khipu AI', '🤖', 'khipu-ai.html', false)
ON CONFLICT (id) DO NOTHING;

-- A propósito NO se inserta en empresa_modulos para ninguna empresa --
-- opt-in por empresa, mismo criterio que Fase C. Para habilitarlo en una
-- empresa concreta (reemplaza el id), o hazlo desde el panel de super
-- administrador:
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES (N, 'khipu_ai')
--   ON CONFLICT DO NOTHING;
