# Fase 5: Ventas ↔ Inventario ↔ Clientes ↔ Finanzas conectados

## Cómo aplicar esto
1. Copia estos archivos encima de los tuyos, respetando las carpetas (pisan
   los que ya tenías en esas rutas).
2. En `/backend`, corre `npm run migrate` para aplicar la migración 008
   (crea la tabla `finanzas`, agrega `producto_id`/`cliente_id` a `ventas`,
   y da permisos `finanzas.*` a los roles admin/gerente).
3. Reinicia el backend (`npm run dev`) y recarga el frontend.

## Qué cambió

**Backend**
- `migrations/008_...sql`: relaciona `ventas.producto_id → inventario.id` y
  `ventas.cliente_id → clientes.id`; crea la tabla `finanzas`.
- `routes/ventas.js`: ya no usa el CRUD genérico. Ahora, al crear una venta:
  valida stock con `SELECT ... FOR UPDATE` (evita que dos ventas simultáneas
  pasen la validación con el mismo stock viejo), descuenta el inventario,
  inserta el ingreso en `finanzas`, y suma a `compras_totales` del cliente —
  todo en una sola transacción (si algo falla, se revierte todo). Al anular
  una venta (`DELETE`), devuelve el stock y borra el movimiento en finanzas.
- `routes/finanzas.js`: CRUD para movimientos manuales (gastos, ajustes). Los
  movimientos que vienen de una venta no se pueden editar/borrar ahí
  directamente — hay que anular la venta en Ventas.
- `server.js`: monta `/api/finanzas`.

**Frontend**
- `js/esquemas.js`: en Ventas, "Producto" y "Cliente" pasan de texto libre a
  `<select>` conectados; agregado el esquema de `finanzas`.
- `components/formularioRegistro.js`: soporta campos `type:'select'`, muestra
  "Disponible: N unidades" al elegir un producto, limita la cantidad máxima
  en el propio formulario (antes de mandar nada al backend), y agrega el
  botón "+ Nuevo cliente".
- `js/app.js`: al abrir "Nueva venta", pide productos y clientes frescos al
  backend para llenar los selects; "+ Nuevo cliente" abre el formulario de
  Clientes sin perder lo ya llenado, y al guardar vuelve a la venta con la
  lista de clientes actualizada.
- `js/api.js` / `js/modoBackend.js`: ahora se conserva el mensaje de error
  real del backend (ej. "Stock insuficiente: quedan 3 unidad(es)...") en vez
  de perderse — así la alerta que ves en pantalla es la del servidor, no un
  mensaje genérico.
- `components/tablaRegistros.js`: las columnas que ahora vienen de la
  relación (cliente, producto, categoría, precio, monto en Ventas) ya no se
  pueden editar como texto libre inline; y en Inventario, las filas con
  `stock <= stock_minimo` se resaltan con un badge "⚠ bajo".
- `css/forms.css`: estilos para el `<select>`, la ayuda de stock y el badge
  de alerta.
- `config/company.json`: Finanzas pasa a `baseDeDatos: true`.

**Ajuste posterior — permisos del rol Ventas**
`migrations/009_permisos_vendedor.sql`: tras conectar Ventas con Inventario y
Clientes se detectaron dos huecos de permisos para el rol `ventas`:
- `inventario.ver` — el select de "Producto" en el formulario de venta pega
  contra `GET /api/inventario`; sin este permiso devolvía 403 y el select
  quedaba vacío.
- `clientes.crear` — el botón "+ Nuevo cliente" del formulario de venta llama
  a `POST /api/clientes`, que el rol ventas no tenía (solo `clientes.ver`).

A propósito no se le da `inventario.crear/editar/eliminar` ni
`clientes.eliminar`: el vendedor solo necesita leer el catálogo y registrar
clientes nuevos al vender, no modificarlos ni borrarlos.

## Pendiente para completar la Fase 5 (no incluido aquí)
- Costo vs. precio de venta en Inventario, para que Finanzas calcule utilidad
  real y no solo ingresos.
- Kardex/historial de movimientos de inventario (por ahora solo ves el stock
  actual, no el rastro de cada entrada/salida).
- Reportes de Compras conectados a Inventario (entradas de stock por compra).
