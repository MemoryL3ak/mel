// GEA — capa de datos sobre Supabase (PostgreSQL gestionado + PostgREST).
// El servidor usa la secret key (service role): omite RLS y nunca llega al navegador.
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
try { process.loadEnvFile(envPath); } catch { /* sin .env: se esperan variables de entorno */ }

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  console.error('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.');
  console.error('Copie server/.env.example a server/.env con las credenciales del proyecto,');
  console.error('y ejecute server/db/supabase.sql en el SQL Editor de Supabase.');
  process.exit(1);
}

export const supa = createClient(URL, KEY, { auth: { persistSession: false } });
export const SUPABASE_URL = URL;

// Desenvuelve {data,error} de supabase-js: los errores se vuelven excepciones.
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

// Envuelve handlers async para que Express 4 derive los errores al middleware.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const hoy = () => new Date().toISOString().slice(0, 10);
export function diasDesde(fecha) {
  return Math.floor((Date.now() - new Date(fecha + 'T00:00:00').getTime()) / 86400000);
}
export const fmtFecha = (ts) =>
  ts ? new Date(ts).toLocaleString('es-CL', { timeZone: 'America/Santiago', hour12: false }) : ts;

// Bitácora inmutable: se escribe siempre; un fallo de auditoría no corta la operación.
export function audit(usuario, rol, accion, objeto) {
  supa.from('auditoria').insert({ usuario, rol, accion, objeto }).then(({ error }) => {
    if (error) console.error('auditoria:', error.message);
  });
}
