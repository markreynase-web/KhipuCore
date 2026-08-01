-- Registro de actividad (audit log). Se llena solo desde crudFactory.js en
-- cada crear/editar/borrar/importar exitoso -- no depende de que cada ruta
-- se acuerde de escribirlo a mano.
--
-- usuario_nombre queda "congelado" al momento del evento a propósito: si el
-- usuario se borra o cambia de nombre después, el historial ("Ana eliminó
-- cliente") no debe cambiar ni desaparecer.
CREATE TABLE IF NOT EXISTS audit_log (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER,
  usuario_nombre VARCHAR(150) NOT NULL,
  accion         VARCHAR(20)  NOT NULL, -- crear | editar | eliminar | importar
  modulo         VARCHAR(40)  NOT NULL, -- ventas | inventario | clientes | ...
  registro_id    VARCHAR(40),           -- id de la fila afectada (si aplica)
  detalle        JSONB,                 -- ej. {"insertadas": 12, "errores": 0}
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_modulo_fecha ON audit_log (modulo, creado_el DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_usuario ON audit_log (usuario_id, creado_el DESC);
