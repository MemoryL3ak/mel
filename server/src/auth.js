import jwt from 'jsonwebtoken';
import { supa, q } from './supa.js';

export const SECRET = process.env.GEA_JWT_SECRET || 'gea-dev-secret';

export async function login(username, password) {
  const rows = await q(supa.from('users').select('*').eq('username', username).limit(1));
  const u = rows[0];
  if (!u || u.password !== password) return null; // demo: en producción, Supabase Auth + credenciales corporativas
  const user = { id: u.id, username: u.username, name: u.name, role: u.role, comprador_id: u.comprador_id };
  return { token: jwt.sign(user, SECRET, { expiresIn: '12h' }), user };
}

// Middleware RBAC: auth() = cualquier usuario autenticado; auth('ito','coordinador') = solo esos roles.
export function auth(...roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Sesión expirada' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Su perfil no tiene acceso a esta acción' });
    }
    next();
  };
}
