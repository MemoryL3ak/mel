// Administración de cuentas (solo Coordinador): crear, activar/desactivar y
// restablecer contraseñas. Las contraseñas se muestran UNA vez y viajan
// cifradas con bcrypt; nunca se almacenan ni se vuelven a mostrar.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { supa, q, ah, audit } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();
const ROLES = ['limpieza', 'vendor', 'ito', 'coordinador'];
const clave = () => randomBytes(9).toString('base64url');

r.get('/usuarios', auth('coordinador'), ah(async (_req, res) => {
  const rows = await q(supa.from('users').select('id, username, nombre, role, activo, creado_el').order('id'));
  res.json(rows);
}));

r.post('/usuarios', auth('coordinador'), ah(async (req, res) => {
  const username = String(req.body?.username || '').toLowerCase().trim();
  const nombre = String(req.body?.nombre || '').trim();
  const role = req.body?.role;
  if (!/^[a-z0-9._-]{3,24}$/.test(username)) return res.status(400).json({ error: 'Usuario inválido: 3-24 caracteres, minúsculas, números, punto o guion' });
  if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol inválido' });

  const existe = await q(supa.from('users').select('id').eq('username', username));
  if (existe.length) return res.status(409).json({ error: `El usuario «${username}» ya existe` });

  const password = clave();
  const row = await q(supa.from('users').insert({
    username, nombre, role, password_hash: await bcrypt.hash(password, 10),
  }).select('id, username, nombre, role, activo, creado_el').single());
  await audit(req.user.name, req.user.role, 'Creó cuenta de usuario', `${username} (${role})`);
  res.json({ user: row, password });
}));

r.post('/usuarios/:id/reset', auth('coordinador'), ah(async (req, res) => {
  const password = clave();
  const row = await q(supa.from('users')
    .update({ password_hash: await bcrypt.hash(password, 10) })
    .eq('id', req.params.id).select('id, username').single());
  await audit(req.user.name, req.user.role, 'Restableció contraseña', row.username);
  res.json({ username: row.username, password });
}));

r.patch('/usuarios/:id', auth('coordinador'), ah(async (req, res) => {
  const id = Number(req.params.id);
  const activo = !!req.body?.activo;
  if (id === Number(req.user.sub) && !activo) {
    return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
  }
  const row = await q(supa.from('users').update({ activo })
    .eq('id', id).select('id, username, nombre, role, activo, creado_el').single());
  await audit(req.user.name, req.user.role, activo ? 'Activó cuenta' : 'Desactivó cuenta', row.username);
  res.json(row);
}));

export default r;
