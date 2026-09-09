-- Sub-fase B (Sucursal + Caja/Turno): permisos para el nuevo router
-- src/routes/sucursales.js. NO pasa por empresa_modulos/requireModulo --
-- ver la nota al inicio de ese archivo sobre por qué es transversal, no un
-- módulo vendible -- así que lo único que falta para destrabarlo por rol es
-- esto: agregar 'sucursales.ver/crear/editar/eliminar' al catálogo de
-- permisos y asignarlos, mismo patrón que 022_compras_rrhh_produccion.sql.

INSERT INTO permisos (nombre) VALUES
  ('sucursales.ver'), ('sucursales.crear'), ('sucursales.editar'), ('sucursales.eliminar')
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
  r_inventario INTEGER := (SELECT id FROM roles WHERE nombre = 'inventario');
  r_ventas     INTEGER := (SELECT id FROM roles WHERE nombre = 'ventas');
BEGIN
  -- Administrador: control total (crear/editar/eliminar sucursales).
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos WHERE nombre LIKE 'sucursales.%'
  ON CONFLICT DO NOTHING;

  -- Gerente: ver/crear/editar, sin eliminar (mismo criterio que el resto
  -- de módulos para este rol, ver 005_roles_permisos.sql).
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN ('sucursales.ver', 'sucursales.crear', 'sucursales.editar')
  ON CONFLICT DO NOTHING;

  -- Supervisor, Inventario y Ventas: solo ver -- necesitan poder listar
  -- sucursales para elegir una (ej. al crear un producto o, más adelante en
  -- la Sub-fase C, una venta), pero no administrarlas.
  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos WHERE nombre = 'sucursales.ver'
    ON CONFLICT DO NOTHING;
  END IF;
  IF r_inventario IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_inventario, id FROM permisos WHERE nombre = 'sucursales.ver'
    ON CONFLICT DO NOTHING;
  END IF;
  IF r_ventas IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_ventas, id FROM permisos WHERE nombre = 'sucursales.ver'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
