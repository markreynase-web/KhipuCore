-- Fase C: primer vertical de industria (concesionaria de vehículos).
-- Tres módulos nuevos: Vehículos (autos de CLIENTES para dar seguimiento en
-- postventa, no el inventario de venta propio de la concesionaria -- eso
-- seguiría usando el módulo genérico Inventario si algún día hace falta),
-- Repuestos (catálogo especializado, hermano de Inventario pero en su
-- propia tabla) y Postventa (órdenes de servicio: repuesto principal +
-- mano de obra = total).
--
-- Todas nacen con empresa_id NOT NULL desde el inicio -- son tablas nuevas,
-- no hay backfill que hacer (a diferencia de 012_empresas.sql).
--
-- Orden de creación importa: postventa referencia a vehiculos y repuestos.

CREATE TABLE IF NOT EXISTS vehiculos (
  id                  SERIAL PRIMARY KEY,
  empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
  fecha_registro      DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id          INTEGER NOT NULL REFERENCES clientes(id),
  -- "Foto" del nombre del cliente al momento de guardar -- igual que
  -- ventas.cliente/ventas.producto (ver 008): el SELECT genérico de
  -- crudFactory no hace JOIN, así que sin esto no hay forma de mostrar el
  -- dueño en la tabla sin una consulta aparte.
  cliente_nombre      VARCHAR(200) NOT NULL,
  placa               VARCHAR(20)  NOT NULL,
  marca               VARCHAR(80)  NOT NULL,
  modelo              VARCHAR(80)  NOT NULL,
  anio                INTEGER,
  vin                 VARCHAR(40),
  color               VARCHAR(40),
  kilometraje_actual  NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas               TEXT,
  creado_el           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repuestos (
  id                       SERIAL PRIMARY KEY,
  empresa_id               INTEGER NOT NULL REFERENCES empresas(id),
  fecha_registro           DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre                   VARCHAR(200) NOT NULL,
  codigo_oem               VARCHAR(80),
  compatibilidad           TEXT,
  ubicacion                VARCHAR(120),
  proveedor                VARCHAR(150),
  tiempo_reposicion_dias   INTEGER,
  equivalencias            TEXT,
  stock                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_minimo             NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_unitario           NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_unitario          NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas                    TEXT,
  creado_el                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS postventa (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id            INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre        VARCHAR(200) NOT NULL,
  vehiculo_id           INTEGER NOT NULL REFERENCES vehiculos(id),
  vehiculo_descripcion  VARCHAR(250) NOT NULL,
  tipo                  VARCHAR(20) NOT NULL CHECK (tipo IN ('mantenimiento','garantia','reparacion','revision')),
  kilometraje           NUMERIC(12,2),
  descripcion           TEXT NOT NULL,
  -- Repuesto PRINCIPAL, opcional -- no es un carrito de líneas múltiples
  -- (esa infraestructura no existe hoy en ningún módulo). Si se elige,
  -- descuenta stock igual que ventas.producto_id descuenta inventario.
  -- costo_repuestos queda siempre editable a mano para cubrir órdenes con
  -- varios repuestos sin necesitar más de uno estructurado.
  repuesto_id           INTEGER REFERENCES repuestos(id),
  repuesto_nombre       VARCHAR(200),
  cantidad_repuesto     NUMERIC(12,2) NOT NULL DEFAULT 1,
  costo_repuestos       NUMERIC(12,2) NOT NULL DEFAULT 0,
  mano_obra             NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_proceso','completado')),
  proximo_servicio      DATE,
  garantia_hasta        DATE,
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa   ON vehiculos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente   ON vehiculos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_fecha     ON vehiculos (fecha_registro);
CREATE INDEX IF NOT EXISTS idx_vehiculos_placa     ON vehiculos (placa);

CREATE INDEX IF NOT EXISTS idx_repuestos_empresa   ON repuestos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_repuestos_fecha     ON repuestos (fecha_registro);
CREATE INDEX IF NOT EXISTS idx_repuestos_codigo    ON repuestos (codigo_oem);

CREATE INDEX IF NOT EXISTS idx_postventa_empresa   ON postventa (empresa_id);
CREATE INDEX IF NOT EXISTS idx_postventa_fecha     ON postventa (fecha);
CREATE INDEX IF NOT EXISTS idx_postventa_cliente   ON postventa (cliente_id);
CREATE INDEX IF NOT EXISTS idx_postventa_vehiculo  ON postventa (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_postventa_repuesto  ON postventa (repuesto_id);
CREATE INDEX IF NOT EXISTS idx_postventa_estado    ON postventa (estado);

-- Mismo candado que 007/008/012: bloquea PostgREST directo
-- (anon/authenticated); el backend Express usa un rol con BYPASSRLS.
ALTER TABLE vehiculos ENABLE ROW LEVEL SECURITY;  ALTER TABLE vehiculos FORCE ROW LEVEL SECURITY;
ALTER TABLE repuestos ENABLE ROW LEVEL SECURITY;  ALTER TABLE repuestos FORCE ROW LEVEL SECURITY;
ALTER TABLE postventa ENABLE ROW LEVEL SECURITY;  ALTER TABLE postventa FORCE ROW LEVEL SECURITY;

-- Permisos, siguiendo el patrón exacto de 008_ventas_inventario_clientes_finanzas.sql.
INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('vehiculos'), ('repuestos'), ('postventa')) AS m(modulo)
CROSS JOIN (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  -- Administrador: todo, igual que en 005/008.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos
  WHERE nombre LIKE 'vehiculos.%' OR nombre LIKE 'repuestos.%' OR nombre LIKE 'postventa.%'
  ON CONFLICT DO NOTHING;

  -- Gerente: ver/crear/editar (mismo criterio que el resto de sus permisos), sin eliminar.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'vehiculos.ver','vehiculos.crear','vehiculos.editar',
    'repuestos.ver','repuestos.crear','repuestos.editar',
    'postventa.ver','postventa.crear','postventa.editar'
  )
  ON CONFLICT DO NOTHING;

  -- Supervisor: solo ver, en todo (mismo criterio que 005/008).
  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('vehiculos.ver','repuestos.ver','postventa.ver')
    ON CONFLICT DO NOTHING;
  END IF;

  -- A diferencia de 008 (que le dio inventario.ver al rol "ventas" porque
  -- el formulario de Ventas depende de leerlo), ningún rol existente
  -- ("ventas","inventario") corresponde naturalmente a "opera el
  -- taller/postventa" -- no se les toca. Un rol dedicado (ej. "taller")
  -- queda fuera de esta migración si el negocio lo pide más adelante.
END $$;

-- Catálogo de módulos (Fase A). base_de_datos=true: los tres usan captura +
-- Vista Ejecutiva igual que ventas/inventario/clientes/finanzas.
INSERT INTO modulos (id, label, icon, page, base_de_datos) VALUES
  ('vehiculos', 'Vehículos', '🚗', 'vehiculos.html', true),
  ('repuestos', 'Repuestos', '🔧', 'repuestos.html', true),
  ('postventa', 'Postventa', '🛠️', 'postventa.html', true)
ON CONFLICT (id) DO NOTHING;

-- A propósito NO se inserta en empresa_modulos para ninguna empresa
-- existente -- este vertical es opt-in por empresa. Para habilitarlo en una
-- empresa concreta (reemplaza el id):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'vehiculos'), (N, 'repuestos'), (N, 'postventa')
--   ON CONFLICT DO NOTHING;
-- Recomendado habilitar vehiculos + postventa juntos: postventa sin
-- vehiculos deja su selector de "Vehículo" vacío (no rompe nada, pero es
-- una mala experiencia).
