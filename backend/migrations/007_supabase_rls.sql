-- Supabase expone automáticamente cada tabla como endpoint REST (PostgREST) en
-- https://<proyecto>.supabase.co/rest/v1/<tabla>, usando los roles "anon" y
-- "authenticated" -- protegido SOLO por Row Level Security (RLS). Como todo
-- este proyecto ya tiene su propio control de acceso en el backend Express
-- (auth() + verificarPermiso()), la API REST de Supabase debe quedar
-- completamente cerrada sobre estas tablas: la única puerta de entrada tiene
-- que ser nuestra API.
--
-- El backend se conecta con el rol "postgres" (o el que tenga BYPASSRLS), así
-- que activar RLS aquí NO afecta a crudFactory.js ni a ninguna ruta -- solo
-- bloquea el acceso directo vía anon/authenticated de PostgREST, que no tiene
-- BYPASSRLS. Al activar RLS sin crear ninguna política, el acceso para esos
-- roles queda denegado por completo (deny-by-default).
--
-- Si en el futuro se agrega Supabase Auth y se quiere que el frontend hable
-- directo con Supabase (sin pasar por el backend) para algún módulo puntual,
-- ahí sí habría que escribir políticas específicas para ese caso -- pero por
-- ahora eso no aplica a nada de lo construido en Fase 1-4.

ALTER TABLE ventas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE permisos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE rol_permiso  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log    ENABLE ROW LEVEL SECURITY;

-- FORCE ROW LEVEL SECURITY: por si en algún momento el dueño de estas tablas
-- termina siendo un rol sin BYPASSRLS (ej. si se migran con un usuario que no
-- es "postgres") -- así la restricción no depende de quién sea el owner.
ALTER TABLE ventas       FORCE ROW LEVEL SECURITY;
ALTER TABLE inventario   FORCE ROW LEVEL SECURITY;
ALTER TABLE clientes     FORCE ROW LEVEL SECURITY;
ALTER TABLE usuarios     FORCE ROW LEVEL SECURITY;
ALTER TABLE roles        FORCE ROW LEVEL SECURITY;
ALTER TABLE permisos     FORCE ROW LEVEL SECURITY;
ALTER TABLE rol_permiso  FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log    FORCE ROW LEVEL SECURITY;
