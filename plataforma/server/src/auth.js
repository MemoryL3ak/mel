// Autenticación: credenciales con bcrypt, sesión con JWT de 12 horas.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { supa, q, audit } from './supa.js';

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
  res.json({ token, user: { id: u.id, username: u.username, name: u.nombre, role: u.role } });
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
