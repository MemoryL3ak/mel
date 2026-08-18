import jwt from 'jsonwebtoken';
import { db } from './db.js';

export const SECRET = process.env.GEA_JWT_SECRET || 'gea-dev-secret';

export function login(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || u.password !== password) return null; // demo: en producción, hash + política de credenciales corporativas
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
