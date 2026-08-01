// src/routes/inventario.js
import { crearRouterCRUD } from '../crudFactory.js';

export default crearRouterCRUD({
  tabla: 'inventario',
  modulo: 'inventario',
  columnas: ['fecha_registro', 'nombre', 'categoria', 'stock', 'stock_minimo', 'precio_unitario', 'fecha_vencimiento', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['stock', 'stock_minimo', 'precio_unitario'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { stock: 0, stock_minimo: 0 }
});
