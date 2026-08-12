-- Vertical Dentista: reutiliza `clientes` como pacientes (mismo patrón que
-- vehiculos.cliente_id en Automotriz -- no se crea una tabla "pacientes"
-- aparte) y `agenda` (ya genérica, vehiculo_id opcional) para las citas --
-- no hace falta una agenda dedicada.
--
-- Tres módulos nuevos, deliberadamente NO incluidos (necesitan infra que no
-- existe hoy en el backend, ver charla de esta fase):
--   - Imágenes clínicas: no hay subida/almacenamiento de archivos en
--     ningún módulo todavía (sin multer con storage persistente, sin S3).
--   - Consentimientos digitales: necesita un proveedor externo de firma
--     electrónica, no existe integración.
--
-- tratamientos: historial clínico + facturación por procedimiento juntos en
-- una tabla (igual que postventa fusiona "orden de servicio" + "cargo"
-- en un solo registro) -- pieza_dental es texto libre (ej. "16", "muela
-- superior derecha"), NO un mapa gráfico interactivo de odontograma; eso
-- sería un proyecto de UI aparte.
CREATE TABLE IF NOT EXISTS tratamientos (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id            INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre        VARCHAR(200) NOT NULL,
  pieza_dental          VARCHAR(30),
  diagnostico           TEXT,
  procedimiento         VARCHAR(250) NOT NULL,
  codigo_procedimiento  VARCHAR(40),
  costo                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                VARCHAR(20) NOT NULL DEFAULT 'planificado'
                           CHECK (estado IN ('planificado','en_progreso','completado','cancelado')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- planes_tratamiento: "fases del tratamiento, presupuesto y aprobación del
-- paciente" del PDF -- fases quedan como texto (no hay carrito de líneas en
-- ningún módulo de la app todavía, mismo criterio que postventa.costo_repuestos).
CREATE TABLE IF NOT EXISTS planes_tratamiento (
  id                 SERIAL PRIMARY KEY,
  empresa_id         INTEGER NOT NULL REFERENCES empresas(id),
  fecha              DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id         INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre     VARCHAR(200) NOT NULL,
  descripcion        TEXT NOT NULL,
  presupuesto_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado             VARCHAR(20) NOT NULL DEFAULT 'propuesto'
                        CHECK (estado IN ('propuesto','aprobado','rechazado','en_progreso','completado')),
  fecha_aprobacion   DATE,
  notas              TEXT,
  creado_el          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seguros_dentales: reclamos ante la aseguradora. tratamiento_id es
-- OPCIONAL -- un reclamo puede cubrir un tratamiento puntual o ser más
-- general; cuando se linkea, se guarda una "foto" de su descripción (mismo
-- patrón cliente_nombre/vehiculo_descripcion del resto de la app).
CREATE TABLE IF NOT EXISTS seguros_dentales (
  id                        SERIAL PRIMARY KEY,
  empresa_id                INTEGER NOT NULL REFERENCES empresas(id),
  fecha                     DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id                INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre            VARCHAR(200) NOT NULL,
  aseguradora               VARCHAR(150) NOT NULL,
  numero_poliza             VARCHAR(80),
  tratamiento_id            INTEGER REFERENCES tratamientos(id),
  tratamiento_descripcion   VARCHAR(250),
  monto_reclamado           NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_cubierto            NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                    VARCHAR(20) NOT NULL DEFAULT 'enviado'
                               CHECK (estado IN ('enviado','en_revision','aprobado','rechazado','pagado')),
  notas                     TEXT,
  creado_el                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tratamientos_empresa   ON tratamientos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_tratamientos_fecha      ON tratamientos (fecha);
CREATE INDEX IF NOT EXISTS idx_tratamientos_cliente    ON tratamientos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_tratamientos_estado     ON tratamientos (estado);

CREATE INDEX IF NOT EXISTS idx_planes_trat_empresa     ON planes_tratamiento (empresa_id);
CREATE INDEX IF NOT EXISTS idx_planes_trat_fecha       ON planes_tratamiento (fecha);
CREATE INDEX IF NOT EXISTS idx_planes_trat_cliente     ON planes_tratamiento (cliente_id);
CREATE INDEX IF NOT EXISTS idx_planes_trat_estado      ON planes_tratamiento (estado);

CREATE INDEX IF NOT EXISTS idx_seguros_dent_empresa    ON seguros_dentales (empresa_id);
CREATE INDEX IF NOT EXISTS idx_seguros_dent_fecha      ON seguros_dentales (fecha);
CREATE INDEX IF NOT EXISTS idx_seguros_dent_cliente    ON seguros_dentales (cliente_id);
CREATE INDEX IF NOT EXISTS idx_seguros_dent_tratamiento ON seguros_dentales (tratamiento_id);
CREATE INDEX IF NOT EXISTS idx_seguros_dent_estado     ON seguros_dentales (estado);

ALTER TABLE tratamientos       ENABLE ROW LEVEL SECURITY; ALTER TABLE tratamientos       FORCE ROW LEVEL SECURITY;
ALTER TABLE planes_tratamiento ENABLE ROW LEVEL SECURITY; ALTER TABLE planes_tratamiento FORCE ROW LEVEL SECURITY;
ALTER TABLE seguros_dentales   ENABLE ROW LEVEL SECURITY; ALTER TABLE seguros_dentales   FORCE ROW LEVEL SECURITY;

INSERT INTO modulos (id, label, icon, page, base_de_datos) VALUES
  ('tratamientos',       'Tratamientos',         '🦷', 'tratamientos.html',       true),
  ('planes_tratamiento', 'Planes de Tratamiento', '📋', 'planes-tratamiento.html', true),
  ('seguros_dentales',   'Seguros Dentales',      '🛡️', 'seguros-dentales.html',   true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('tratamientos'), ('planes_tratamiento'), ('seguros_dentales')) AS m(modulo)
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
  WHERE nombre LIKE 'tratamientos.%' OR nombre LIKE 'planes_tratamiento.%' OR nombre LIKE 'seguros_dentales.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'tratamientos.ver','tratamientos.crear','tratamientos.editar',
    'planes_tratamiento.ver','planes_tratamiento.crear','planes_tratamiento.editar',
    'seguros_dentales.ver','seguros_dentales.crear','seguros_dentales.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('tratamientos.ver','planes_tratamiento.ver','seguros_dentales.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Dentista en una empresa (reemplaza el id):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'tratamientos'), (N, 'planes_tratamiento'), (N, 'seguros_dentales'), (N, 'agenda')
--   ON CONFLICT DO NOTHING;
-- Agenda no se agrega sola en este archivo (ya existe desde 019_agenda.sql
-- y es opt-in propio) -- se recomienda prenderla junto con estos tres.
