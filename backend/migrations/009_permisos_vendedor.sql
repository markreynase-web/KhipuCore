-- Ajuste de permisos del rol "ventas" (el "vendedor").
--
-- Se detectaron dos huecos desde que Ventas quedó conectado a Inventario y
-- Clientes (Fase 5):
--
-- 1. El formulario de "Nueva venta" necesita listar productos (con su
--    stock) y clientes -- eso pega contra GET /api/inventario y
--    GET /api/clientes, protegidos por 'inventario.ver' y 'clientes.ver'.
--    El rol ventas nunca tuvo 'inventario.ver', así que ese GET le devolvía
--    403 y el select de "Producto" (y por lo tanto "Categoría", que se arma
--    a partir de la lista de productos) le quedaba vacío. NO se le da
--    'inventario.crear/editar/eliminar' -- solo necesita LEER el catálogo
--    para vender, no modificarlo.
--
-- 2. El botón "+ Nuevo cliente" dentro del formulario de venta llama a
--    POST /api/clientes, protegido por 'clientes.crear', que el rol ventas
--    tampoco tenía (solo 'clientes.ver'). Se le da 'clientes.crear' pero
--    a propósito NO 'clientes.eliminar' -- un vendedor puede registrar un
--    cliente nuevo en el momento de la venta, pero borrar clientes queda
--    para gerencia/administración.

DO $$
DECLARE
  r_ventas INTEGER := (SELECT id FROM roles WHERE nombre = 'ventas');
BEGIN
  INSERT INTO rol_permiso (rol_id, permiso_id)
  SELECT r_ventas, id FROM permisos
  WHERE nombre IN ('inventario.ver', 'clientes.crear')
  ON CONFLICT DO NOTHING;
END $$;
