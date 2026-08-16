-- Dependencias entre módulos: hasta ahora, activar un módulo en Super Admin
-- no comprobaba nada del resto del catálogo. En la práctica casi todas las
-- relaciones entre verticales ya son opcionales A PROPÓSITO en el esquema
-- (ver 020_dentista.sql / 021_oculista.sql: tratamiento_id, receta_id,
-- orden_id son todos REFERENCES nullable, para no obligar a un examen o
-- tratamiento previo registrado en el sistema) -- listar esas acá como
-- "dependencia" sería contradecir esa decisión de diseño ya tomada.
--
-- La única relación que sí es dura es postventa.vehiculo_id, que es
-- NOT NULL REFERENCES vehiculos(id) (014_vertical_automotriz.sql): una
-- orden de postventa sin vehículo no es un caso opcional, es un formulario
-- roto (el selector de vehículo saldría vacío). Esa es la única fila real
-- hoy; el array queda listo para que futuros módulos (ej. los rubros
-- nuevos del roadmap) declaren dependencias duras de verdad, sin tener que
-- volver a tocar el esquema.
ALTER TABLE modulos ADD COLUMN IF NOT EXISTS dependencias VARCHAR(40)[] NOT NULL DEFAULT '{}';

UPDATE modulos SET dependencias = ARRAY['vehiculos'] WHERE id = 'postventa';
