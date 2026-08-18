import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supa, SUPABASE_URL } from './supa.js';
import authRoutes from './routes/auth.js';
import chatarraRoutes from './routes/chatarra.js';
import documentalRoutes from './routes/documental.js';
import obsoletosRoutes from './routes/obsoletos.js';
import portalRoutes from './routes/portal.js';
import indicadoresRoutes from './routes/indicadores.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api', chatarraRoutes);
app.use('/api', documentalRoutes);
app.use('/api', obsoletosRoutes);
app.use('/api/public', portalRoutes);
app.use('/api', indicadoresRoutes);

// Regla de los 15 días: la función vive en PostgreSQL; se dispara al arrancar,
// cada hora desde aquí y también puede programarse con pg_cron en Supabase.
async function convertir() {
  const { data, error } = await supa.rpc('convertir_vencidos');
  if (error) console.error('convertir_vencidos:', error.message);
  else if (data) console.log(`Conversión automática a chatarra: ${data} componente(s) superaron los 15 días.`);
}
await convertir();
setInterval(convertir, 60 * 60 * 1000);

// Si existe el build del cliente, se sirve desde aquí (despliegue local en un solo puerto).
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Error interno del servidor' });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`GEA API escuchando en http://localhost:${PORT} · datos en ${SUPABASE_URL}`));
