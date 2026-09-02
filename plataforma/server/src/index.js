// GEA · Plataforma de enajenación de activos — servidor Fase 1 (chatarra).
import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env } from './env.js';
import { login, auth } from './auth.js';
import { ah } from './supa.js';
import maestros from './routes/maestros.js';
import programa from './routes/programa.js';
import despachos from './routes/despachos.js';
import cuadratura from './routes/cuadratura.js';
import estados from './routes/estados.js';
import panel from './routes/panel.js';
import auditoria from './routes/auditoria.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, fase: 1 }));
app.post('/api/auth/login', ah(login));
app.get('/api/auth/me', auth(), (req, res) => res.json({ user: req.user }));

app.use('/api', maestros);
app.use('/api', programa);
app.use('/api', despachos);
app.use('/api', cuadratura);
app.use('/api', estados);
app.use('/api', panel);
app.use('/api', auditoria);

// Cliente compilado (producción / revisión local).
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

// Errores: mensaje claro al cliente, detalle al log del servidor.
app.use((err, _req, res, _next) => {
  console.error('[GEA]', err.message);
  res.status(500).json({ error: err.message || 'Error interno' });
});

app.listen(env.PORT, () => {
  console.log(`GEA · Fase 1 chatarra — servidor en http://localhost:${env.PORT}`);
});
