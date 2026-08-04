-- Fase A: el rol de un usuario ahora vive en usuario_empresa.rol_id (rol
-- POR empresa, ver 012_empresas.sql), no en usuarios.rol_id (que era un
-- solo rol global por cuenta). usuarios.rol_id se queda en la tabla por
-- compatibilidad (no se borra todavía, ver notas de Fase A) pero deja de
-- ser obligatorio: las cuentas nuevas ya no lo escriben.
ALTER TABLE usuarios ALTER COLUMN rol_id DROP NOT NULL;
