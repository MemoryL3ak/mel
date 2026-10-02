// Autenticación: credenciales con bcrypt, sesión con JWT de 12 horas.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { supa, q, audit } from './supa.js';
import { tiene } from './esquema.js';

const TTL = '12h';

export async function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });

  const rows = await q(supa.from('users').select('*').eq('username', String(username).toLowerCase().trim()).limit(1));
  const u = rows[0];
  const ok = u && u.activo && (await bcrypt.compare(password, u.password_hash));
  if (!ok) {
    // Misma respuesta exista o no el usuario: no se filtra información.
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = jwt.sign(
    { sub: u.id, username: u.username, name: u.nombre, role: u.role, app_role: u.role },
    env.JWT_SECRET,
    { expiresIn: TTL }
  );
  await audit(u.nombre, u.role, 'Inicio de sesión');
  res.json({
    token,
    user: {
      id: u.id, username: u.username, name: u.nombre, role: u.role,
      // Avisa al cliente que la contraseña vigente es la que entregó el
      // coordinador, para ofrecerle cambiarla por una propia.
      clave_inicial: tiene.clave_inicial ? !!u.clave_inicial : false,
    },
  });
}

// Cambio de la propia contraseña. Exige la actual: con la sesión robada de un
// equipo abierto no basta para dejar al dueño afuera.
export async function cambiarClave(req, res) {
  const actual = String(req.body?.actual || '');
  const nueva = String(req.body?.nueva || '');
  if (!actual || !nueva) return res.status(400).json({ error: 'Ingrese su contraseña actual y la nueva' });
  if (nueva.length < 8) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
  if (nueva === actual) return res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual' });

  const u = await q(supa.from('users').select('*').eq('id', req.user.sub).maybeSingle());
  if (!u || !u.activo) return res.status(401).json({ error: 'Sesión inválida' });
  if (!(await bcrypt.compare(actual, u.password_hash))) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }

  await q(supa.from('users').update({
    password_hash: await bcrypt.hash(nueva, 10),
    ...(tiene.clave_inicial ? { clave_inicial: false } : {}),
  }).eq('id', u.id).select('id').single());
  await audit(u.nombre, u.role, 'Cambió su contraseña');
  res.json({ ok: true });
}

// Middleware: exige sesión válida y, si se indican, roles específicos.
export const auth = (...roles) => (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sesión requerida' });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (roles.length && !roles.includes(payload.role)) {
      return res.status(403).json({ error: 'Su perfil no tiene permiso para esta acción' });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión expirada: vuelva a iniciar sesión' });
  }
};
