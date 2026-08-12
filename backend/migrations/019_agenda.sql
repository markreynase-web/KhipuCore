-- Módulo Agenda/Citas: capacidad transversal que ningún vertical tenía
-- todavía (ni Automotriz) -- programar citas con un cliente, con detección
-- real de choque de horario en el servidor (no un checkbox decorativo).
-- Pensado para reutilizarse en cualquier rubro con agenda (dentista,
-- oculista, veterinaria, spa, taller) sin volver a construir esto cada vez.
--
-- vehiculo_id es OPCIONAL: solo tiene sentido para empresas con el vertical
-- Automotriz habilitado (ej. agendar un cambio de aceite). Para el resto de
-- los rubros (dentista, oculista, spa) queda simplemente NULL -- la columna
-- vive en el esquema siempre porque `vehiculos` ya existe en la base para
-- todas las empresas, aunque esté vacía si no usan ese vertical.
--
-- NO incluye envío real de recordatorios SMS/WhatsApp -- no existe ninguna
-- integración de mensajería en el backend todavía (Twilio o similar); eso
-- queda fuera de esta migración a propósito, para no prometer un campo que
-- no hace nada.

CREATE TABLE IF NOT EXISTS agenda (
  id                    SERIAL PRIMARY KEY,
  empresa_id            INTEGER NOT NULL REFERENCES empresas(id),
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  hora                  TIME NOT NULL,
  duracion_minutos      INTEGER NOT NULL DEFAULT 30,
  cliente_id            INTEGER NOT NULL REFERENCES clientes(id),
  -- "Foto" del nombre del cliente al momento de guardar -- mismo patrón que
  -- vehiculos.cliente_nombre/postventa.cliente_nombre (ver 014): el SELECT
  -- genérico de crudFactory no hace JOIN.
  cliente_nombre        VARCHAR(200) NOT NULL,
  motivo                VARCHAR(250) NOT NULL,
  vehiculo_id           INTEGER REFERENCES vehiculos(id),
  vehiculo_descripcion  VARCHAR(250),
  estado                VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente','confirmada','completada','cancelada','no_asistio')),
  notas                 TEXT,
  creado_el             TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agenda_empresa   ON agenda (empresa_id);
CREATE INDEX IF NOT EXISTS idx_agenda_fecha     ON agenda (fecha);
CREATE INDEX IF NOT EXISTS idx_agenda_cliente   ON agenda (cliente_id);
CREATE INDEX IF NOT EXISTS idx_agenda_vehiculo  ON agenda (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_agenda_estado    ON agenda (estado);
-- Acelera la consulta de choque de horario (mismo empresa_id + fecha,
-- filtrando por rango de hora) que corre en cada POST/PUT en agenda.js.
CREATE INDEX IF NOT EXISTS idx_agenda_empresa_fecha_hora ON agenda (empresa_id, fecha, hora);

ALTER TABLE agenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda FORCE ROW LEVEL SECURITY;

-- Catálogo de módulos (mismo patrón que 014). A propósito NO se inserta en
-- empresa_modulos para ninguna empresa existente -- opt-in por empresa vía
-- Super Admin, igual que el vertical Automotriz.
INSERT INTO modulos (id, label, icon, page, base_de_datos) VALUES
  ('agenda', 'Agenda', '📅', 'agenda.html', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT 'agenda.' || accion FROM (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos WHERE nombre LIKE 'agenda.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos WHERE nombre IN ('agenda.ver','agenda.crear','agenda.editar')
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos WHERE nombre = 'agenda.ver'
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar Agenda en una empresa concreta (reemplaza el id):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES (N, 'agenda')
--   ON CONFLICT DO NOTHING;
-- También se puede prender/apagar desde el panel de Super Admin (ya lee el
-- catálogo de `modulos` dinámicamente, no hace falta tocar su código).
