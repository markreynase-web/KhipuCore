-- Registro de eventos de PLATAFORMA de Super Admin -- acciones que no
-- pertenecen a ninguna empresa puntual (alta/edición/baja de un módulo en
-- el catálogo global). Separada de audit_log a propósito: audit_log.empresa_id
-- es NOT NULL porque cada fila ahí SIEMPRE debe pertenecer a un tenant real
-- (ver 012_empresas.sql) -- forzar un empresa_id inventado para un cambio
-- de catálogo sería falso y engañoso. Esta tabla nunca aparece en
-- GET /api/auditoria (que filtra por empresa_id): es exclusiva de Super Admin.
--
-- "entidad"/"entidad_id" en vez de "modulo"/"registro_id" (como en
-- audit_log) a propósito: acá "modulo" significaría literalmente "el
-- catálogo de módulos", que colisiona en significado con lo que audit_log
-- ya usa "modulo" para decir ("qué área de la app" -- ventas/superadmin/...).
-- Generalizado como entidad/entidad_id (no "modulo_catalogo" fijo) para no
-- necesitar otra migración el día que Super Admin gane otra acción de
-- plataforma que tampoco pertenezca a una empresa.
CREATE TABLE IF NOT EXISTS superadmin_audit_log (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER,
  usuario_nombre VARCHAR(150) NOT NULL,
  accion         VARCHAR(20)  NOT NULL, -- crear | editar | eliminar
  entidad        VARCHAR(40)  NOT NULL, -- modulo | (futuro)
  entidad_id     VARCHAR(40),
  detalle        JSONB,
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_superadmin_audit_log_fecha ON superadmin_audit_log (creado_el DESC);
CREATE INDEX IF NOT EXISTS idx_superadmin_audit_log_usuario ON superadmin_audit_log (usuario_id, creado_el DESC);
