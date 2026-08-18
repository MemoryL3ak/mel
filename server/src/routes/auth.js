import { Router } from 'express';
import { login, auth } from '../auth.js';
import { ah } from '../supa.js';

const r = Router();

// Perfiles de demostración que muestra la pantalla de ingreso
const PERFILES = [
  { username: 'limpieza', label: 'Empresa de limpieza de patios', desc: 'Consulta el programa semanal y registra retiros con evidencia.', ini: 'LP', color: '#4E7A5A' },
  { username: 'vendor', label: 'Vendor de chatarra', desc: 'Revisa despachos valorizados y estados de pago; carga comprobantes.', ini: 'VC', color: '#6B5E7C' },
  { username: 'ito', label: 'ITO', desc: 'Valida despachos y recepciones, aplica descuentos, prepara el EP.', ini: 'IT', color: '#2F6DA3' },
  { username: 'coordinador', label: 'Coordinador Logístico MEL', desc: 'Dueño del proceso: aprueba estados de pago y bajas, ve todo.', ini: 'CL', color: '#A4562E' },
  { username: 'adminventa', label: 'Adm. Plataforma de Venta Web', desc: 'Publica componentes, gestiona ofertas y emite adjudicaciones.', ini: 'AV', color: '#8A6116' },
  { username: 'comprador', label: 'Comprador externo', desc: 'Usuario autoregistrado: consulta publicaciones y presenta ofertas.', ini: 'CO', color: '#38434E' },
];

r.get('/perfiles', (_req, res) => res.json(PERFILES));

r.post('/login', ah(async (req, res) => {
  const { username, password } = req.body || {};
  const out = await login(username, password);
  if (!out) return res.status(401).json({ error: 'Credenciales inválidas' });
  res.json(out);
}));

r.get('/me', auth(), (req, res) => res.json(req.user));

export default r;
