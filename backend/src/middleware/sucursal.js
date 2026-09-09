// src/middleware/sucursal.js
// Sub-fase D: restricción usuario-por-sucursal. req.usuario.sucursal_id sale
// del JWT (ver routes/auth.js) -- null/undefined = sin restricción (ve y
// opera en todas las sucursales de la empresa), un id = restringido a esa.
//
// Este middleware SOLO hace una cosa: detectar un pedido EXPLÍCITO de otra
// sucursal (?sucursal_id= en query, o sucursal_id en el body de un POST que
// lo acepta) y cortar con 403 antes de que la ruta haga ningún trabajo. NO
// toca req.query ni req.body -- no reescribe nada del cliente. El valor
// EFECTIVO del filtro lo decide cada handler, leyendo req.sucursalRestringida
// directo (nunca el query param, cuando hay restricción) -- ver
// crudFactory.js, ventas.js y finanzas.js.
//
// Un pedido "indirecto" (PUT/DELETE /:id de una fila que resulta ser de
// otra sucursal, sin que el cliente haya declarado ninguna sucursal en el
// request) NO se maneja acá -- ese caso es 404, no 403, y cada ruta lo
// resuelve sumando la condición directo al WHERE de su query de selección
// inicial (nunca "traer y comparar después" -- ver el resto de la Sub-fase D).
//
// IMPORTANTE para POST /import (multipart/form-data, ej. inventario.js):
// este middleware se monta en router.use(), ANTES de multer (que corre
// recién en la ruta específica). req.body todavía no tiene los campos del
// form-data en ese punto, así que el chequeo de acá abajo (que lee
// req.body?.sucursal_id) NUNCA dispara para /import -- ni en falso positivo
// ni en falso negativo, simplemente no aplica. La validación por FILA del
// CSV es responsabilidad de cada import handler, leyendo req.sucursalRestringida
// (que sí está disponible siempre, porque sale del JWT vía requireEmpresa/
// auth(), no del body) -- nunca debe asumirse que este middleware ya la cubrió.
export function resolverRestriccionSucursal(req, res, next) {
  const propia = req.usuario?.sucursal_id ?? null;
  req.sucursalRestringida = propia;
  if (propia === null) return next();

  const pedida = req.query?.sucursal_id ?? req.body?.sucursal_id;
  if (pedida !== undefined && pedida !== null && pedida !== '' && Number(pedida) !== propia) {
    return res.status(403).json({ error: 'No tienes acceso a esa sucursal.' });
  }
  next();
}
