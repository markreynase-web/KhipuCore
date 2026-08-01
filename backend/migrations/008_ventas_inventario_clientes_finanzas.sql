-- Conecta Ventas ↔ Inventario ↔ Clientes ↔ Finanzas (Fase 5).
--
-- Antes: "producto" y "cliente" en ventas eran texto libre, sin relación
-- real con las tablas inventario/clientes. Esto agrega las llaves foráneas
-- y la tabla de finanzas donde cada venta deja un movimiento automático.
--
-- Las columnas de texto (producto, cliente, categoria, precio_unitario) se
-- quedan: son la "foto" de esos datos al momento de la venta (si mañana
-- cambias el nombre o precio de un producto en Inventario, las ventas viejas
-- no deben cambiar de valor). producto_id/cliente_id son la relación real
-- que usa el backend para validar stock y jalar datos frescos al crear.

ALTER TABLE ventas
  ADD COLUMN IF NOT EXISTS producto_id INTEGER REFERENCES inventario(id),
  ADD COLUMN IF NOT EXISTS cliente_id  INTEGER REFERENCES clientes(id);

CREATE INDEX IF NOT EXISTS idx_ventas_producto_id ON ventas (producto_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id  ON ventas (cliente_id);

-- Tabla de Finanzas: cada fila es un movimiento (ingreso o egreso). Las
-- ventas insertan aquí automáticamente (origen_modulo='ventas'); el usuario
-- también puede registrar movimientos manuales (origen_modulo NULL) como
-- gastos, pagos a proveedores, etc.
CREATE TABLE IF NOT EXISTS finanzas (
  id               SERIAL PRIMARY KEY,
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo             VARCHAR(20) NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  categoria        VARCHAR(120),
  concepto         VARCHAR(250) NOT NULL,
  monto            NUMERIC(14,2) NOT NULL DEFAULT 0,
  origen_modulo    VARCHAR(60),   -- ej. 'ventas' si vino automático; NULL si es manual
  origen_id        INTEGER,       -- id del registro que lo generó (ej. id de la venta)
  notas            TEXT,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_finanzas_fecha ON finanzas (fecha);
CREATE INDEX IF NOT EXISTS idx_finanzas_origen ON finanzas (origen_modulo, origen_id);

-- Si la base es Supabase, 007_supabase_rls.sql ya cerró el acceso directo por
-- PostgREST a las tablas que existían hasta ese momento. "finanzas" es nueva,
-- así que necesita el mismo candado -- si no, queda expuesta con la anon key.
ALTER TABLE finanzas ENABLE ROW LEVEL SECURITY;
ALTER TABLE finanzas FORCE ROW LEVEL SECURITY;

-- Permisos del nuevo módulo, siguiendo el mismo patrón de 005_roles_permisos.sql.
INSERT INTO permisos (nombre)
SELECT 'finanzas.' || accion FROM (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_ventas     INTEGER := (SELECT id FROM roles WHERE nombre = 'ventas');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos WHERE nombre LIKE 'finanzas.%'
  ON CONFLICT DO NOTHING;

  -- Gerente: ver/crear/editar (mismo criterio que el resto de sus permisos), sin eliminar.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN ('finanzas.ver', 'finanzas.crear', 'finanzas.editar')
  ON CONFLICT DO NOTHING;

  -- Supervisor: "solo ver, en todo" (mismo criterio que 005) -- finanzas.ver
  -- no existía todavía cuando se armó esa regla, se agrega ahora.
  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos WHERE nombre = 'finanzas.ver'
    ON CONFLICT DO NOTHING;
  END IF;

  -- El formulario de "Nueva venta" ahora necesita leer el catálogo de
  -- inventario (para el selector de productos y el stock disponible). Sin
  -- esto, un usuario con rol "ventas" (que en 005_roles_permisos.sql solo
  -- tenía ventas.* + clientes.ver) vería el selector de productos vacío y no
  -- podría registrar ninguna venta.
  IF r_ventas IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_ventas, id FROM permisos WHERE nombre = 'inventario.ver'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
