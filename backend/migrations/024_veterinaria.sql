-- Vertical Veterinaria: mismo patrón que 020_dentista.sql / 021_oculista.sql
-- -- reutiliza `clientes` como dueños y `agenda` (ya genérica) para las
-- citas. La diferencia real con Dentista/Óptica es que el "paciente" NO es
-- directamente el cliente sino su mascota -- por eso hace falta la pieza
-- nueva (`mascotas`) antes de poder clonar el resto del molde: todo lo
-- demás cuelga de mascota_id, no de cliente_id directo.
--
-- mascotas: registro de la mascota, dueño = cliente_id (mismo patrón
-- vehiculos.cliente_id de Automotriz). Una fila por mascota, no por visita.
CREATE TABLE IF NOT EXISTS mascotas (
  id                 SERIAL PRIMARY KEY,
  empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
  cliente_id         INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre     VARCHAR(200) NOT NULL,
  nombre             VARCHAR(100) NOT NULL,
  especie            VARCHAR(40) NOT NULL,
  raza               VARCHAR(80),
  sexo               VARCHAR(10) CHECK (sexo IN ('macho','hembra')),
  fecha_nacimiento   DATE,
  peso_kg            NUMERIC(5,2),
  notas              TEXT,
  creado_el          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- atenciones_veterinarias: historial clínico + cobro por atención, mismo
-- criterio que tratamientos (diagnóstico + procedimiento + costo juntos en
-- una fila). mascota_id es NOT NULL a propósito -- una atención sin
-- mascota es un formulario roto, no un caso opcional (mismo criterio que
-- postventa.vehiculo_id en Automotriz).
CREATE TABLE IF NOT EXISTS atenciones_veterinarias (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  mascota_id            INTEGER NOT NULL REFERENCES mascotas(id),
  mascota_nombre        VARCHAR(100) NOT NULL,
  diagnostico           TEXT,
  procedimiento         VARCHAR(250) NOT NULL,
  costo                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                VARCHAR(20) NOT NULL DEFAULT 'planificado'
                           CHECK (estado IN ('planificado','en_progreso','completado','cancelado')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- planes_veterinarios: mismo rol que planes_tratamiento -- procedimientos de
-- varias sesiones o de costo alto (cirugías, tratamientos prolongados) con
-- presupuesto y aprobación del dueño.
CREATE TABLE IF NOT EXISTS planes_veterinarios (
  id                 SERIAL PRIMARY KEY,
  empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
  fecha              DATE NOT NULL DEFAULT CURRENT_DATE,
  mascota_id         INTEGER NOT NULL REFERENCES mascotas(id),
  mascota_nombre     VARCHAR(100) NOT NULL,
  descripcion        TEXT NOT NULL,
  presupuesto_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado             VARCHAR(20) NOT NULL DEFAULT 'propuesto'
                        CHECK (estado IN ('propuesto','aprobado','rechazado','en_progreso','completado')),
  fecha_aprobacion   DATE,
  notas              TEXT,
  creado_el          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seguros_mascotas: mismo patrón que seguros_dentales, pero mascota_id es
-- NOT NULL (a diferencia de seguros_dentales.tratamiento_id) -- un seguro de
-- mascota SIEMPRE es sobre una mascota concreta, no hay caso "general" del
-- dueño. atencion_id sí queda opcional (un reclamo puede no venir de una
-- atención registrada, ej. cobertura preventiva).
CREATE TABLE IF NOT EXISTS seguros_mascotas (
  id                        SERIAL PRIMARY KEY,
  empresa_id                INTEGER NOT NULL REFERENCES empresas(id),
  fecha                     DATE NOT NULL DEFAULT CURRENT_DATE,
  mascota_id                INTEGER NOT NULL REFERENCES mascotas(id),
  mascota_nombre            VARCHAR(100) NOT NULL,
  aseguradora               VARCHAR(150) NOT NULL,
  numero_poliza             VARCHAR(80),
  atencion_id               INTEGER REFERENCES atenciones_veterinarias(id),
  atencion_descripcion      VARCHAR(250),
  monto_reclamado           NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_cubierto            NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                    VARCHAR(20) NOT NULL DEFAULT 'enviado'
                               CHECK (estado IN ('enviado','en_revision','aprobado','rechazado','pagado')),
  notas                     TEXT,
  creado_el                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mascotas_empresa       ON mascotas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_mascotas_cliente        ON mascotas (cliente_id);

CREATE INDEX IF NOT EXISTS idx_atenciones_vet_empresa  ON atenciones_veterinarias (empresa_id);
CREATE INDEX IF NOT EXISTS idx_atenciones_vet_fecha    ON atenciones_veterinarias (fecha);
CREATE INDEX IF NOT EXISTS idx_atenciones_vet_mascota  ON atenciones_veterinarias (mascota_id);
CREATE INDEX IF NOT EXISTS idx_atenciones_vet_estado   ON atenciones_veterinarias (estado);

CREATE INDEX IF NOT EXISTS idx_planes_vet_empresa      ON planes_veterinarios (empresa_id);
CREATE INDEX IF NOT EXISTS idx_planes_vet_fecha        ON planes_veterinarios (fecha);
CREATE INDEX IF NOT EXISTS idx_planes_vet_mascota      ON planes_veterinarios (mascota_id);
CREATE INDEX IF NOT EXISTS idx_planes_vet_estado       ON planes_veterinarios (estado);

CREATE INDEX IF NOT EXISTS idx_seguros_masc_empresa    ON seguros_mascotas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_seguros_masc_fecha      ON seguros_mascotas (fecha);
CREATE INDEX IF NOT EXISTS idx_seguros_masc_mascota    ON seguros_mascotas (mascota_id);
CREATE INDEX IF NOT EXISTS idx_seguros_masc_atencion   ON seguros_mascotas (atencion_id);
CREATE INDEX IF NOT EXISTS idx_seguros_masc_estado     ON seguros_mascotas (estado);

ALTER TABLE mascotas                ENABLE ROW LEVEL SECURITY; ALTER TABLE mascotas                FORCE ROW LEVEL SECURITY;
ALTER TABLE atenciones_veterinarias ENABLE ROW LEVEL SECURITY; ALTER TABLE atenciones_veterinarias FORCE ROW LEVEL SECURITY;
ALTER TABLE planes_veterinarios     ENABLE ROW LEVEL SECURITY; ALTER TABLE planes_veterinarios     FORCE ROW LEVEL SECURITY;
ALTER TABLE seguros_mascotas        ENABLE ROW LEVEL SECURITY; ALTER TABLE seguros_mascotas        FORCE ROW LEVEL SECURITY;

-- dependencias (ver 023_dependencias_modulos.sql): las tres piezas nuevas
-- cuelgan de mascota_id NOT NULL, así que las tres dependen de "mascotas"
-- -- igual criterio que postventa -> vehiculos. "mascotas" a su vez
-- depende de "clientes" por el mismo motivo (cliente_id NOT NULL). Esta
-- última no aplicaba todavía en 023 porque ese archivo solo cubrió la
-- única dependencia dura que existía en ese momento (postventa); acá se
-- vuelve a evaluar desde cero para el vertical nuevo.
INSERT INTO modulos (id, label, icon, page, base_de_datos, dependencias) VALUES
  ('mascotas',                'Mascotas',                '🐾', 'mascotas.html',                true, ARRAY['clientes']),
  ('atenciones_veterinarias', 'Atenciones',               '🩺', 'atenciones-veterinarias.html', true, ARRAY['mascotas']),
  ('planes_veterinarios',     'Planes Veterinarios',      '📋', 'planes-veterinarios.html',     true, ARRAY['mascotas']),
  ('seguros_mascotas',        'Seguros de Mascotas',      '🛡️', 'seguros-mascotas.html',        true, ARRAY['mascotas'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('mascotas'), ('atenciones_veterinarias'), ('planes_veterinarios'), ('seguros_mascotas')) AS m(modulo)
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
  WHERE nombre LIKE 'mascotas.%' OR nombre LIKE 'atenciones_veterinarias.%'
     OR nombre LIKE 'planes_veterinarios.%' OR nombre LIKE 'seguros_mascotas.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'mascotas.ver','mascotas.crear','mascotas.editar',
    'atenciones_veterinarias.ver','atenciones_veterinarias.crear','atenciones_veterinarias.editar',
    'planes_veterinarios.ver','planes_veterinarios.crear','planes_veterinarios.editar',
    'seguros_mascotas.ver','seguros_mascotas.crear','seguros_mascotas.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('mascotas.ver','atenciones_veterinarias.ver','planes_veterinarios.ver','seguros_mascotas.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Veterinaria en una empresa (reemplaza el id;
-- respeta las dependencias -- "clientes" y "mascotas" deben ir antes o en
-- el mismo lote que el resto):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'clientes'), (N, 'mascotas'), (N, 'atenciones_veterinarias'),
--     (N, 'planes_veterinarios'), (N, 'seguros_mascotas'), (N, 'agenda')
--   ON CONFLICT DO NOTHING;
