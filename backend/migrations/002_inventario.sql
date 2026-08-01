CREATE TABLE IF NOT EXISTS inventario (
  id               SERIAL PRIMARY KEY,
  fecha_registro   DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre           VARCHAR(200) NOT NULL,
  categoria        VARCHAR(120),
  stock            NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_minimo     NUMERIC(12,2) NOT NULL DEFAULT 0,
  precio_unitario  NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas            TEXT,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventario_fecha ON inventario (fecha_registro);
