// src/passwordPolicy.js
// Política de contraseña única, usada tanto al crear un usuario
// (routes/usuarios.js) como al restablecerla (routes/auth.js) -- antes
// eran dos reglas distintas (alta pedía 6 caracteres sin más, recuperación
// pedía 8+mayúscula+minúscula+número), unificadas acá a pedido explícito
// para que un usuario nuevo y uno que resetea su clave pasen por la misma vara.

export const MENSAJE_POLITICA_PASSWORD = 'La contraseña debe tener al menos 8 caracteres, con una mayúscula, una minúscula y un número.';

export function passwordCumplePolitica(password) {
  return typeof password === 'string' && password.length >= 8 &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password);
}
