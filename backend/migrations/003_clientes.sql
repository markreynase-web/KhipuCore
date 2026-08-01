CREATE TABLE IF NOT EXISTS clientes (
  id                SERIAL PRIMARY KEY,
  fecha_registro    DATE NOT NULL DEFAULT CURRENT_DATE,
  nombre            VARCHAR(200) NOT NULL,
  email             VARCHAR(200),
  telefono          VARCHAR(60),
  direccion         VARCHAR(250),
  compras_totales   NUMERIC(14,2) NOT NULL DEFAULT 0,
  notas             TEXT,
  creado_el         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_fecha ON clientes (fecha_registro);
