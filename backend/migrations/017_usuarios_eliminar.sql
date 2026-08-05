-- Agrega el permiso 'usuarios.eliminar', que nunca se creó en
-- 005_roles_permisos.sql (solo se crearon ver/crear/editar para usuarios).
--
-- Solo para "administrador": mismo criterio que el resto de la app -- en
-- 005_roles_permisos.sql, "gerente" recibe .ver/.crear/.editar de TODOS los
-- módulos pero explícitamente ningún .eliminar (ver el WHERE de esa
-- migración). "Eliminar" un usuario en este sistema significa quitarle su
-- membresía a la empresa activa (usuario_empresa), no borrar su identidad
-- global -- ver el DELETE en routes/usuarios.js.
INSERT INTO permisos (nombre) VALUES ('usuarios.eliminar')
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos WHERE nombre = 'usuarios.eliminar'
  ON CONFLICT DO NOTHING;
END $$;
