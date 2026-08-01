// src/routes/clientes.js
import { crearRouterCRUD } from '../crudFactory.js';

export default crearRouterCRUD({
  tabla: 'clientes',
  modulo: 'clientes',
  columnas: ['fecha_registro', 'nombre', 'email', 'telefono', 'direccion', 'compras_totales', 'notas'],
  camposRequeridos: ['fecha_registro', 'nombre'],
  camposNumericos: ['compras_totales'],
  columnaFecha: 'fecha_registro',
  valoresPorDefecto: { compras_totales: 0 }
});
