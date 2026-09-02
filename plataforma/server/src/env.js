// Carga y valida la configuración. El servidor no parte con un .env incompleto:
// falla al inicio con un mensaje claro, nunca a mitad de una operación.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'JWT_SECRET'];
const faltan = REQUIRED.filter((k) => !process.env[k]);
if (faltan.length) {
  console.error(
    `\n[GEA] Configuración incompleta. Faltan en server/.env: ${faltan.join(', ')}\n` +
    `      Copia server/.env.example a server/.env y completa los valores del proyecto Supabase.\n`
  );
  process.exit(1);
}

export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: Number(process.env.PORT || 4100),
};
