-- Tabla del módulo de Ventas. Cada fila es una venta capturada desde el
-- formulario "Nueva venta" en el dashboard, o insertada por el importador de CSV.
CREATE TABLE IF NOT EXISTS ventas (
  id               SERIAL PRIMARY KEY,
  fecha            DATE NOT NULL,
  cliente          VARCHAR(200),
  producto         VARCHAR(200) NOT NULL,
  categoria        VARCHAR(120),
  cantidad         NUMERIC(12,2) NOT NULL DEFAULT 1,
  precio_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto            NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas            TEXT,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas (fecha);
