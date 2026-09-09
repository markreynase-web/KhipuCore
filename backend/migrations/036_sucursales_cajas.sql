-- Fase 3, roadmap competitivo -- Nivel 2 (Corto plazo), Sub-fase A: modelo
-- de datos para sucursales, cajas (multicaja) y turnos de caja (Cierre de
-- Caja). Decisión de negocio ya tomada: el stock es SEPARADO por
-- sucursal, no compartido a nivel empresa -- un mismo producto puede
-- tener cantidades distintas en cada sucursal.
--
-- Backfill seguro: cada empresa existente recibe una "Sucursal Principal"
-- automática, y todo su inventario actual queda asignado a esa sucursal.
-- Ninguna empresa existente pierde datos ni queda rota.
--
-- inventario.sucursal_id queda NULLABLE en esta sub-fase a propósito (no
-- NOT NULL, aunque el diseño original lo pedía así): el INSERT real de
-- inventario.js (POST) y el fixture de tests crearProducto() todavía no
-- completan esta columna -- eso es trabajo de la Sub-fase B. Ponerla
-- NOT NULL ahora rompería la creación de productos de inmediato, antes de
-- que exista el código que la sostenga. El backfill sí corre completo
-- para los datos existentes; el NOT NULL llega en la Sub-fase B junto con
-- el código que la llena siempre.

CREATE TABLE IF NOT EXISTS sucursales (
  id              SERIAL PRIMARY KEY,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre          VARCHAR(150) NOT NULL,
  direccion       VARCHAR(250),
  activo          BOOLEAN NOT NULL DEFAULT true,
  -- Marca la sucursal creada automáticamente por el backfill de abajo --
  -- útil para distinguirla después de una sucursal real que el cliente
  -- haya creado a propósito con ese mismo nombre.
  principal       BOOLEAN NOT NULL DEFAULT false,
  creado_el       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sucursales_empresa ON sucursales (empresa_id);

-- Multicaja: cada sucursal puede tener más de una caja/terminal de cobro.
CREATE TABLE IF NOT EXISTS cajas (
  id              SERIAL PRIMARY KEY,
  sucursal_id     INTEGER NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
  nombre          VARCHAR(100) NOT NULL,
  activa          BOOLEAN NOT NULL DEFAULT true,
  creado_el       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cajas_sucursal ON cajas (sucursal_id);

-- El core del Cierre de Caja (Sub-fase D): un turno abre con un monto
-- declarado, y cierra comparando lo declarado por el usuario contra lo
-- que el sistema calcula solo (apertura + ingresos del turno - egresos
-- del turno). empresa_id queda denormalizado a propósito -- mismo
-- criterio que el resto del proyecto (empresa_id siempre presente y
-- directo en cada tabla, para no depender de un JOIN extra para aislar).
CREATE TABLE IF NOT EXISTS turnos_caja (
  id                      SERIAL PRIMARY KEY,
  caja_id                 INTEGER NOT NULL REFERENCES cajas(id),
  empresa_id              INTEGER NOT NULL REFERENCES empresas(id),
  usuario_apertura_id     INTEGER NOT NULL REFERENCES usuarios(id),
  monto_apertura          NUMERIC(14,2) NOT NULL DEFAULT 0,
  fecha_apertura          TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_cierre_id       INTEGER REFERENCES usuarios(id),
  monto_cierre_declarado  NUMERIC(14,2),
  monto_cierre_sistema    NUMERIC(14,2),
  diferencia              NUMERIC(14,2),
  fecha_cierre            TIMESTAMPTZ,
  estado                  VARCHAR(20) NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  notas                   TEXT
);
CREATE INDEX IF NOT EXISTS idx_turnos_caja_empresa ON turnos_caja (empresa_id);
CREATE INDEX IF NOT EXISTS idx_turnos_caja_caja_estado ON turnos_caja (caja_id, estado);

-- inventario: el cambio invasivo -- nullable en esta sub-fase (ver nota al
-- inicio del archivo sobre por qué NOT NULL espera a la Sub-fase B).
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES sucursales(id);

-- ventas y finanzas: NULLABLE y se quedan así -- las ventas y movimientos
-- ya existentes son datos históricos de antes de que existiera el
-- concepto de sucursal; no hay forma honesta de asignarles una sucursal
-- real después del hecho, así que se dejan sin asignar en vez de forzar
-- un valor inventado.
ALTER TABLE ventas   ADD COLUMN IF NOT EXISTS sucursal_id   INTEGER REFERENCES sucursales(id);
ALTER TABLE ventas   ADD COLUMN IF NOT EXISTS turno_caja_id INTEGER REFERENCES turnos_caja(id);
ALTER TABLE finanzas ADD COLUMN IF NOT EXISTS sucursal_id   INTEGER REFERENCES sucursales(id);
ALTER TABLE finanzas ADD COLUMN IF NOT EXISTS turno_caja_id INTEGER REFERENCES turnos_caja(id);

CREATE INDEX IF NOT EXISTS idx_inventario_sucursal ON inventario (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_ventas_sucursal      ON ventas (sucursal_id);
CREATE INDEX IF NOT EXISTS idx_finanzas_sucursal    ON finanzas (sucursal_id);

-- --- Backfill: una "Sucursal Principal" por cada empresa existente ---
INSERT INTO sucursales (empresa_id, nombre, principal)
SELECT id, 'Sucursal Principal', true
FROM empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM sucursales s WHERE s.empresa_id = e.id AND s.principal = true
);

-- Todo el inventario existente pasa a pertenecer a la sucursal principal
-- de su propia empresa -- ningún producto queda "flotando" sin sucursal.
UPDATE inventario i
SET sucursal_id = s.id
FROM sucursales s
WHERE s.empresa_id = i.empresa_id AND s.principal = true AND i.sucursal_id IS NULL;

-- Mismo patrón deny-by-default que el resto de las tablas (ver 007_supabase_rls.sql).
ALTER TABLE sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sucursales FORCE ROW LEVEL SECURITY;
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cajas FORCE ROW LEVEL SECURITY;
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos_caja FORCE ROW LEVEL SECURITY;
