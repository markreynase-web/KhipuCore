// src/middleware/requestId.js
// Un identificador único por request, para poder correlacionar "esto que
// vio un usuario" con "esto que aparece en los logs del servidor" -- hoy
// no existe ningún mecanismo así (confirmado al auditar el estado real del
// logging antes de este bloque). crypto.randomUUID() es nativo de Node
// (>=14.17), cero dependencias nuevas para esto.
//
// Se monta primero en server.js, antes que cualquier otro middleware --
// así TODA respuesta (incluidas las de error) lleva X-Request-Id, y
// cualquier log posterior de esa misma request puede leer req.requestId.

import { randomUUID } from 'node:crypto';

export function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
