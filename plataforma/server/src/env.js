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
  // Orígenes permitidos para CORS cuando el cliente se sirve desde otro dominio
  // (frontend en Vercel). Lista separada por comas; vacío = solo mismo origen.
  CORS_ORIGIN: (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Correo saliente (opcional). Sin proveedor configurado, los correos se
  // registran en el log y no se envían; la plataforma opera igual.
  // Preferente: Resend (API HTTP, solo una API key). Alternativa: SMTP.
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: Number(process.env.SMTP_PORT || 587),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  MAIL_FROM: process.env.MAIL_FROM || 'GEA · Venta de obsoletos <no-reply@gea-escondida.cl>',
  // URL pública del portal, para los enlaces dentro de los correos.
  PORTAL_URL: process.env.PORTAL_URL || '',
  // URL de la plataforma interna, para los avisos al personal (vencimientos
  // documentales). Si falta, se deduce del portal, que vive en /portal.
  APP_URL: (process.env.APP_URL || (process.env.PORTAL_URL || '').replace(/\/portal\/?$/, '')).replace(/\/+$/, ''),
};
