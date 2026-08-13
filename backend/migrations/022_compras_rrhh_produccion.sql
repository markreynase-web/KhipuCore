-- Backend real para los 3 módulos que quedaban en modo CSV-import-only
-- (base_de_datos:false desde 012_empresas.sql): Compras, RRHH, Producción.
-- Mismo patrón que el resto de la app -- cada uno se conecta con Inventario
-- donde tiene sentido real (comprar y producir, ambos reponen stock),
-- nunca inventando el momento en que algo "cuenta como gasto real" en
-- Finanzas más allá de lo que ya está probado en inventario.js (mismo
-- criterio explicado ahí: el costo se postea SOLO cuando hay un monto real
-- que registrar, nunca a ciegas).

-- compras: una orden de compra a un proveedor, para UN producto existente
-- de Inventario (no una línea múltiple -- mismo criterio "sin carrito de
-- líneas" que el resto de la app). Recibir la compra (estado='recibido')
-- es lo que de verdad suma stock y deja un egreso en Finanzas -- pedirla no
-- mueve nada todavía, porque el stock físico no llegó.
CREATE TABLE IF NOT EXISTS compras (
  id               SERIAL PRIMARY KEY,
  empresa_id       INTEGER NOT NULL REFERENCES empresas(id),
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  proveedor        VARCHAR(150) NOT NULL,
  producto_id      INTEGER NOT NULL REFERENCES inventario(id),
  producto_nombre  VARCHAR(200) NOT NULL,
  cantidad         NUMERIC(12,2) NOT NULL DEFAULT 1,
  costo_unitario   NUMERIC(12,2) NOT NULL DEFAULT 0,
  total            NUMERIC(14,2) NOT NULL DEFAULT 0,
  estado           VARCHAR(20) NOT NULL DEFAULT 'pedido' CHECK (estado IN ('pedido','recibido','cancelado')),
  fecha_recibido   DATE,
  notas            TEXT,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- empleados: núcleo real de RRHH. Nómina/asistencia/vacaciones quedan
-- fuera de esta pasada a propósito -- son sistemas propios con reglas de
-- negocio (cálculo de planilla, políticas de licencia) que no se pueden
-- inventar del lado del código; esto es la ficha de empleado, la base para
-- construir cualquiera de esos después.
CREATE TABLE IF NOT EXISTS empleados (
  id                  SERIAL PRIMARY KEY,
  empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
  fecha_contratacion  DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre              VARCHAR(200) NOT NULL,
  puesto              VARCHAR(150),
  departamento        VARCHAR(100),
  salario             NUMERIC(12,2) NOT NULL DEFAULT 0,
  email               VARCHAR(200),
  telefono            VARCHAR(60),
  estado              VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo','vacaciones','licencia')),
  notas               TEXT,
  creado_el           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ordenes_produccion: fabricar UN producto existente de Inventario.
-- Completar la orden (estado='completada') es lo que suma
-- cantidad_producida al stock -- mismo criterio que "recibir" en compras.
CREATE TABLE IF NOT EXISTS ordenes_produccion (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha_inicio          DATE NOT NULL DEFAULT CURRENT_DATE,
  producto_id           INTEGER NOT NULL REFERENCES inventario(id),
  producto_nombre       VARCHAR(200) NOT NULL,
  cantidad_planificada  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cantidad_producida    NUMERIC(12,2) NOT NULL DEFAULT 0,
  fecha_fin_estimada    DATE,
  estado                VARCHAR(20) NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada','en_proceso','completada','cancelada')),
  costo_materiales      NUMERIC(12,2) NOT NULL DEFAULT 0,
  costo_mano_obra       NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compras_empresa    ON compras (empresa_id);
CREATE INDEX IF NOT EXISTS idx_compras_fecha       ON compras (fecha);
CREATE INDEX IF NOT EXISTS idx_compras_producto    ON compras (producto_id);
CREATE INDEX IF NOT EXISTS idx_compras_estado      ON compras (estado);

CREATE INDEX IF NOT EXISTS idx_empleados_empresa   ON empleados (empresa_id);
CREATE INDEX IF NOT EXISTS idx_empleados_estado    ON empleados (estado);

CREATE INDEX IF NOT EXISTS idx_ordenes_prod_empresa   ON ordenes_produccion (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_prod_fecha      ON ordenes_produccion (fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_ordenes_prod_producto   ON ordenes_produccion (producto_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_prod_estado     ON ordenes_produccion (estado);

ALTER TABLE compras            ENABLE ROW LEVEL SECURITY; ALTER TABLE compras            FORCE ROW LEVEL SECURITY;
ALTER TABLE empleados          ENABLE ROW LEVEL SECURITY; ALTER TABLE empleados          FORCE ROW LEVEL SECURITY;
ALTER TABLE ordenes_produccion ENABLE ROW LEVEL SECURITY; ALTER TABLE ordenes_produccion FORCE ROW LEVEL SECURITY;

-- Los 3 ya existen en el catálogo de módulos desde 012_empresas.sql con
-- base_de_datos=false (modo CSV-import-only) -- se actualizan a true, ya
-- no reemplazan la fila (ON CONFLICT no aplica acá, es un UPDATE real).
UPDATE modulos SET base_de_datos = true WHERE id IN ('compras', 'rrhh', 'produccion');

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('compras'), ('rrhh'), ('produccion')) AS m(modulo)
CROSS JOIN (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos
  WHERE nombre LIKE 'compras.%' OR nombre LIKE 'rrhh.%' OR nombre LIKE 'produccion.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'compras.ver','compras.crear','compras.editar',
    'rrhh.ver','rrhh.crear','rrhh.editar',
    'produccion.ver','produccion.crear','produccion.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('compras.ver','rrhh.ver','produccion.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
