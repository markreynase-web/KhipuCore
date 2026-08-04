// src/server.js
// Servidor de la API. Sirve solo /api/*; el frontend (KhipuCore) sigue
// sirviéndose aparte como archivos estáticos (ej. `python -m http.server`).

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import ventasRouter from './routes/ventas.js';
import inventarioRouter from './routes/inventario.js';
import clientesRouter from './routes/clientes.js';
import finanzasRouter from './routes/finanzas.js';
import authRouter from './routes/auth.js';
import usuariosRouter from './routes/usuarios.js';
import auditoriaRouter from './routes/auditoria.js';
import empresaRouter from './routes/empresa.js';
import vehiculosRouter from './routes/vehiculos.js';
import repuestosRouter from './routes/repuestos.js';
import postventaRouter from './routes/postventa.js';
import superadminRouter from './routes/superadmin.js';
import khipuAiRouter from './routes/khipuAi.js';

dotenv.config();

const app = express();

const origenesPermitidos = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origenPeticion, callback) => {
    if (origenesPermitidos.includes('*') || !origenPeticion || origenesPermitidos.includes(origenPeticion)) {
      return callback(null, true);
    }
    callback(new Error(`Origen no permitido por CORS: ${origenPeticion}`));
  }
}));
app.use(express.json());

// Endpoint de salud: el frontend lo usa para saber si el backend está disponible
// antes de intentar leer/escribir datos (si no responde, cae a modo local).
app.get('/api/salud', (req, res) => res.json({ ok: true }));

if (!process.env.JWT_SECRET) {
  console.error(
    'Falta JWT_SECRET en el archivo .env. Copia .env.example a .env y ponle ' +
    'cualquier texto largo y aleatorio antes de usar el login.'
  );
}

app.use('/api/auth', authRouter);
app.use('/api/ventas', ventasRouter);
app.use('/api/inventario', inventarioRouter);
app.use('/api/clientes', clientesRouter);
app.use('/api/finanzas', finanzasRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/auditoria', auditoriaRouter);
app.use('/api/empresa', empresaRouter);
app.use('/api/vehiculos', vehiculosRouter);
app.use('/api/repuestos', repuestosRouter);
app.use('/api/postventa', postventaRouter);
app.use('/api/superadmin', superadminRouter);
app.use('/api/khipu-ai', khipuAiRouter);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

// PORT: la mayoría de los hosts (Render, Railway, Heroku...) asignan el
// puerto ellos mismos por esta variable y esperan que el server escuche ahí.
// API_PORT se mantiene como respaldo para desarrollo local con .env propio.
const PORT = process.env.PORT || process.env.API_PORT || 3001;
app.listen(PORT, () => {
  console.log(`API de Ventas escuchando en http://localhost:${PORT}`);
  console.log('Si no has corrido las migraciones todavía: npm run migrate');
});
