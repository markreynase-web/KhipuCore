-- Sub-fase B (Sucursal + Caja/Turno): cierre del diseño original que la
-- migración 036 dejó pendiente a propósito. En ese momento, inventario.js
-- (POST) y crearProducto() del fixture de tests todavía no llenaban
-- sucursal_id -- ponerlo NOT NULL entonces habría roto la creación de
-- productos de inmediato. Ahora sí:
--   - POST /api/inventario exige sucursal_id (src/routes/inventario.js).
--   - POST /api/inventario/import (CSV) resuelve sucursal_id por fila,
--     con la sucursal principal como default.
--   - tests/helpers/fixtures.js -> crearProducto() siempre la completa.
-- El backfill de 036 ya garantizó que ninguna fila existente quedó en null
-- (verificado en TEST_DATABASE_URL y en producción antes de esta
-- migración), así que este ALTER es seguro.

ALTER TABLE inventario ALTER COLUMN sucursal_id SET NOT NULL;
