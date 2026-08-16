-- Vertical Transporte de colectivos. A diferencia de Automotriz/Dentista/
-- Óptica/Veterinaria, este vertical NO reutiliza `clientes` como el
-- "paciente/dueño" -- una empresa de transporte no administra pasajeros
-- individuales en este sistema, administra su PROPIA flota. Por eso
-- `flota` es una tabla nueva y no la reutilización literal de `vehiculos`
-- (esa tabla tiene cliente_id NOT NULL a propósito, porque en Automotriz el
-- vehículo siempre es de un cliente que lo trae a reparar -- ese supuesto
-- no aplica acá). Se clona el mismo MOLDE de columnas (placa/marca/modelo/
-- año/kilometraje), no la tabla.
--
-- flota: la unidad (bus/combi/van) propia de la empresa.
CREATE TABLE IF NOT EXISTS flota (
  id                  SERIAL PRIMARY KEY,
  empresa_id          INTEGER NOT NULL REFERENCES empresas(id),
  placa               VARCHAR(20) NOT NULL,
  marca               VARCHAR(80) NOT NULL,
  modelo              VARCHAR(80) NOT NULL,
  anio                INTEGER,
  tipo_vehiculo       VARCHAR(20) CHECK (tipo_vehiculo IN ('bus','minibus','combi','van')),
  capacidad_pasajeros INTEGER,
  kilometraje_actual  NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado              VARCHAR(20) NOT NULL DEFAULT 'operativo'
                         CHECK (estado IN ('operativo','mantenimiento','fuera_de_servicio')),
  notas               TEXT,
  creado_el           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- conductores: personal que maneja la flota. licencia_vencimiento sigue el
-- mismo patrón de fecha-de-vencimiento que postventa.garantia_hasta, para
-- que control_documentario (más abajo) tenga algo real que vigilar además
-- de los documentos del vehículo.
CREATE TABLE IF NOT EXISTS conductores (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  nombre                VARCHAR(200) NOT NULL,
  documento_identidad   VARCHAR(20),
  telefono              VARCHAR(30),
  licencia_categoria    VARCHAR(10),
  licencia_numero       VARCHAR(40),
  licencia_vencimiento  DATE,
  fecha_ingreso         DATE,
  estado                VARCHAR(20) NOT NULL DEFAULT 'activo'
                           CHECK (estado IN ('activo','inactivo','de_baja')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- rutas: trayecto que ofrece la empresa, independiente de quién lo maneje
-- o en qué unidad -- turnos (abajo) es lo que junta ruta + conductor + unidad.
CREATE TABLE IF NOT EXISTS rutas (
  id             SERIAL PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id),
  nombre         VARCHAR(150) NOT NULL,
  origen         VARCHAR(150),
  destino        VARCHAR(150),
  distancia_km   NUMERIC(6,2),
  tarifa         NUMERIC(8,2) NOT NULL DEFAULT 0,
  estado         VARCHAR(20) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','inactiva')),
  notas          TEXT,
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- turnos: una asignación concreta de conductor + unidad + ruta + horario.
-- Las tres referencias son NOT NULL a propósito -- un turno sin alguna de
-- las tres es un formulario roto (mismo criterio que postventa.vehiculo_id).
CREATE TABLE IF NOT EXISTS turnos (
  id                     SERIAL PRIMARY KEY,
  empresa_id             INTEGER NOT NULL REFERENCES empresas(id),
  fecha                  DATE NOT NULL DEFAULT CURRENT_DATE,
  conductor_id           INTEGER NOT NULL REFERENCES conductores(id),
  conductor_nombre       VARCHAR(200) NOT NULL,
  flota_id               INTEGER NOT NULL REFERENCES flota(id),
  flota_descripcion      VARCHAR(150) NOT NULL,
  ruta_id                INTEGER NOT NULL REFERENCES rutas(id),
  ruta_nombre            VARCHAR(150) NOT NULL,
  hora_salida            TIME NOT NULL,
  hora_llegada_estimada  TIME,
  estado                 VARCHAR(20) NOT NULL DEFAULT 'programado'
                            CHECK (estado IN ('programado','en_curso','completado','cancelado')),
  notas                  TEXT,
  creado_el              TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- control_documentario: vencimientos de documentos, de un vehículo O de un
-- conductor (nunca los dos) -- mismo patrón de fecha que postventa/óptica,
-- pero polimórfico. El CHECK obliga a que exactamente uno de flota_id /
-- conductor_id venga lleno según entidad_tipo, para que la fila nunca quede
-- ambigua sobre a qué le pertenece el vencimiento.
CREATE TABLE IF NOT EXISTS control_documentario (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  entidad_tipo          VARCHAR(20) NOT NULL CHECK (entidad_tipo IN ('vehiculo','conductor')),
  flota_id              INTEGER REFERENCES flota(id),
  conductor_id          INTEGER REFERENCES conductores(id),
  entidad_descripcion   VARCHAR(200) NOT NULL,
  tipo_documento        VARCHAR(60) NOT NULL,
  numero_documento      VARCHAR(60),
  fecha_emision         DATE,
  fecha_vencimiento     DATE NOT NULL,
  estado                VARCHAR(20) NOT NULL DEFAULT 'vigente' CHECK (estado IN ('vigente','vencido')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_control_doc_entidad CHECK (
    (entidad_tipo = 'vehiculo'  AND flota_id     IS NOT NULL AND conductor_id IS NULL)
    OR
    (entidad_tipo = 'conductor' AND conductor_id IS NOT NULL AND flota_id     IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_flota_empresa            ON flota (empresa_id);
CREATE INDEX IF NOT EXISTS idx_flota_estado              ON flota (estado);

CREATE INDEX IF NOT EXISTS idx_conductores_empresa       ON conductores (empresa_id);
CREATE INDEX IF NOT EXISTS idx_conductores_estado        ON conductores (estado);
CREATE INDEX IF NOT EXISTS idx_conductores_licencia_venc ON conductores (licencia_vencimiento);

CREATE INDEX IF NOT EXISTS idx_rutas_empresa             ON rutas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_rutas_estado               ON rutas (estado);

CREATE INDEX IF NOT EXISTS idx_turnos_empresa            ON turnos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_turnos_fecha              ON turnos (fecha);
CREATE INDEX IF NOT EXISTS idx_turnos_conductor           ON turnos (conductor_id);
CREATE INDEX IF NOT EXISTS idx_turnos_flota               ON turnos (flota_id);
CREATE INDEX IF NOT EXISTS idx_turnos_ruta                ON turnos (ruta_id);
CREATE INDEX IF NOT EXISTS idx_turnos_estado              ON turnos (estado);

CREATE INDEX IF NOT EXISTS idx_control_doc_empresa        ON control_documentario (empresa_id);
CREATE INDEX IF NOT EXISTS idx_control_doc_vencimiento     ON control_documentario (fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_control_doc_flota           ON control_documentario (flota_id);
CREATE INDEX IF NOT EXISTS idx_control_doc_conductor       ON control_documentario (conductor_id);
CREATE INDEX IF NOT EXISTS idx_control_doc_estado          ON control_documentario (estado);

ALTER TABLE flota                ENABLE ROW LEVEL SECURITY; ALTER TABLE flota                FORCE ROW LEVEL SECURITY;
ALTER TABLE conductores          ENABLE ROW LEVEL SECURITY; ALTER TABLE conductores          FORCE ROW LEVEL SECURITY;
ALTER TABLE rutas                ENABLE ROW LEVEL SECURITY; ALTER TABLE rutas                FORCE ROW LEVEL SECURITY;
ALTER TABLE turnos               ENABLE ROW LEVEL SECURITY; ALTER TABLE turnos               FORCE ROW LEVEL SECURITY;
ALTER TABLE control_documentario ENABLE ROW LEVEL SECURITY; ALTER TABLE control_documentario FORCE ROW LEVEL SECURITY;

-- dependencias (ver 023_dependencias_modulos.sql): turnos exige las tres
-- referencias NOT NULL; control_documentario puede apuntar a flota O a
-- conductores según la fila, así que depende de ambos catálogos estando
-- disponibles (no hay forma de expresar "uno u otro" en este array, y es
-- preferible pedir de más que dejar activar el módulo sin nada que elegir).
INSERT INTO modulos (id, label, icon, page, base_de_datos, dependencias) VALUES
  ('flota',                'Flota',                '🚌', 'flota.html',                true, '{}'),
  ('conductores',          'Conductores',          '🪪', 'conductores.html',          true, '{}'),
  ('rutas',                'Rutas',                '🛣️', 'rutas.html',                true, '{}'),
  ('turnos',               'Turnos',               '🕐', 'turnos.html',               true, ARRAY['flota','conductores','rutas']),
  ('control_documentario', 'Control Documentario', '📄', 'control-documentario.html', true, ARRAY['flota','conductores'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('flota'), ('conductores'), ('rutas'), ('turnos'), ('control_documentario')) AS m(modulo)
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
  WHERE nombre LIKE 'flota.%' OR nombre LIKE 'conductores.%' OR nombre LIKE 'rutas.%'
     OR nombre LIKE 'turnos.%' OR nombre LIKE 'control_documentario.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'flota.ver','flota.crear','flota.editar',
    'conductores.ver','conductores.crear','conductores.editar',
    'rutas.ver','rutas.crear','rutas.editar',
    'turnos.ver','turnos.crear','turnos.editar',
    'control_documentario.ver','control_documentario.crear','control_documentario.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('flota.ver','conductores.ver','rutas.ver','turnos.ver','control_documentario.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Transporte en una empresa (reemplaza el id;
-- respeta las dependencias):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'flota'), (N, 'conductores'), (N, 'rutas'),
--     (N, 'turnos'), (N, 'control_documentario')
--   ON CONFLICT DO NOTHING;
-- Nota: a diferencia de los demás verticales, este NO necesita 'clientes'
-- ni 'agenda' -- no administra pasajeros individuales.
