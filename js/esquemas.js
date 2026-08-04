// js/esquemas.js
// Un esquema por módulo conectado a base de datos: de aquí sale el formulario
// de captura, la tabla con editar/borrar, y el mapeo hacia el motor de
// dashboard genérico (dashboard.js) que ya existía desde la Fase 1.
//
// Migrar un módulo nuevo a base de datos es, del lado del frontend: agregar
// su entrada aquí + su tabla/rutas en el backend (ver backend/src/routes/).
// Nada más necesita cambiar.

export const ESQUEMAS = {
  ventas: {
    etiqueta: 'venta',
    campos: [
      { id: 'fecha', label: 'Fecha', type: 'date', required: true },
      // 'cliente_id' y 'producto_id' son selects: sus opciones NO se listan
      // aquí (son estáticas para todos), sino que app.js las llena en el
      // momento de abrir el formulario, pidiéndolas frescas al backend
      // (GET /clientes, GET /inventario). Ver poblarSelectsVentas() en app.js.
      { id: 'cliente_id', label: 'Cliente', type: 'select', required: true, fuente: 'clientes',
        vacio: 'Selecciona un cliente…', accionExtra: { texto: '+ Nuevo cliente', evento: 'nuevoCliente' } },
      { id: 'producto_id', label: 'Producto', type: 'select', required: true, fuente: 'inventario',
        vacio: 'Selecciona un producto…', ayudaStock: true, sugiere: ['categoria', 'precio_unitario'] },
      // categoria/precio_unitario: vueltos a ser MANUALES a pedido (antes se
      // tomaban solos del catálogo). Al elegir un producto se sugieren con
      // los valores de su ficha en Inventario (ver 'sugiere' arriba y su uso
      // en components/formularioRegistro.js), pero quedan editables.
      { id: 'categoria', label: 'Categoría', type: 'select', fuente: 'categoriasInventario', vacio: 'Selecciona una categoría…' },
      { id: 'cantidad', label: 'Cantidad', type: 'number', required: true, defecto: 1, min: 0.01, step: '0.01' },
      { id: 'precio_unitario', label: 'Precio unitario', type: 'number', required: true, min: 0.01, step: '0.01' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha', label: 'Fecha' }, { key: 'cliente', label: 'Cliente', soloLectura: true },
      { key: 'producto', label: 'Producto', soloLectura: true }, { key: 'categoria', label: 'Categoría' },
      { key: 'cantidad', label: 'Cant.' }, { key: 'precio_unitario', label: 'P. unit.' },
      { key: 'monto', label: 'Monto', soloLectura: true }
    ],
    mapa: { colFecha: 'fecha', colNum: 'monto', otrosNum: ['cantidad'], colCat1: 'producto', colCat2: 'categoria', otrasCat: ['cliente'] }
  },

  finanzas: {
    etiqueta: 'movimiento',
    campos: [
      { id: 'fecha', label: 'Fecha', type: 'date', required: true },
      { id: 'tipo', label: 'Tipo', type: 'select', required: true,
        opciones: [{ value: 'ingreso', label: 'Ingreso' }, { value: 'egreso', label: 'Egreso' }] },
      { id: 'categoria', label: 'Categoría', type: 'text', placeholder: 'Ej. Proveedores, Alquiler…' },
      { id: 'concepto', label: 'Concepto', type: 'text', required: true, ancho: 2 },
      { id: 'monto', label: 'Monto', type: 'number', required: true, min: 0, step: '0.01' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha', label: 'Fecha' }, { key: 'tipo', label: 'Tipo' },
      { key: 'categoria', label: 'Categoría' }, { key: 'concepto', label: 'Concepto' },
      { key: 'monto', label: 'Monto' }, { key: 'origen_modulo', label: 'Origen' }
    ],
    mapa: { colFecha: 'fecha', colNum: 'monto', otrosNum: [], colCat1: 'tipo', colCat2: 'categoria', otrasCat: [] }
  },

  inventario: {
    etiqueta: 'producto',
    // Cuando stock <= stock_minimo, la tabla resalta la fila (ver
    // tablaRegistros.js). No bloquea nada por sí solo -- Ventas ya bloquea
    // en 0 -- esto es el aviso temprano de "se está por acabar".
    alertaStock: { campo: 'stock', minimo: 'stock_minimo' },
    campos: [
      { id: 'fecha_registro', label: 'Fecha', type: 'date', required: true },
      { id: 'nombre', label: 'Producto', type: 'text', required: true },
      { id: 'categoria', label: 'Categoría', type: 'text', placeholder: 'Opcional' },
      { id: 'stock', label: 'Stock', type: 'number', required: true, defecto: 0, min: 0, step: '0.01' },
      { id: 'stock_minimo', label: 'Stock mínimo', type: 'number', defecto: 0, min: 0, step: '0.01' },
      { id: 'costo_unitario', label: 'Costo de compra (unitario)', type: 'number', min: 0, step: '0.01', placeholder: 'Lo que pagaste por unidad' },
      { id: 'precio_unitario', label: 'Precio de venta (unitario)', type: 'number', min: 0, step: '0.01' },
      { id: 'fecha_vencimiento', label: 'Fecha de vencimiento', type: 'date', placeholder: 'Opcional' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha_registro', label: 'Fecha' }, { key: 'nombre', label: 'Producto' },
      { key: 'categoria', label: 'Categoría' }, { key: 'stock', label: 'Stock' },
      { key: 'stock_minimo', label: 'Stock mín.' }, { key: 'costo_unitario', label: 'Costo compra' },
      { key: 'precio_unitario', label: 'P. venta' }, { key: 'fecha_vencimiento', label: 'Vence' }
    ],
    mapa: { colFecha: 'fecha_registro', colNum: 'stock', otrosNum: ['precio_unitario', 'costo_unitario', 'stock_minimo'], colCat1: 'nombre', colCat2: 'categoria', otrasCat: [] }
  },

  clientes: {
    etiqueta: 'cliente',
    campos: [
      { id: 'fecha_registro', label: 'Fecha', type: 'date', required: true },
      { id: 'nombre', label: 'Nombre', type: 'text', required: true },
      { id: 'email', label: 'Email', type: 'email', placeholder: 'Opcional' },
      { id: 'telefono', label: 'Teléfono', type: 'text', placeholder: 'Opcional' },
      { id: 'direccion', label: 'Dirección', type: 'text', placeholder: 'Opcional' },
      { id: 'compras_totales', label: 'Compras totales', type: 'number', defecto: 0, min: 0, step: '0.01' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha_registro', label: 'Fecha' }, { key: 'nombre', label: 'Nombre' },
      { key: 'email', label: 'Email' }, { key: 'telefono', label: 'Teléfono' },
      { key: 'compras_totales', label: 'Compras' }
    ],
    mapa: { colFecha: 'fecha_registro', colNum: 'compras_totales', otrosNum: [], colCat1: 'nombre', colCat2: 'direccion', otrasCat: [] }
  },

  // --- Fase C: vertical automotriz ---

  vehiculos: {
    etiqueta: 'vehículo',
    campos: [
      { id: 'fecha_registro', label: 'Fecha de registro', type: 'date', required: true },
      { id: 'cliente_id', label: 'Cliente (propietario)', type: 'select', required: true, fuente: 'clientes',
        vacio: 'Selecciona un cliente…', accionExtra: { texto: '+ Nuevo cliente', evento: 'nuevoCliente' } },
      { id: 'placa', label: 'Placa', type: 'text', required: true },
      { id: 'marca', label: 'Marca', type: 'text', required: true },
      { id: 'modelo', label: 'Modelo', type: 'text', required: true },
      { id: 'anio', label: 'Año', type: 'number', min: 1950, step: '1', placeholder: 'Opcional' },
      { id: 'vin', label: 'VIN', type: 'text', placeholder: 'Opcional' },
      { id: 'color', label: 'Color', type: 'text', placeholder: 'Opcional' },
      { id: 'kilometraje_actual', label: 'Kilometraje actual', type: 'number', defecto: 0, min: 0, step: '0.01' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha_registro', label: 'Fecha' }, { key: 'cliente_nombre', label: 'Cliente', soloLectura: true },
      { key: 'placa', label: 'Placa' }, { key: 'marca', label: 'Marca' }, { key: 'modelo', label: 'Modelo' },
      { key: 'anio', label: 'Año' }, { key: 'kilometraje_actual', label: 'Kilometraje' }
    ],
    mapa: { colFecha: 'fecha_registro', colCat1: 'marca', colCat2: 'modelo', otrasCat: ['cliente_nombre'] }
  },

  repuestos: {
    etiqueta: 'repuesto',
    alertaStock: { campo: 'stock', minimo: 'stock_minimo' },
    campos: [
      { id: 'fecha_registro', label: 'Fecha', type: 'date', required: true },
      { id: 'nombre', label: 'Repuesto', type: 'text', required: true },
      { id: 'codigo_oem', label: 'Código OEM', type: 'text', placeholder: 'Opcional' },
      { id: 'compatibilidad', label: 'Compatibilidad', type: 'text', ancho: 2, placeholder: 'Ej. Toyota Corolla 2015-2020' },
      { id: 'ubicacion', label: 'Ubicación en almacén', type: 'text', placeholder: 'Opcional' },
      { id: 'proveedor', label: 'Proveedor', type: 'text', placeholder: 'Opcional' },
      { id: 'tiempo_reposicion_dias', label: 'Tiempo de reposición (días)', type: 'number', min: 0, step: '1', placeholder: 'Opcional' },
      { id: 'equivalencias', label: 'Equivalencias', type: 'text', ancho: 2, placeholder: 'Opcional' },
      { id: 'stock', label: 'Stock', type: 'number', required: true, defecto: 0, min: 0, step: '0.01' },
      { id: 'stock_minimo', label: 'Stock mínimo', type: 'number', defecto: 0, min: 0, step: '0.01' },
      { id: 'costo_unitario', label: 'Costo de compra (unitario)', type: 'number', min: 0, step: '0.01', placeholder: 'Lo que pagaste por unidad' },
      { id: 'precio_unitario', label: 'Precio de venta (unitario)', type: 'number', required: true, min: 0, step: '0.01' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha_registro', label: 'Fecha' }, { key: 'nombre', label: 'Repuesto' },
      { key: 'codigo_oem', label: 'Código OEM' }, { key: 'stock', label: 'Stock' },
      { key: 'stock_minimo', label: 'Stock mín.' }, { key: 'costo_unitario', label: 'Costo compra' },
      { key: 'precio_unitario', label: 'P. venta' }, { key: 'proveedor', label: 'Proveedor' }
    ],
    mapa: { colFecha: 'fecha_registro', colNum: 'stock', otrosNum: ['precio_unitario', 'costo_unitario', 'stock_minimo'], colCat1: 'nombre', colCat2: 'proveedor', otrasCat: [] }
  },

  postventa: {
    etiqueta: 'orden de servicio',
    campos: [
      { id: 'fecha', label: 'Fecha', type: 'date', required: true },
      { id: 'cliente_id', label: 'Cliente', type: 'select', required: true, fuente: 'clientes',
        vacio: 'Selecciona un cliente…', accionExtra: { texto: '+ Nuevo cliente', evento: 'nuevoCliente' } },
      { id: 'vehiculo_id', label: 'Vehículo', type: 'select', required: true, fuente: 'vehiculos', vacio: 'Selecciona un vehículo…' },
      { id: 'tipo', label: 'Tipo', type: 'select', required: true,
        opciones: [
          { value: 'mantenimiento', label: 'Mantenimiento' }, { value: 'garantia', label: 'Garantía' },
          { value: 'reparacion', label: 'Reparación' }, { value: 'revision', label: 'Revisión' }
        ] },
      { id: 'kilometraje', label: 'Kilometraje', type: 'number', min: 0, step: '1', placeholder: 'Opcional' },
      { id: 'descripcion', label: 'Descripción del trabajo', type: 'text', required: true, ancho: 2 },
      // repuesto_id es OPCIONAL a propósito -- una orden puede ser solo mano
      // de obra. Si se elige, descuenta stock (igual que ventas.producto_id)
      // y sugiere costo_repuestos con el precio unitario -- que queda
      // editable para cubrir órdenes con más de un repuesto.
      { id: 'repuesto_id', label: 'Repuesto principal', type: 'select', fuente: 'repuestos',
        vacio: 'Ninguno / varios (usa Costo de repuestos manual)',
        ayudaStock: true, ayudaStockCampoCantidad: 'cantidad_repuesto', sugiere: ['costo_repuestos'] },
      { id: 'cantidad_repuesto', label: 'Cantidad de repuesto', type: 'number', defecto: 1, min: 0.01, step: '0.01' },
      { id: 'costo_repuestos', label: 'Costo de repuestos', type: 'number', required: true, defecto: 0, min: 0, step: '0.01' },
      { id: 'mano_obra', label: 'Mano de obra', type: 'number', required: true, defecto: 0, min: 0, step: '0.01' },
      { id: 'estado', label: 'Estado', type: 'select', defecto: 'pendiente',
        opciones: [
          { value: 'pendiente', label: 'Pendiente' }, { value: 'en_proceso', label: 'En proceso' }, { value: 'completado', label: 'Completado' }
        ] },
      { id: 'proximo_servicio', label: 'Próximo servicio', type: 'date', placeholder: 'Opcional' },
      { id: 'garantia_hasta', label: 'Garantía hasta', type: 'date', placeholder: 'Opcional' },
      { id: 'notas', label: 'Notas', type: 'text', ancho: 2, placeholder: 'Opcional' }
    ],
    columnasTabla: [
      { key: 'fecha', label: 'Fecha' }, { key: 'cliente_nombre', label: 'Cliente', soloLectura: true },
      { key: 'vehiculo_descripcion', label: 'Vehículo', soloLectura: true }, { key: 'tipo', label: 'Tipo' },
      { key: 'descripcion', label: 'Trabajo' }, { key: 'repuesto_nombre', label: 'Repuesto', soloLectura: true },
      { key: 'costo_repuestos', label: 'Costo rep.' }, { key: 'mano_obra', label: 'M. obra' },
      { key: 'total', label: 'Total', soloLectura: true }, { key: 'estado', label: 'Estado' }
    ],
    // colNum:'total' + colCat1:'estado' -- el KPI principal es ingreso de
    // postventa, y el desglose por categoría muestra cuánto hay en cada
    // estado (pendiente/en_proceso/completado) en vez de solo un conteo.
    mapa: { colFecha: 'fecha', colNum: 'total', otrosNum: ['mano_obra', 'costo_repuestos'], colCat1: 'estado', colCat2: 'tipo', otrasCat: ['cliente_nombre'] }
  }
};
