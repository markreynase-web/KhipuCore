-- El egreso automático de Inventario (ver routes/inventario.js) usaba
-- precio_unitario * stock como el "gasto" de surtir stock -- pero
-- precio_unitario es el precio de VENTA, no lo que costó comprarlo. Con
-- eso el egreso salía inflado y sin sentido de margen. costo_unitario es
-- el precio de compra real, separado del precio de venta.
ALTER TABLE inventario ADD COLUMN IF NOT EXISTS costo_unitario NUMERIC;
