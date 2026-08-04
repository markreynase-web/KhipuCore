# KhipuCore

Reorganización del proyecto original (un solo `index.html` de 822 líneas) en módulos,
más el fix de un problema de seguridad encontrado en el análisis inicial.

## Cómo correrlo

Necesita servidor local (usa ES modules — `import`/`export` — que los navegadores
bloquean sobre `file://`):

```bash
cd KhipuCore
python -m http.server 8000
# o: npx serve
```

Abre `http://localhost:8000/` (redirige a `pages/ventas.html`).

## Qué se hizo en esta iteración

**Fase 1 — Modularización**
El JS de 400+ líneas que vivía todo en un `<script>` ahora está dividido en:

| Archivo | Responsabilidad |
|---|---|
| `js/utils.js` | Formateo de números, parsing flexible de fechas/números, `escapeHtml` |
| `js/parsing.js` | Lectura de CSV/ZIP, detección automática de columnas |
| `js/storage.js` | Persistencia en `localStorage`, con namespace por página |
| `js/filters.js` | Rango de fechas y filtrado por periodo |
| `js/charts.js` | Construcción de gráficos Chart.js |
| `js/dashboard.js` | Render principal del DOM (KPIs, gráfico, rankings, tabla debug) |
| `js/app.js` | Estado de la app, manejo de archivos, wiring de botones, arranque |

El CSS de un solo `<style>` gigante pasó a `css/base.css`, `css/cards.css`, `css/tables.css`.

**Fix de seguridad (XSS)**
Los nombres de columna y valores de celda del CSV del usuario se insertaban con
`innerHTML` sin escapar en varios lugares (rankings, categorías, tabla de columnas
detectadas). Un CSV con algo como `<img src=x onerror=...>` en una celda se habría
ejecutado. Ahora todo pasa por `escapeHtml()` (en `js/utils.js`) antes de insertarse.
Los `textContent` que ya eran seguros se dejaron igual (no hacía falta tocarlos).

**Fase 2 — Preparado para cualquier empresa**
`config/company.json` es ahora la única fuente de verdad sobre qué ve cada
cliente. Contiene el nombre de la empresa, el logo (texto corto) y la lista
completa de 8 módulos posibles (Ventas, Inventario, Compras, Clientes, RRHH,
Finanzas, Producción, Marketing), cada uno con `enabled: true/false`.

- **Sistema de módulos**: cada módulo es su propia página física en `pages/`
  (`ventas.html`, `inventario.html`, `compras.html`, `clientes.html`,
  `rrhh.html`, `finanzas.html`, `produccion.html`, `marketing.html`). Todas
  comparten el mismo `js/app.js` / `js/dashboard.js` / etc. — no hay lógica
  duplicada. Cada página se identifica con `<body data-modulo="...">`, y
  `app.js` lee ese atributo para saber su propio namespace de `localStorage`
  (así los datos de Inventario nunca se mezclan con los de Ventas) y para
  buscar su propia entrada en `config/company.json`.
- **Menú dinámico** (`components/nav.js`): lee `config/company.json` y solo
  pinta enlaces a los módulos con `enabled: true`. Si un cliente no tiene
  Inventario habilitado, el link a Inventario ni siquiera se agrega al DOM
  (no es un `display:none`, no existe). Si un cliente solo tiene un módulo
  habilitado, el menú no se muestra.
- **Branding por configuración** (`aplicarBranding()` en `js/app.js`): el
  nombre de la empresa, el logo (iniciales) y el título de la pestaña salen
  de `config/company.json`. Si el usuario ya guardó un `bizName` distinto en
  `localStorage` (lo escribió a mano alguna vez), ese valor local tiene
  prioridad sobre el de config, igual que antes.
- **Alcance actual (Nivel 1)**: el config controla qué módulos existen y el
  branding. El *contenido* de cada dashboard (qué columna es KPI, cuál es
  fecha, etc.) lo sigue decidiendo la detección automática de `parsing.js`
  a partir del CSV que suba cada cliente — todavía no hay forma de fijar
  "la columna X siempre va en el KPI 1" desde config. Eso quedaría para una
  iteración posterior si se necesita.
- `index.html` ahora redirige al primer módulo con `enabled: true` en vez de
  ir siempre a `ventas.html` a la fuerza.

**Fase 3 — Captura de datos**
Ya no vive todo en el navegador: **Ventas, Inventario y Clientes** están
conectados a un backend real (Node.js + Express + PostgreSQL).

Roadmap de esta fase:
- ✅ **CRUD de Ventas completo** — crear, editar y borrar desde la interfaz
  (antes solo se podía crear e importar CSV).
- ✅ **CRUD reutilizable** — `backend/src/crudFactory.js` genera las 5 rutas
  (GET/POST/PUT/DELETE/import) para cualquier tabla a partir de su config de
  columnas; ya no se escribe cada ruta a mano por módulo. Del lado del
  frontend, `js/esquemas.js` cumple el mismo rol: declara los campos del
  formulario, las columnas de la tabla y el mapeo hacia el dashboard genérico.
- ✅ **Inventario migrado** — formulario "Nuevo producto" (nombre, categoría,
  stock, stock mínimo, precio unitario) + tabla editable + import CSV,
  guardando en `tabla inventario`.
- ✅ **Clientes migrado** — formulario "Nuevo cliente" (nombre, email,
  teléfono, dirección, compras totales) + tabla editable + import CSV,
  guardando en `tabla clientes`.
- ✅ **Sistema de componentes reutilizables**: `components/formularioRegistro.js`
  (arma cualquier formulario a partir de un esquema) y
  `components/tablaRegistros.js` (tabla con editar inline y borrar, también
  genérica). Ningún módulo tiene su HTML de formulario escrito a mano.
- ⏳ **Panel de administración**: pendiente, es el siguiente paso.

Cómo migrar un módulo nuevo a base de datos con este patrón: 1 migración SQL
+ 4 líneas en `backend/src/routes/<modulo>.js` usando `crearRouterCRUD()` +
una entrada en `js/esquemas.js` + `"baseDeDatos": true` en `company.json`.
Ver `backend/README.md` para el detalle técnico completo.



**Fase 4 — Login, roles y permisos (en progreso)**

Paso 1 de 5, hecho:
- ✅ **Login con JWT**: tabla `usuarios` (con `password_hash` vía bcrypt y una
  columna `rol`, lista para el paso 2 pero sin lógica todavía), endpoint
  `POST /api/auth/login`, y `GET /api/auth/me` protegida por el primer
  middleware (`auth()`, ver `backend/src/middleware/auth.js`) — es la primera
  pieza del pipeline `auth() → verificarPermiso() → CRUD` que armaste.
- ✅ **`pages/login.html`**: pantalla de login real, guarda el token en el
  navegador (`js/sesion.js`) y redirige al dashboard.
- ✅ **Widget de sesión** en el header de las 8 páginas de módulos: muestra
  quién está logueado (o el link para entrar) y el botón de cerrar sesión.
- No hay pantalla de "crear cuenta": el primer admin se crea desde la
  terminal con `npm run seed:admin` (ver `backend/README.md`).
- **Importante:** por ahora el login es solo informativo — ninguna ruta de
  Ventas/Inventario/Clientes está protegida todavía, y las páginas no
  redirigen a login si no hay sesión. Eso es intencional: llega con el paso 4
  (Middleware), cuando `verificarPermiso()` ya sepa qué puede hacer cada rol.

Siguiente: Roles → Permisos → Middleware (conectar todo esto al CRUD
existente) → Auditoría → Panel de administración.

*(Nota: esta lista de pasos quedó desactualizada por Roles/Permisos/
Auditoría — ver `backend/src/middleware/permisos.js`, las migraciones
005/006/009 y la sección de Fase A abajo, todas ya implementadas.)*

**Fase A — Plataforma multi-tenant (SaaS)**

KhipuCore deja de ser "un despliegue = una empresa" y pasa a ser un solo
backend que sirve a muchas empresas, aisladas por fila (`empresa_id`), no por
despliegue. Motivación completa en el historial del proyecto; resumen técnico:

- ✅ **`empresa_id` en cada tabla de negocio** (`ventas`, `inventario`,
  `clientes`, `finanzas`, `audit_log`) — ver `backend/migrations/012_empresas.sql`.
  `roles`/`permisos`/`rol_permiso` se quedan globales a propósito (mismo
  catálogo para todas las empresas, por ahora).
- ✅ **Identidad global + membresía por empresa**: `usuarios.email` sigue
  siendo único globalmente; la tabla puente `usuario_empresa` guarda a qué
  empresa(s) pertenece cada usuario y con qué rol en cada una (una persona
  puede ser administrador en una empresa y gerente en otra).
- ✅ **Login inteligente en dos pasos**: `POST /api/auth/login` resuelve la
  empresa sola si el usuario pertenece a una sola; si pertenece a varias,
  devuelve un `preAuthToken` de 5 minutos + la lista, y
  `POST /api/auth/login/empresa` completa el login tras elegir una
  (revalidado server-side, nunca se confía en el `empresa_id` que manda el
  cliente).
- ✅ **`crudFactory.js` scoped por empresa**: un solo cambio ahí cubre
  `clientes.js` completo e `inventario.js` (GET/PUT/import); `ventas.js`,
  `inventario.js` (POST/DELETE), `finanzas.js`, `usuarios.js` y
  `auditoria.js` se editaron a mano por ser rutas manuales (no pasan por el
  factory). `PUT`/`DELETE` cruzando de empresa devuelven 404 (no 403), para
  no confirmar que el id existe en otro lado.
- ✅ **`GET /api/empresa/actual`** reemplaza a `config/company.json` (ya
  borrado del repo): branding + módulos habilitados salen de la base de
  datos, scoped a la empresa activa del token.
- ✅ **`js/apiConfig.js`**: la URL del backend pasa de "por empresa" (vivía
  en `company.json`) a una constante fija — ya era en la práctica un solo
  backend para todos los clientes.
- **Trade-off aceptado:** el JWT (8h) congela la empresa activa igual que ya
  congelaba los permisos — alguien removido de una empresa a media sesión
  sigue teniendo acceso hasta por 8h o hasta volver a loguearse.

Siguiente (fases ya acordadas, no implementadas todavía): Fase B (landing
page + este login inteligente como fachada pública) → Fase C (vertical
automotriz: Vehículos/VIN, Repuestos, Postventa) → Fase D (IA).

## Qué falta (fases siguientes, aún no implementadas)

- **Fase 3 — Temas**: `css/themes/` existe pero vacía. Las variables ya están
  centralizadas en `css/base.css`, así que el siguiente paso es solo crear
  `azul.css`, `negro.css`, etc. redefiniendo esas mismas variables y un selector
  que cambie cuál se aplica.
- **Fase 4 — Componentes reutilizables**: `components/nav.js` es el primero.
  `dashboard.js` sigue escribiendo el resto del HTML directamente en vez de
  usar piezas reutilizables (KpiCard, Tabla, etc.).
- **Nivel 2 de config (pendiente si se quiere)**: permitir que
  `config/company.json` fije, por módulo, qué columna del CSV va en cada KPI
  en vez de dejarlo 100% a la auto-detección.
- `assets/` existe pero vacía (para logo en imagen, más allá del texto corto
  actual en `config.logo`).

## Estructura

```
KhipuCore/
  index.html            → redirige a pages/inicio.html (o a login.html si no hay sesión)
  js/apiConfig.js        → URL fija del backend (Fase A: un solo backend para todas las empresas)
  css/
    base.css            → variables de tema, reset, header, hero, module-nav
    cards.css           → KPIs, paneles, gráficos
    tables.css          → tabla de debug, badges de rol
    themes/             → (vacío, Fase 3)
  js/
    app.js              → estado + orquestación + namespace por módulo + branding
    config.js            → carga/cachea el branding+módulos de la empresa activa (GET /api/empresa/actual, Fase A)
    dashboard.js         → render principal
    charts.js            → construcción de gráficos Chart.js
    filters.js            → filtro de rango de fechas
    parsing.js            → CSV/ZIP + detección de columnas
    storage.js            → localStorage con namespace por módulo
    utils.js              → formateo, parsing flexible, escapeHtml
  components/
    nav.js                → menú dinámico de módulos (primer componente reutilizable, Fase 4)
  assets/                → (vacío, para logo en imagen más adelante)
  pages/
    ventas.html, inventario.html, compras.html, clientes.html,
    rrhh.html, finanzas.html, produccion.html, marketing.html
                          → una página física por módulo, mismo motor JS/CSS,
                            cada una con <body data-modulo="..."> propio
  lib/
    chart.js, papaparse.min.js, jszip.min.js  → librerías de terceros sin cambios
```

### Cómo dar de alta/baja un módulo a un cliente
Desde Fase A esto ya no se edita en un archivo: se hace en la base de datos,
en la tabla puente `empresa_modulos` (una fila = un módulo habilitado para
esa empresa; ver `backend/migrations/012_empresas.sql`). El menú (sidebar) y
el dashboard de inicio se ajustan solos, sin tocar código.
