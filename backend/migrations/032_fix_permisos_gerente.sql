-- Corrige un bug real de 005_roles_permisos.sql: el filtro
-- `LIKE '%.crear' OR LIKE '%.editar'` que le da a "gerente" acceso de
-- creación/edición en todos los módulos también capturó, sin querer,
-- usuarios.crear y usuarios.editar -- contradiciendo el propio comentario de
-- esa migración ("Gerente: ... sin eliminar ni gestión de usuarios").
--
-- Con esos dos permisos, un gerente podía crear una cuenta con rol
-- administrador, o editar su propio usuario para asignarse ese rol, vía la
-- API normal de /api/usuarios -- confirmado leyendo el código, no es
-- hipotético. El fix de aplicación (bloquear asignar "administrador" salvo
-- que quien llama ya lo sea, y bloquear que alguien cambie su propio rol) se
-- aplica en routes/usuarios.js; esta migración cierra el origen del
-- problema en el modelo de datos.
--
-- Es seguro correr esto más de una vez: un DELETE sobre una fila que ya no
-- existe simplemente no hace nada.
DELETE FROM rol_permiso
WHERE rol_id = (SELECT id FROM roles WHERE nombre = 'gerente')
  AND permiso_id IN (SELECT id FROM permisos WHERE nombre IN ('usuarios.crear', 'usuarios.editar'));
