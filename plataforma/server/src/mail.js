// Correo saliente del portal de obsoletos.
//
// Proveedor preferente: Resend (API HTTP, solo RESEND_API_KEY). Alternativa:
// SMTP (nodemailer) para SES/Gmail/etc. Degradación con gracia: sin ninguno
// configurado NO se envía nada, se registra en el log y el flujo sigue igual.
// enviarCorreo() nunca hace fallar la operación que lo dispara.
import { env } from './env.js';

const via = env.RESEND_API_KEY ? 'resend' : env.SMTP_HOST ? 'smtp' : 'log';
export const correoActivo = via !== 'log';

let smtp = null; // transporte nodemailer perezoso, solo si se usa SMTP

// Resend: un POST a su API REST. Node ya trae fetch, sin dependencias.
async function enviarPorResend({ to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function enviarPorSmtp({ to, subject, html, text }) {
  if (!smtp) {
    const { default: nodemailer } = await import('nodemailer');
    smtp = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  await smtp.sendMail({ from: env.MAIL_FROM, to, subject, html, text });
}

// Envía sin bloquear ni romper el flujo llamador. Devuelve true/false.
export async function enviarCorreo({ to, subject, html, text }) {
  if (!to) return false;
  const cuerpoTexto = text || html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (via === 'log') {
    console.log(`[GEA] correo NO enviado (sin proveedor) → ${to} · ${subject}`);
    return false;
  }
  try {
    if (via === 'resend') await enviarPorResend({ to, subject, html, text: cuerpoTexto });
    else await enviarPorSmtp({ to, subject, html, text: cuerpoTexto });
    return true;
  } catch (e) {
    console.error(`[GEA] correo falló (${via}) → ${to} · ${subject}: ${e.message}`);
    return false;
  }
}

// Plantilla mínima y sobria, coherente con la marca GEA. Por defecto es la del
// portal de venta; los avisos al personal interno pasan su propio encabezado,
// pie y enlace.
export function plantilla({
  titulo, cuerpo, cta, url = env.PORTAL_URL,
  encabezado = 'Venta de componentes industriales',
  pie = 'Este es un correo automático del portal de venta de obsoletos de Minera Escondida.',
}) {
  const link = cta && url
    ? `<p style="margin:22px 0 4px"><a href="${url}" style="background:#A4562E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${cta}</a></p>`
    : '';
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#221D18">
    <div style="background:#232930;color:#EDEAE6;padding:20px 24px;border-radius:12px 12px 0 0">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9AA3AC">GEA · Minera Escondida</div>
      <div style="font-size:18px;font-weight:800;margin-top:4px">${encabezado}</div>
    </div>
    <div style="border:1px solid #E5E0D8;border-top:0;border-radius:0 0 12px 12px;padding:22px 24px">
      <h2 style="font-size:17px;margin:0 0 10px">${titulo}</h2>
      <div style="font-size:14px;line-height:1.6;color:#3a352f">${cuerpo}</div>
      ${link}
      <p style="font-size:11px;color:#948B80;margin-top:22px">${pie}</p>
    </div>
  </div>`;
}
