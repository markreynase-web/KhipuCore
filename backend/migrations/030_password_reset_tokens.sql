-- Recuperación de contraseña. Tabla nueva porque no existía nada
-- equivalente: `usuarios` no tenía ningún mecanismo de token temporal.
--
-- token_hash guarda sha256(token), nunca el token en texto plano -- el token
-- real solo existe en el correo que recibe el usuario y en la URL que abre;
-- si esta tabla se filtrara algún día, el hash guardado no sirve para
-- "adivinar" el token original y tomar una cuenta.
--
-- used_at + expires_at son lo que hace al token de un solo uso y temporal
-- (ver backend/src/routes/auth.js: un token solo es válido si
-- used_at IS NULL AND expires_at > now()). No se borra la fila al usarla --
-- queda como registro de que ese token existió y se consumió, en vez de
-- desaparecer sin dejar rastro.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  VARCHAR(64) NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  creado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_usuario ON password_reset_tokens (usuario_id);

-- Mismo patrón deny-by-default que el resto de las tablas (ver
-- 007_supabase_rls.sql): bloquea el acceso directo vía PostgREST/anon key.
-- El backend sigue siendo quien de verdad valida el token, con su propio
-- rol con BYPASSRLS (igual que todas las demás tablas).
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY;
