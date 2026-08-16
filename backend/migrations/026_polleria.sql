-- Vertical Pollería/restaurante. Mesas y Comandas reutilizan el MISMO
-- patrón de máquina de estados que ya se probó en Postventa (Automotriz) y
-- Órdenes de Laboratorio (Óptica) -- pendiente -> en_preparacion -> listo ->
-- entregado, con cancelado como salida alterna. Comandas también reutiliza
-- el patrón de descuento de stock de Ventas/Postventa (FOR UPDATE +
-- ajuste en PUT/DELETE), pero sin crear un ingreso automático en Finanzas
-- (mismo criterio que Postventa: el cobro real se registra aparte).
--
-- Combos es la pieza genuinamente nueva del vertical: una fila de
-- combo_ventas descuenta VARIOS productos de inventario en una sola
-- transacción (combos.items es la lista de qué productos y cuántos
-- componen el combo) -- eso no existe en ningún otro módulo hoy, donde
-- cada movimiento de stock es siempre de un solo producto.
--
-- mesas: sin FK a otro módulo, catálogo simple.
CREATE TABLE IF NOT EXISTS mesas (
  id             SERIAL PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id),
  numero         INTEGER NOT NULL,
  zona           VARCHAR(50),
  capacidad      INTEGER,
  estado         VARCHAR(20) NOT NULL DEFAULT 'libre'
                    CHECK (estado IN ('libre','ocupada','reservada','en_limpieza')),
  notas          TEXT,
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- comandas: un plato pedido en una mesa. producto_id NOT NULL (reutiliza el
-- catálogo de `inventario`, igual que ventas.producto_id) -- el stock se
-- descuenta al crear la comanda, se ajusta si cambia la cantidad, y se
-- devuelve si se borra (mismo patrón que ventas.js/postventa.js).
CREATE TABLE IF NOT EXISTS comandas (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  mesa_id           INTEGER NOT NULL REFERENCES mesas(id),
  mesa_numero       INTEGER NOT NULL,
  producto_id       INTEGER NOT NULL REFERENCES inventario(id),
  producto_nombre   VARCHAR(200) NOT NULL,
  cantidad          NUMERIC(10,2) NOT NULL DEFAULT 1,
  precio_unitario   NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto             NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente','en_preparacion','listo','entregado','cancelado')),
  notas             TEXT,
  creado_el         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- combos: la RECETA del combo -- qué productos de inventario lo componen y
-- en qué cantidad. `items` es JSONB (mismo tipo de dato que ya usa
-- audit_log.detalle en este proyecto) en vez de una tabla puente, porque es
-- una lista corta que siempre se lee/escribe completa junto con el combo,
-- nunca se consulta producto por producto -- una tabla aparte solo
-- agregaría un JOIN sin necesidad real.
-- Forma de cada elemento: {"producto_id": 12, "producto_nombre": "Papas",
-- "cantidad": 2}. producto_nombre queda congelado (snapshot) al guardar el
-- combo, igual que en el resto de la app.
CREATE TABLE IF NOT EXISTS combos (
  id             SERIAL PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id),
  nombre         VARCHAR(150) NOT NULL,
  descripcion    TEXT,
  precio         NUMERIC(12,2) NOT NULL DEFAULT 0,
  items          JSONB NOT NULL DEFAULT '[]',
  estado         VARCHAR(20) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','inactivo')),
  notas          TEXT,
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- combo_ventas: vender N combos descuenta, en una sola transacción,
-- cantidad × combo.items[i].cantidad de CADA producto de la receta (ver
-- routes/comboVentas.js) -- la pieza que el resto de la app no tiene.
-- mesa_id es OPCIONAL (a diferencia de comandas.mesa_id) porque un combo
-- se puede vender para llevar, sin mesa asociada.
CREATE TABLE IF NOT EXISTS combo_ventas (
  id                SERIAL PRIMARY KEY,
  empresa_id        INTEGER NOT NULL REFERENCES empresas(id),
  fecha             DATE NOT NULL DEFAULT CURRENT_DATE,
  combo_id          INTEGER NOT NULL REFERENCES combos(id),
  combo_nombre      VARCHAR(150) NOT NULL,
  mesa_id           INTEGER REFERENCES mesas(id),
  mesa_numero       INTEGER,
  cantidad          NUMERIC(10,2) NOT NULL DEFAULT 1,
  precio_unitario   NUMERIC(12,2) NOT NULL DEFAULT 0,
  monto             NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                       CHECK (estado IN ('pendiente','en_preparacion','listo','entregado','cancelado')),
  notas             TEXT,
  creado_el         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_el    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mesas_empresa          ON mesas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_mesas_estado            ON mesas (estado);

CREATE INDEX IF NOT EXISTS idx_comandas_empresa        ON comandas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_comandas_fecha          ON comandas (fecha);
CREATE INDEX IF NOT EXISTS idx_comandas_mesa            ON comandas (mesa_id);
CREATE INDEX IF NOT EXISTS idx_comandas_producto         ON comandas (producto_id);
CREATE INDEX IF NOT EXISTS idx_comandas_estado           ON comandas (estado);

CREATE INDEX IF NOT EXISTS idx_combos_empresa          ON combos (empresa_id);
CREATE INDEX IF NOT EXISTS idx_combos_estado            ON combos (estado);

CREATE INDEX IF NOT EXISTS idx_combo_ventas_empresa    ON combo_ventas (empresa_id);
CREATE INDEX IF NOT EXISTS idx_combo_ventas_fecha       ON combo_ventas (fecha);
CREATE INDEX IF NOT EXISTS idx_combo_ventas_combo        ON combo_ventas (combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_ventas_mesa         ON combo_ventas (mesa_id);
CREATE INDEX IF NOT EXISTS idx_combo_ventas_estado       ON combo_ventas (estado);

ALTER TABLE mesas        ENABLE ROW LEVEL SECURITY; ALTER TABLE mesas        FORCE ROW LEVEL SECURITY;
ALTER TABLE comandas     ENABLE ROW LEVEL SECURITY; ALTER TABLE comandas     FORCE ROW LEVEL SECURITY;
ALTER TABLE combos       ENABLE ROW LEVEL SECURITY; ALTER TABLE combos       FORCE ROW LEVEL SECURITY;
ALTER TABLE combo_ventas ENABLE ROW LEVEL SECURITY; ALTER TABLE combo_ventas FORCE ROW LEVEL SECURITY;

-- dependencias (ver 023_dependencias_modulos.sql): comandas exige mesa_id Y
-- producto_id NOT NULL -- depende de "mesas" e "inventario". combos.items
-- es JSONB (no hay FK real que forzar a nivel de base), pero sin
-- "inventario" habilitado no hay de dónde elegir productos para armar la
-- receta -- se declara la dependencia igual, aunque no sea forzable con una
-- FK, por el mismo motivo práctico que ya se documentó para postventa.
-- combo_ventas exige combo_id NOT NULL; mesa_id es opcional (para llevar),
-- así que no depende de "mesas".
INSERT INTO modulos (id, label, icon, page, base_de_datos, dependencias) VALUES
  ('mesas',        'Mesas',        '🍽️', 'mesas.html',        true, '{}'),
  ('comandas',     'Comandas',     '🧾', 'comandas.html',     true, ARRAY['mesas','inventario']),
  ('combos',       'Combos',       '🍱', 'combos.html',       true, ARRAY['inventario']),
  ('combo_ventas', 'Venta de Combos', '🛍️', 'combo-ventas.html', true, ARRAY['combos'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO permisos (nombre)
SELECT modulo || '.' || accion
FROM (VALUES ('mesas'), ('comandas'), ('combos'), ('combo_ventas')) AS m(modulo)
CROSS JOIN (VALUES ('ver'), ('crear'), ('editar'), ('eliminar')) AS a(accion)
ON CONFLICT (nombre) DO NOTHING;

DO $$
DECLARE
  r_admin      INTEGER := (SELECT id FROM roles WHERE nombre = 'administrador');
  r_gerente    INTEGER := (SELECT id FROM roles WHERE nombre = 'gerente');
  r_supervisor INTEGER := (SELECT id FROM roles WHERE nombre = 'supervisor');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_admin, id FROM permisos
  WHERE nombre LIKE 'mesas.%' OR nombre LIKE 'comandas.%' OR nombre LIKE 'combos.%' OR nombre LIKE 'combo_ventas.%'
  ON CONFLICT DO NOTHING;

  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_gerente, id FROM permisos
  WHERE nombre IN (
    'mesas.ver','mesas.crear','mesas.editar',
    'comandas.ver','comandas.crear','comandas.editar',
    'combos.ver','combos.crear','combos.editar',
    'combo_ventas.ver','combo_ventas.crear','combo_ventas.editar'
  )
  ON CONFLICT DO NOTHING;

  IF r_supervisor IS NOT NULL THEN
    INSERT INTO rol_permiso (rol_id, permiso_id)
    SELECT r_supervisor, id FROM permisos
    WHERE nombre IN ('mesas.ver','comandas.ver','combos.ver','combo_ventas.ver')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Para habilitar el vertical Pollería/Restaurante en una empresa (reemplaza
-- el id; respeta las dependencias -- inventario y clientes/finanzas del
-- núcleo deben ir junto con estos):
--   INSERT INTO empresa_modulos (empresa_id, modulo_id) VALUES
--     (N, 'inventario'), (N, 'finanzas'), (N, 'mesas'), (N, 'comandas'),
--     (N, 'combos'), (N, 'combo_ventas')
--   ON CONFLICT DO NOTHING;
