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
import usuarios from './routes/usuarios.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS: solo cuando el frontend vive en otro dominio (Vercel). Sin cookies —
// la sesión viaja en el header Authorization — así que basta reflejar el origen.
if (env.CORS_ORIGIN.length) {
  app.use((req, res, next) => {
    const origen = req.headers.origin;
    if (origen && env.CORS_ORIGIN.includes(origen)) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

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
app.use('/api', usuarios);

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

// Bucket privado de evidencia fotográfica (idempotente).
import { supa } from './supa.js';
supa.storage.createBucket('evidencia', { public: false, fileSizeLimit: '5MB' })
  .then(({ error }) => { if (error && !/already exists/i.test(error.message)) console.error('[GEA] bucket evidencia:', error.message); });

app.listen(env.PORT, () => {
  console.log(`GEA · Fase 1 chatarra — servidor en http://localhost:${env.PORT}`);
});
