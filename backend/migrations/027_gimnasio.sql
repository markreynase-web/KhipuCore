-- Vertical Gimnasio: el primer módulo de suscripciones/cobro recurrente de
-- la plataforma. Reutiliza `clientes` como socios (mismo patrón que
-- Dentista/Óptica/Veterinaria). Decisión de alcance (charla aparte, no en
-- la misma sesión que los otros verticales): los pagos se registran a
-- MANO -- no hay integración con pasarela de pago real (Culqi/Mercado
-- Pago/Stripe). Eso es un proyecto propio (webhooks, cobros fallidos,
-- tokenización) que queda fuera de este alcance a propósito.
--
-- planes_membresia: catálogo de planes (mensual/trimestral/anual...).
-- duracion_meses es un entero libre en vez de un enum -- "cada 2 meses" o
-- "cada 6 meses" son planes tan válidos como mensual/trimestral/anual, y
-- así no hace falta tocar el esquema para agregar una duración nueva.
CREATE TABLE IF NOT EXISTS planes_membresia (
  id              SERIAL PRIMARY KEY,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
  nombre          VARCHAR(100) NOT NULL,
  duracion_meses  INTEGER NOT NULL CHECK (duracion_meses > 0),
  precio          NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado          VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  notas           TEXT,
  creado_el       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- membresias: la suscripción de UN socio a UN plan. fecha_vencimiento se
-- calcula del lado del servidor (fecha_inicio + plan.duracion_meses, ver
-- routes/membresias.js), nunca se confía en lo que mande el cliente.
--
-- `estado` acá es SOLO para cancelación manual ('activa'/'cancelada') --
-- explícitamente NO incluye 'vencida'/'por vencer'/'al día': ese semáforo
-- se calcula al vuelo comparando fecha_vencimiento contra hoy (mismo
-- criterio que alertaStock en Inventario, que tampoco guarda "bajo stock"
-- como columna) -- así no hace falta un cron ni un job en background para
-- mantenerlo al día, algo que esta plataforma no tiene hoy.
CREATE TABLE IF NOT EXISTS membresias (
  id                 SERIAL PRIMARY KEY,
  empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
  cliente_id         INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre     VARCHAR(200) NOT NULL,
  plan_id            INTEGER NOT NULL REFERENCES planes_membresia(id),
  plan_nombre        VARCHAR(100) NOT NULL,
  fecha_inicio       DATE NOT NULL,
  fecha_vencimiento  DATE NOT NULL,
  estado             VARCHAR(20) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','cancelada')),
  notas              TEXT,
  creado_el          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pagos_membresia: historial de cobros. Se crea SIEMPRE junto con la
-- extensión de membresias.fecha_vencimiento, en la misma transacción (ver
-- routes/membresias.js POST /:id/pagos) -- por diseño no existe una ruta
-- que inserte un pago sin extender el vencimiento, para que nunca quede
-- un pago registrado que no movió la fecha, o una fecha movida sin su pago.
CREATE TABLE IF NOT EXISTS pagos_membresia (
  id              SERIAL PRIMARY KEY,
  empresa_id      INTEGER NOT NULL REFERENCES empresas(id),
  membresia_id    INTEGER NOT NULL REFERENCES membresias(id),
  cliente_nombre  VARCHAR(200) NOT NULL,
  plan_nombre     VARCHAR(100) NOT NULL,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  monto           NUMERIC(10,2) NOT NULL DEFAULT 0,
  metodo          VARCHAR(20) NOT NULL DEFAULT 'efectivo'
                     CHECK (metodo IN ('efectivo','yape','plin','transferencia','tarjeta')),
  vencimiento_anterior  DATE,
  vencimiento_nuevo     DATE,
  notas           TEXT,
  creado_el       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planes_membresia_empresa   ON planes_membresia (empresa_id);
CREATE INDEX IF NOT EXISTS idx_planes_membresia_estado    ON planes_membresia (estado);

CREATE INDEX IF NOT EXISTS idx_membresias_empresa         ON membresias (empresa_id);
CREATE INDEX IF NOT EXISTS idx_membresias_cliente          ON membresias (cliente_id);
CREATE INDEX IF NOT EXISTS idx_membresias_plan             ON membresias (plan_id);
CREATE INDEX IF NOT EXISTS idx_membresias_vencimiento       ON membresias (fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_membresias_estado            ON membresias (estado);

CREATE INDEX IF NOT EXISTS idx_pagos_membresia_empresa     ON pagos_membresia (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagos_membresia_membresia    ON pagos_membresia (membresia_id);
CREATE INDEX IF NOT EXISTS idx_pagos_membresia_fecha        ON pagos_membresia (fecha);

ALTER TABLE planes_membresia ENABLE ROW LEVEL SECURITY; ALTER TABLE planes_membresia FORCE ROW LEVEL SECURITY;
ALTER TABLE membresias       ENABLE ROW LEVEL SECURITY; ALTER TABLE membresias       FORCE ROW LEVEL SECURITY;
ALTER TABLE pagos_membresia  ENABLE ROW LEVEL SECURITY; ALTER TABLE pagos_membresia  FORCE ROW LEVEL SECURITY;

-- dependencias (ver 023_dependencias_modulos.sql): membresias exige
-- cliente_id Y plan_id NOT NULL -- depende de "clientes" y
-- "planes_membresia". pagos_membresia exige membresia_id NOT NULL -- depende
-- de "membresias".
INSERT INTO modulos (id, label, icon, page, base_de_datos, dependencias) VALUES
  ('planes_membresia', 'Planes de Membresía', '💳', 'planes-membresia.html', true, '{}'),
  ('membresias',       'Socios',              '🏋️', 'membresias.html',       true, ARRAY['clientes','planes_membresia']),
  ('pagos_membresia',  'Pagos',               '🧾', 'pagos-membresia.html',  true, ARRAY['membresias'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('planes_membresia'), ('membresias'), ('pagos_membresia')) AS m(modulo)
CROSS JOIN (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  -- pagos_membresia.editar queda fuera a propósito: no existe un PUT
  -- /pagos_membresia/:id (un pago no se edita, se deshace -- ver
  -- routes/pagosMembresia.js), así que otorgarlo solo mostraría un botón
  -- "Editar" que rompe al usarlo.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos
  WHERE nombre LIKE 'planes_membresia.%' OR nombre LIKE 'membresias.%'
     OR nombre IN ('pagos_membresia.ver','pagos_membresia.crear','pagos_membresia.eliminar')
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'planes_membresia.ver','planes_membresia.crear','planes_membresia.editar',
    'membresias.ver','membresias.crear','membresias.editar',
    'pagos_membresia.ver','pagos_membresia.crear'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('planes_membresia.ver','membresias.ver','pagos_membresia.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Gimnasio en una empresa (reemplaza el id;
-- respeta las dependencias):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'clientes'), (N, 'planes_membresia'), (N, 'membresias'), (N, 'pagos_membresia')
--   ON CONFLICT DO NOTHING;
