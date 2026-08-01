-- Tabla de usuarios. La columna "rol" ya existe pensando en los siguientes
-- pasos de la Fase 4 (Roles y Permisos), pero por ahora no se usa para
-- restringir nada — eso llega con el middleware de permisos.
CREATE TABLE IF NOT EXISTS usuarios (
  id               SERIAL PRIMARY KEY,
  nombre           VARCHAR(150) NOT NULL,
  email            VARCHAR(200) NOT NULL UNIQUE,
  password_hash    VARCHAR(200) NOT NULL,
  rol              VARCHAR(40) NOT NULL DEFAULT 'ventas',
  activo           BOOLEAN NOT NULL DEFAULT true,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);
