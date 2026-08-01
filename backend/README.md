# Backend — Ventas, Inventario y Clientes (Node.js + Express + PostgreSQL)

API con CRUD reutilizable (`src/crudFactory.js`): cada módulo declara sus
columnas en `src/routes/<modulo>.js` y obtiene automáticamente
GET/POST/PUT/DELETE + importación de CSV. Los tres módulos migrados hasta
ahora son Ventas, Inventario y Clientes; el dashboard (`../pages/<modulo>.html`)
usa la API automáticamente si la encuentra disponible, y si no, sigue
funcionando en modo local (CSV/localStorage) como en las Fases 1-2.

## 1. Requisitos

- Node.js 18 o superior.
- PostgreSQL corriendo en algún lado (tu máquina, o un proveedor gratuito
  como [Neon](https://neon.tech), [Supabase](https://supabase.com) o Railway).

## 2. Instalar dependencias

```bash
cd backend
npm install
```

## 3. Configurar la base de datos

Copia el archivo de ejemplo y edítalo con tus datos:

```bash
cp .env.example .env
```

```
DATABASE_URL=postgresql://usuario:password@localhost:5432/dashboard_core
PORT=3001
CORS_ORIGIN=http://localhost:8000
```

- `DATABASE_URL`: si usas PostgreSQL local, crea la base primero:
  `createdb dashboard_core` (o `psql -c "CREATE DATABASE dashboard_core;"`).
  Si usas Neon/Supabase/Railway, copian el `DATABASE_URL` ya armado en su panel.
- `CORS_ORIGIN`: la URL donde sirves el frontend. Si lo corres con
  `python -m http.server 8000` desde la raíz del proyecto, es
  `http://localhost:8000`.

## 4. Crear las tablas

```bash
npm run migrate
```

Esto ejecuta todo lo que hay en `migrations/*.sql`, en orden. Cuando se migre
otro módulo (Inventario, Clientes, etc.) a base de datos, su tabla entra como
un nuevo archivo ahí — no hace falta tocar este script.

## 5. Arrancar el servidor

```bash
npm run dev      # con recarga automática al guardar cambios
# o
npm start        # sin recarga, para "producción" casera
```

Deberías ver `API de Ventas escuchando en http://localhost:3001`.

## 6. Conectar el frontend

En `../config/company.json`, el módulo de Ventas ya tiene `"baseDeDatos": true`
y `apiBaseUrl` apunta a `http://localhost:3001/api`. Si cambiaste el puerto o
vas a desplegar el backend en otro lugar, actualiza `apiBaseUrl` ahí.

Con el backend corriendo, abre el frontend normalmente
(`python -m http.server 8000` en la raíz del proyecto) y entra a
`pages/ventas.html`: debería aparecer el panel "Captura de datos" arriba del
dashboard, con el formulario "Nueva venta" y el botón para importar CSV
directo a la base de datos. Si el backend no está corriendo, ese panel
simplemente no aparece y la página funciona como antes (modo local).

## Autenticación (Fase 4, paso 1)

No hay pantalla de registro: el primer usuario (admin) se crea desde la terminal.

```bash
cd backend
npm run seed:admin -- "Tu Nombre" tu@email.com tuContraseña
```

Si el email ya existe, el comando actualiza su nombre y contraseña (sirve
para resetear la clave del admin si la olvidas).

Con eso puedes loguearte en `pages/login.html`. Endpoints:

| Método | Ruta              | Qué hace |
|---|---|---|
| POST   | `/api/auth/login` | `{ email, password }` → `{ token, usuario }` |
| GET    | `/api/auth/me`    | Requiere `Authorization: Bearer <token>`. Confirma que el token es válido |

## Usando Supabase como base de datos

Si tu `DATABASE_URL` apunta a Supabase, hay dos cosas propias de Supabase que
no aplican a un Postgres genérico:

1. **SSL obligatorio**: ya viene resuelto en `src/db.js` (usa
   `ssl: { rejectUnauthorized: false }` salvo que pongas `PGSSL=false` en `.env`,
   para el caso de Postgres local sin SSL).
2. **PostgREST (la API REST automática de Supabase)**: Supabase expone
   *cada tabla* como endpoint REST en `https://<proyecto>.supabase.co/rest/v1/<tabla>`,
   protegido solo por Row Level Security (RLS). Como este proyecto ya controla
   el acceso en el backend Express (`auth()` + `verificarPermiso()`), la
   migración `007_supabase_rls.sql` activa RLS **sin políticas** sobre todas
   las tablas -- eso cierra por completo el acceso vía `anon`/`authenticated`
   (los roles que usa PostgREST), y deja como única puerta de entrada nuestra
   propia API. El backend sigue funcionando normal porque se conecta con el
   rol `postgres` (con `BYPASSRLS`), así que esto no le cambia nada a
   `crudFactory.js` ni a ninguna ruta.

   **Corre `npm run migrate` con esta versión aunque ya hayas corrido las
   migraciones anteriores** -- si no, tus tablas se quedan expuestas por
   PostgREST con la `anon key` (que vive en el frontend, es pública por
   diseño) y cualquiera podría leer/escribir `ventas`/`clientes`/etc. saltándose
   todo el sistema de roles y permisos.

3. **Puerto de conexión**: usa el puerto **5432** (conexión directa), no el
   **6543** (pooler transaccional de PgBouncer) -- este backend es un proceso
   de larga duración (no serverless) y el `import` de CSV usa `BEGIN/COMMIT`
   sobre la misma conexión, que el pooler en modo transaccional no siempre
   maneja bien entre requests distintos.



Ya no es un simple `if (usuario.rol == 'admin')`. Hay tres tablas
(`roles`, `permisos`, `rol_permiso`, migración `005_roles_permisos.sql`) y
cada ruta de `crudFactory.js` exige un permiso concreto:

| Verbo  | Permiso exigido       |
|---|---|
| GET    | `{modulo}.ver`        |
| POST   | `{modulo}.crear`      |
| PUT    | `{modulo}.editar`     |
| DELETE | `{modulo}.eliminar`   |
| POST /import | `{modulo}.crear` |

Pipeline real: `Cliente → JWT → auth() → verificarPermiso() → CRUD Factory → PostgreSQL`.
Al hacer login, `routes/auth.js` calcula los permisos del rol del usuario
(join `roles → rol_permiso → permisos`) y los mete dentro del JWT — así
`verificarPermiso()` no necesita ir a la base de datos en cada request
(trade-off: si le quitas un permiso a un rol, a quien ya tenía sesión iniciada
le sigue funcionando hasta que su token expire a las 8h o vuelva a entrar).

Roles que trae la migración por defecto: `administrador` (todo), `gerente`
(ver/crear/editar en todo, sin eliminar ni usuarios), `ventas` (su módulo +
ver clientes), `inventario` (su módulo), `supervisor` (solo ver, en todo) y
`consulta` (solo ver ventas/inventario/clientes). Se editan agregando o
quitando filas de `rol_permiso` — no hace falta tocar código.

### Gestión de usuarios

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/usuarios` | `usuarios.ver` | Lista usuarios (nombre, email, rol, activo) |
| GET | `/api/usuarios/roles` | `usuarios.ver` | Lista roles con sus permisos |
| POST | `/api/usuarios` | `usuarios.crear` | `{ nombre, email, password, rol }` |
| PUT | `/api/usuarios/:id` | `usuarios.editar` | `{ nombre?, rol?, activo? }` — cambia de rol o desactiva una cuenta |

### Registro de actividad (audit log)

Cada `crear`/`editar`/`eliminar`/`importar` exitoso en cualquier módulo con
`crudFactory` deja una fila en `audit_log` (migración `006_auditoria.sql`) sola,
sin que cada ruta tenga que acordarse de escribirla:

| Método | Ruta | Permiso | Qué hace |
|---|---|---|---|
| GET | `/api/auditoria?modulo=&desde=&hasta=&limite=` | `auditoria.ver` | Lista el historial (quién, qué acción, qué módulo, cuándo) |

## Endpoints

Los mismos 5 endpoints existen para cada módulo: `ventas`, `inventario`, `clientes`.

| Método | Ruta                       | Qué hace |
|---|---|---|
| GET    | `/api/salud`               | Chequeo de vida (usado por el frontend para saber si conectarse) |
| GET    | `/api/{modulo}`            | Lista registros. Filtros opcionales `?desde=AAAA-MM-DD&hasta=AAAA-MM-DD` |
| POST   | `/api/{modulo}`            | Crea un registro (usado por el formulario) |
| PUT    | `/api/{modulo}/:id`        | Edita un registro (reemplaza todos los campos, como cualquier PUT) |
| DELETE | `/api/{modulo}/:id`        | Borra un registro |
| POST   | `/api/{modulo}/import`     | Importa un CSV (`multipart/form-data`, campo `archivo`) |

Columnas esperadas en el CSV de cada módulo (insensible a mayúsculas):
- **ventas**: `fecha, producto, categoria, cantidad, precio_unitario, cliente, notas` (`monto` opcional, se calcula si no viene)
- **inventario**: `fecha_registro, nombre, categoria, stock, stock_minimo, precio_unitario, notas`
- **clientes**: `fecha_registro, nombre, email, telefono, direccion, compras_totales, notas`

## Cómo migrar un módulo nuevo (ej. Compras) a este mismo patrón

1. **Migración SQL** en `migrations/00N_compras.sql` — la tabla, con al menos
   `id SERIAL PRIMARY KEY`, una columna de fecha, y `actualizado_el TIMESTAMPTZ
   NOT NULL DEFAULT now()` (la usa `crudFactory.js` en cada UPDATE).
2. **Ruta** en `src/routes/compras.js`:
   ```js
   import { crearRouterCRUD } from '../crudFactory.js';
   export default crearRouterCRUD({
     tabla: 'compras',
     modulo: 'compras', // usado para permisos (compras.ver/crear/editar/eliminar) y para el audit log
     columnas: [...],
     camposRequeridos: [...],
     camposNumericos: [...],
     columnaFecha: 'fecha'
   });
   ```
3. **Montarla** en `src/server.js`: `app.use('/api/compras', comprasRouter)`.
4. **Permisos**: agrega `compras.ver/crear/editar/eliminar` a la tabla `permisos`
   y asígnalos a los roles que correspondan en `rol_permiso` (mismo patrón que
   `005_roles_permisos.sql`).
5. **Esquema del frontend** en `../js/esquemas.js`: mismo formato que `ventas`/`inventario`/`clientes` (campos del formulario + columnasTabla + mapa hacia el dashboard).
6. **Activarlo** en `../config/company.json`: `"baseDeDatos": true` en el módulo correspondiente.

Nada de esto toca `app.js`, `dashboard.js` ni los componentes — el patrón ya
está armado para que agregar un módulo sea solo declarar su config.

## Qué falta si se sigue con esta fase

- **Pantallas de Usuarios y Auditoría en el frontend**: los endpoints ya
  existen y están protegidos (`/api/usuarios`, `/api/auditoria`); falta la
  página HTML que los consuma (tabla de usuarios con selector de rol, tabla
  de actividad con filtros). Es el mismo patrón de `pages/ventas.html` pero
  sin esquema de dashboard (solo tabla).
- **Panel de administración**: vista que resuma todos los módulos conectados
  (conteos, últimos registros, estado de conexión) en un solo lugar.
- **Compras, RRHH, Producción, Marketing**: siguen sin existir ni en modo
  local ni en base de datos (están `enabled: false` en `company.json`).
  Finanzas está habilitado pero sigue en modo local (CSV/localStorage).
- **Importar desde Excel (.xlsx) o Google Sheets**: no está implementado —
  hoy solo CSV. Excel requeriría una librería de parseo adicional (ej. SheetJS)
  en el backend; Google Sheets requeriría OAuth con Google.
- **Revocar permisos al instante**: hoy los permisos viajan dentro del JWT y
  se recalculan recién en el próximo login (ver la nota en
  `src/middleware/permisos.js`). Si algún cliente necesita que un cambio de
  rol aplique de inmediato, hay que mover la verificación a una consulta por
  request o mantener una lista de tokens invalidados.
