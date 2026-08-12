-- Vertical Oculista: mismo patrón que 020_dentista.sql -- reutiliza
-- `clientes` como pacientes y `agenda` (ya genérica) para las citas.
--
-- "Garantías" del PDF (control de garantías de armazones y lentes) se
-- modela como un campo garantia_hasta directo en ordenes_laboratorio, NO
-- como una cuarta tabla -- mismo criterio que postventa.garantia_hasta en
-- el vertical Automotriz (un campo de fecha, no un módulo de reclamos
-- aparte). Si más adelante hace falta trackear reclamos de garantía como
-- flujo propio, se puede agregar sin romper nada de esto.

-- recetas_opticas: historial clínico + receta óptica. Términos reales de
-- optometría (esfera/cilindro/eje/adición/distancia pupilar), un registro
-- por examen -- el histórico del paciente es la lista de filas en el
-- tiempo, no una "ficha única" que se sobreescribe.
CREATE TABLE IF NOT EXISTS recetas_opticas (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id            INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre        VARCHAR(200) NOT NULL,
  esfera_od             NUMERIC(4,2),
  cilindro_od           NUMERIC(4,2),
  eje_od                INTEGER,
  esfera_oi             NUMERIC(4,2),
  cilindro_oi           NUMERIC(4,2),
  eje_oi                INTEGER,
  adicion               NUMERIC(3,2),
  distancia_pupilar     NUMERIC(4,1),
  diagnostico           TEXT,
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ordenes_laboratorio: seguimiento armazón/lente, pedido -> laboratorio ->
-- listo -> entregado (del PDF, literal). receta_id opcional -- una orden
-- puede no venir de un examen registrado en el sistema (ej. reposición de
-- un lente roto con la misma receta de siempre, sin nuevo examen).
CREATE TABLE IF NOT EXISTS ordenes_laboratorio (
  id                       SERIAL PRIMARY KEY,
  empresa_id               INTEGER NOT NULL REFERENCES empresas(id),
  fecha                    DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id               INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre           VARCHAR(200) NOT NULL,
  receta_id                INTEGER REFERENCES recetas_opticas(id),
  armazon                  VARCHAR(200),
  tipo_lente               VARCHAR(20) CHECK (tipo_lente IN ('monofocal','bifocal','progresivo','contacto')),
  laboratorio              VARCHAR(150),
  costo                    NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                   VARCHAR(20) NOT NULL DEFAULT 'pedido'
                              CHECK (estado IN ('pedido','en_laboratorio','listo','entregado','cancelado')),
  fecha_estimada_entrega   DATE,
  garantia_hasta           DATE,
  notas                    TEXT,
  creado_el                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- seguros_vision: mismo patrón que seguros_dentales.
CREATE TABLE IF NOT EXISTS seguros_vision (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  cliente_id            INTEGER NOT NULL REFERENCES clientes(id),
  cliente_nombre        VARCHAR(200) NOT NULL,
  aseguradora           VARCHAR(150) NOT NULL,
  numero_poliza         VARCHAR(80),
  orden_id              INTEGER REFERENCES ordenes_laboratorio(id),
  orden_descripcion     VARCHAR(250),
  monto_reclamado       NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto_cubierto        NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado                VARCHAR(20) NOT NULL DEFAULT 'enviado'
                           CHECK (estado IN ('enviado','en_revision','aprobado','rechazado','pagado')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recetas_opt_empresa     ON recetas_opticas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_recetas_opt_fecha        ON recetas_opticas (fecha);
CREATE INDEX IF NOT EXISTS idx_recetas_opt_cliente       ON recetas_opticas (cliente_id);

CREATE INDEX IF NOT EXISTS idx_ordenes_lab_empresa      ON ordenes_laboratorio (empresa_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_lab_fecha        ON ordenes_laboratorio (fecha);
CREATE INDEX IF NOT EXISTS idx_ordenes_lab_cliente      ON ordenes_laboratorio (cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_lab_receta       ON ordenes_laboratorio (receta_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_lab_estado       ON ordenes_laboratorio (estado);

CREATE INDEX IF NOT EXISTS idx_seguros_vis_empresa      ON seguros_vision (empresa_id);
CREATE INDEX IF NOT EXISTS idx_seguros_vis_fecha        ON seguros_vision (fecha);
CREATE INDEX IF NOT EXISTS idx_seguros_vis_cliente      ON seguros_vision (cliente_id);
CREATE INDEX IF NOT EXISTS idx_seguros_vis_orden        ON seguros_vision (orden_id);
CREATE INDEX IF NOT EXISTS idx_seguros_vis_estado       ON seguros_vision (estado);

ALTER TABLE recetas_opticas     ENABLE ROW LEVEL SECURITY; ALTER TABLE recetas_opticas     FORCE ROW LEVEL SECURITY;
ALTER TABLE ordenes_laboratorio ENABLE ROW LEVEL SECURITY; ALTER TABLE ordenes_laboratorio FORCE ROW LEVEL SECURITY;
ALTER TABLE seguros_vision      ENABLE ROW LEVEL SECURITY; ALTER TABLE seguros_vision      FORCE ROW LEVEL SECURITY;

INSERT INTO modulos (id, label, icon, page, base_de_datos) VALUES
  ('recetas_opticas',     'Recetas Ópticas',       '👓', 'recetas-opticas.html',     true),
  ('ordenes_laboratorio', 'Órdenes de Laboratorio', '🔬', 'ordenes-laboratorio.html', true),
  ('seguros_vision',      'Seguros de Visión',      '🛡️', 'seguros-vision.html',      true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('recetas_opticas'), ('ordenes_laboratorio'), ('seguros_vision')) AS m(modulo)
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
  WHERE nombre LIKE 'recetas_opticas.%' OR nombre LIKE 'ordenes_laboratorio.%' OR nombre LIKE 'seguros_vision.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'recetas_opticas.ver','recetas_opticas.crear','recetas_opticas.editar',
    'ordenes_laboratorio.ver','ordenes_laboratorio.crear','ordenes_laboratorio.editar',
    'seguros_vision.ver','seguros_vision.crear','seguros_vision.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('recetas_opticas.ver','ordenes_laboratorio.ver','seguros_vision.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Oculista en una empresa (reemplaza el id):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'recetas_opticas'), (N, 'ordenes_laboratorio'), (N, 'seguros_vision'), (N, 'agenda')
--   ON CONFLICT DO NOTHING;
