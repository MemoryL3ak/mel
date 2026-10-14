// Recuperación de contraseña por correo.
//
// Quien olvidó su clave pide un enlace con su correo. El enlace trae un token
// firmado que vence en 30 minutos y sirve una sola vez. "Una sola vez" sin
// tabla de tokens: el token lleva una huella de la clave vigente, así que en
// cuanto la clave cambia (por este enlace o por cualquier otra vía, como el
// restablecimiento del coordinador) todos los enlaces anteriores dejan de servir.
//
// Las cuentas internas se buscan por su correo registrado; las de comprador,
// por su usuario, que es el correo con que se registraron. Las cuentas
// genéricas sin correo (coordinador, ito…) las sigue restableciendo el
// coordinador desde Cuentas de usuario.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { supa, q, audit } from './supa.js';
import { tiene } from './esquema.js';
import { enviarCorreo, plantilla } from './mail.js';

// Clave de firma propia, derivada de la de sesión: un token de recuperación
// nunca puede pasar por uno de sesión, ni al revés, aunque ambos sean JWT.
const SECRETO = crypto.createHash('sha256').update(`${env.JWT_SECRET}:recuperar-clave`).digest('hex');
const VIGENCIA_MIN = 30;
const huella = (hash) => crypto.createHash('sha256').update(String(hash)).digest('hex').slice(0, 16);
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const origenDe = (url) => { try { return new URL(url).origin; } catch { return null; } };

// Misma respuesta exista o no la cuenta: el formulario no sirve para averiguar
// qué correos están registrados.
const RESPUESTA = {
  ok: true,
  mensaje: 'Si el correo corresponde a una cuenta activa, le enviamos un enlace para definir una nueva contraseña. '
    + `Vence en ${VIGENCIA_MIN} minutos. Revise también la carpeta de spam.`,
};

// Dirección base del enlace. Se usa el origen de la página que pidió la
// recuperación SOLO si es un dominio propio: tomarlo a ciegas permitiría pedir
// un enlace para otra persona con un origen falso y recibir el token en un
// sitio ajeno. En desarrollo se acepta localhost si la plataforma corre ahí.
export function baseEnlace(req) {
  const propios = new Set([...env.CORS_ORIGIN, origenDe(env.APP_URL), origenDe(env.PORTAL_URL)].filter(Boolean));
  const o = req.headers.origin;
  const local = /^http:\/\/localhost(:\d+)?$/.test(o || '') && /^http:\/\/localhost/.test(env.APP_URL || '');
  const raiz = o && (propios.has(o) || local) ? o : origenDe(env.APP_URL);
  return raiz ? raiz.replace(/\/+$/, '') : null;
}

export async function solicitar(req, res) {
  const correo = String(req.body?.correo || '').trim().toLowerCase();
  const portal = req.body?.ambito === 'portal';
  if (!CORREO.test(correo)) return res.status(400).json({ error: 'Ingrese un correo válido' });

  // Comparación exacta (los correos se guardan en minúsculas): un patrón con
  // comodines podría calzar con la cuenta de otra persona.
  let cuentas = [];
  if (portal) {
    cuentas = await q(supa.from('users').select('id, username, nombre, role, password_hash, activo')
      .eq('role', 'comprador').eq('username', correo));
  } else if (tiene.user_email) {
    cuentas = await q(supa.from('users').select('id, username, nombre, role, password_hash, activo, email')
      .neq('role', 'comprador').eq('email', correo));
  }
  const u = cuentas.find((x) => x.activo);
  if (!u) return res.json(RESPUESTA);

  const raiz = baseEnlace(req);
  if (!raiz) {
    console.error('[GEA] recuperar clave: no hay dirección para armar el enlace (configure APP_URL o CORS_ORIGIN)');
    return res.json(RESPUESTA);
  }
  const token = jwt.sign({ sub: u.id, h: huella(u.password_hash), prp: 'recuperar' }, SECRETO, { expiresIn: `${VIGENCIA_MIN}m` });
  const enlace = `${raiz}/restablecer?t=${encodeURIComponent(token)}${portal ? '&a=portal' : ''}`;
  // El correo va a la dirección registrada de la cuenta, no a la digitada.
  const destino = portal ? u.username : u.email;
  enviarCorreo({
    to: destino,
    subject: 'Recuperar contraseña · GEA',
    html: plantilla({
      ...(portal ? {} : {
        encabezado: 'Recuperación de acceso',
        pie: 'Este es un aviso automático de la plataforma GEA de Minera Escondida.',
      }),
      titulo: 'Defina una nueva contraseña',
      cuerpo: `Recibimos una solicitud para restablecer la contraseña de la cuenta <b>${u.username}</b> (${u.nombre}). `
        + `El enlace vence en ${VIGENCIA_MIN} minutos y sirve una sola vez.<br><br>`
        + 'Si usted no lo pidió, ignore este correo: su contraseña actual sigue funcionando.',
      cta: 'Definir nueva contraseña',
      url: enlace,
    }),
  });
  await audit(u.nombre, u.role, 'Solicitó recuperar su contraseña', destino);
  res.json(RESPUESTA);
}

// Valida el token y devuelve la cuenta, o el motivo por el que no sirve.
async function cuentaDelToken(t) {
  let p;
  try {
    p = jwt.verify(String(t || ''), SECRETO);
  } catch (e) {
    return { error: e.name === 'TokenExpiredError'
      ? 'El enlace venció. Pida uno nuevo desde la pantalla de inicio de sesión.'
      : 'El enlace no es válido. Pida uno nuevo desde la pantalla de inicio de sesión.' };
  }
  if (p.prp !== 'recuperar') return { error: 'El enlace no es válido.' };
  const u = await q(supa.from('users').select('*').eq('id', p.sub).maybeSingle());
  if (!u || !u.activo) return { error: 'La cuenta no está activa. Contacte al Coordinador Logístico MEL.' };
  if (huella(u.password_hash) !== p.h) {
    return { error: 'Este enlace ya se usó o la contraseña cambió después de pedirlo. Pida uno nuevo.' };
  }
  return { u };
}

export async function validar(req, res) {
  const { u, error } = await cuentaDelToken(req.body?.t);
  if (error) return res.status(400).json({ error });
  res.json({ ok: true, usuario: u.username, nombre: u.nombre, portal: u.role === 'comprador' });
}

export async function restablecer(req, res) {
  const nueva = String(req.body?.nueva || '');
  if (nueva.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  const { u, error } = await cuentaDelToken(req.body?.t);
  if (error) return res.status(400).json({ error });
  if (await bcrypt.compare(nueva, u.password_hash)) {
    return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la anterior' });
  }

  await q(supa.from('users').update({
    password_hash: await bcrypt.hash(nueva, 10),
    ...(tiene.clave_inicial ? { clave_inicial: false } : {}),
  }).eq('id', u.id).select('id').single());
  await audit(u.nombre, u.role, 'Restableció su contraseña con el enlace del correo');

  // Aviso de que la clave cambió: si no fue el dueño, se entera de inmediato.
  const destino = u.role === 'comprador' ? u.username : u.email;
  if (destino) {
    enviarCorreo({
      to: destino,
      subject: 'Su contraseña fue cambiada · GEA',
      html: plantilla({
        ...(u.role === 'comprador' ? {} : {
          encabezado: 'Recuperación de acceso',
          pie: 'Este es un aviso automático de la plataforma GEA de Minera Escondida.',
        }),
        titulo: 'Contraseña actualizada',
        cuerpo: `La contraseña de la cuenta <b>${u.username}</b> se cambió recién con un enlace de recuperación. `
          + 'Si no fue usted, contacte de inmediato al Coordinador Logístico MEL.',
      }),
    });
  }
  res.json({ ok: true, portal: u.role === 'comprador' });
}
