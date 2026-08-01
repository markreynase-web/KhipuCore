-- Roles y permisos (Fase 4.2 / 4.3).
-- En vez de "if(usuario.rol=='admin')" en cada ruta, cada rol tiene una lista
-- de permisos (ej. 'ventas.eliminar'), y el middleware verificarPermiso()
-- solo pregunta: ¿el rol de este usuario tiene ese permiso? Agregar un módulo
-- nuevo no toca el middleware, solo agrega filas a "permisos" y "rol_permiso".

CREATE TABLE IF NOT EXISTS roles (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS permisos (
  id     SERIAL PRIMARY KEY,
  nombre VARCHAR(80) NOT NULL UNIQUE -- ej. 'ventas.ver', 'ventas.eliminar'
);

CREATE TABLE IF NOT EXISTS rol_permiso (
  rol_id     INTEGER NOT NULL REFERENCES roles(id)     ON DELETE CASCADE,
  permiso_id INTEGER NOT NULL REFERENCES permisos(id)  ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_id)
);

-- usuarios.rol (texto) se queda para no romper nada que ya la use, pero deja
-- de ser la fuente de verdad: rol_id es la relación real de aquí en adelante.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_id INTEGER REFERENCES roles(id);

-- Roles base sugeridos en la Fase 4 (más flexible que solo Admin/Usuario).
INSERT INTO roles (nombre) VALUES
  ('administrador'), ('gerente'), ('ventas'), ('inventario'), ('supervisor'), ('consulta')
ON CONFLICT (nombre) DO NOTHING;

-- Un permiso por acción x módulo. Los módulos con backend hoy son
-- ventas/inventario/clientes; se agregan usuarios (gestión de cuentas) y
-- auditoria (ver el registro de actividad, Fase 4 + imagen del audit log).
INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('ventas'), ('inventario'), ('clientes')) AS m(modulo)
CROSS JOIN (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO permisos (nombre) VALUES
  ('usuarios.ver'), ('usuarios.crear'), ('usuarios.editar'),
  ('auditoria.ver')
ON CONFLICT (nombre) DO NOTHING;

-- Asignación por defecto. Un cliente real puede reconfigurar rol_permiso
-- desde la pantalla de Usuarios sin tocar código.
DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_ventas     INTEGER := (SELECT id FROM roles WHERE nombre = 'ventas');
  r_inventario INTEGER := (SELECT id FROM roles WHERE nombre = 'inventario');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
  r_consulta   INTEGER := (SELECT id FROM roles WHERE nombre = 'consulta');
BEGIN
  -- Administrador: todo.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos
  ON CONFLICT DO NOTHING;

  -- Gerente: ver/crear/editar en todo, sin eliminar ni gestión de usuarios.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre LIKE '%.ver' OR nombre LIKE '%.crear' OR nombre LIKE '%.editar'
     OR nombre = 'auditoria.ver'
  ON CONFLICT DO NOTHING;

  -- Ventas: su módulo completo + solo ver clientes.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_ventas, id FROM permisos
  WHERE nombre LIKE 'ventas.%' OR nombre = 'clientes.ver'
  ON CONFLICT DO NOTHING;

  -- Inventario: su módulo completo.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_inventario, id FROM permisos
  WHERE nombre LIKE 'inventario.%'
  ON CONFLICT DO NOTHING;

  -- Supervisor: solo ver, en todos los módulos de datos + auditoría.
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_supervisor, id FROM permisos
  WHERE nombre LIKE '%.ver'
  ON CONFLICT DO NOTHING;

  -- Consulta: solo ver ventas/inventario/clientes (sin auditoría ni usuarios).
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_consulta, id FROM permisos
  WHERE nombre IN ('ventas.ver', 'inventario.ver', 'clientes.ver')
  ON CONFLICT DO NOTHING;
END $$;

-- Migra usuarios existentes: su columna "rol" (texto) pasa a apuntar al rol_id
-- correspondiente; si el texto no calza con ningún rol conocido, cae a 'consulta'
-- (el rol menos privilegiado) para no dejar a nadie con permisos de más por accidente.
UPDATE usuarios u
SET rol_id = COALESCE(
  (SELECT id FROM roles WHERE nombre = u.rol),
  (SELECT id FROM roles WHERE nombre = 'consulta')
)
WHERE rol_id IS NULL;

ALTER TABLE usuarios ALTER COLUMN rol_id SET NOT NULL;
