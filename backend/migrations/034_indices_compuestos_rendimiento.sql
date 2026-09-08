-- Fase 3, Eje A (Escalabilidad) -- Sub-bloque A2: índices compuestos para
-- las tablas de mayor volumen. Hasta ahora, ventas/inventario/finanzas
-- tenían dos índices de una sola columna cada una (empresa_id por un lado,
-- la columna de fecha por otro -- ver 012_empresas.sql / 001_ventas.sql /
-- 002_inventario.sql / 008_ventas_inventario_clientes_finanzas.sql).
-- Postgres puede combinarlos (Bitmap AND), pero un índice compuesto
-- (empresa_id, fecha DESC, id DESC) cubre en un solo recorrido tanto el
-- filtro (WHERE empresa_id=$1) como el orden (ORDER BY fecha DESC, id DESC)
-- que ya usan estos tres GET / (ver ventas.js, finanzas.js y crudFactory.js),
-- sin un paso de sort aparte.
--
-- Columna de fecha usada en cada índice: la MISMA que cada GET / usa hoy en
-- su ORDER BY, verificada contra el código real, no asumida:
--   - ventas.js:74     ORDER BY fecha DESC, id DESC
--   - finanzas.js:36   ORDER BY fecha DESC, id DESC
--   - inventario.js -> crudFactory.js con columnaFecha: 'fecha_registro'
--     (routes/inventario.js), no "creado_el" -- fecha_registro es la
--     columna que de verdad se usa en el ORDER BY de su GET /.
--
-- Los índices de una sola columna que ya existían (idx_ventas_empresa,
-- idx_ventas_fecha, idx_inventario_empresa, idx_inventario_fecha,
-- idx_finanzas_empresa, idx_finanzas_fecha) NO se tocan ni se borran acá --
-- siguen siendo útiles para otras consultas que filtran por una sola de
-- esas columnas (ej. reportes por rango de fecha sin filtrar por empresa
-- en un contexto de super admin). Esto es aditivo, no un reemplazo.
CREATE INDEX IF NOT EXISTS idx_ventas_empresa_fecha     ON ventas     (empresa_id, fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventario_empresa_fecha ON inventario (empresa_id, fecha_registro DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_finanzas_empresa_fecha   ON finanzas   (empresa_id, fecha DESC, id DESC);
