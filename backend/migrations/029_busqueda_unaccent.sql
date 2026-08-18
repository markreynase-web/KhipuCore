-- Habilita la extensión "unaccent" de PostgreSQL: permite que una búsqueda
-- de "costeno" encuentre "Costeño" (ignora tildes/diéresis en la comparación).
-- La usa GET /:modulo?buscar=... en crudFactory.js -- pensada primero para
-- el buscador de productos al crear una venta (ver comboboxBusqueda.js),
-- pero queda disponible para cualquier módulo que declare columnasBusqueda.
--
-- Es una extensión estándar de Postgres (contrib), no algo propio de
-- Supabase -- si el día de mañana se cambia de proveedor de base de datos,
-- esta misma línea sigue funcionando igual.
CREATE EXTENSION IF NOT EXISTS unaccent;
