-- Sub-fase D (roadmap competitivo, Nivel 2): restricción usuario-por-
-- sucursal. Un usuario puede quedar atado a UNA sola sucursal -- a partir
-- de ahí, ve y opera solo ahí en ventas/inventario/finanzas (ver
-- middleware/sucursal.js). NULL (el default, nadie lo pierde) = sin
-- restricción, ve/opera en todas las sucursales de la empresa -- así queda
-- automáticamente cualquier usuario que ya existe hoy.
--
-- A diferencia de inventario.sucursal_id (que pasó a NOT NULL en la
-- migración 038), esta columna queda nullable PARA SIEMPRE: NULL es un
-- estado funcional permanente (el admin/gerente que ve todo), no una
-- transición de datos legados.

ALTER TABLE usuario_empresa ADD COLUMN IF NOT EXISTS sucursal_id INTEGER REFERENCES sucursales(id);
CREATE INDEX IF NOT EXISTS idx_usuario_empresa_sucursal ON usuario_empresa (sucursal_id);
