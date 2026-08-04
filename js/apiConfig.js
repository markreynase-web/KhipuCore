// js/apiConfig.js
// Fase A (multi-tenant): antes cada cliente tenía su propio despliegue con
// su propio apiBaseUrl dentro de config/company.json. Ahora un solo backend
// atiende a todas las empresas (se resuelven por empresa_id después del
// login), así que la URL deja de ser "por empresa" y pasa a ser una
// constante fija. Vive en su propio archivo (en vez de directo en
// config.js) porque pages/login.html la necesita ANTES de que exista
// cualquier sesión -- no puede depender de una llamada al backend para
// saber a qué backend llamar.
export const API_BASE_URL = 'https://khipucore.onrender.com/api';
