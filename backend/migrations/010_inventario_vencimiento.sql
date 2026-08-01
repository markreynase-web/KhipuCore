-- Fecha de vencimiento opcional por producto (no todo lo que se vende
-- vence -- ej. útiles escolares -- así que se deja nullable). Alimenta la
-- tarjeta "Próximos vencimientos" del panel de Inicio.

ALTER TABLE inventario ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;

CREATE INDEX IF NOT EXISTS idx_inventario_vencimiento ON inventario (fecha_vencimiento);
