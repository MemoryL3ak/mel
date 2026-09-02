// Bitácora de auditoría (solo lectura para la gestión) y matriz de permisos.
import { Router } from 'express';
import { supa, q, ah, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

r.get('/auditoria', auth('ito', 'coordinador'), ah(async (_req, res) => {
  const rows = await q(supa.from('auditoria').select('*').order('id', { ascending: false }).limit(150));
  res.json(rows.map((a) => ({ ...a, fecha: fmtFecha(a.fecha) })));
}));

const MATRIZ = [
  ['Programa de limpieza',        { limpieza: 'full', vendor: 'none', ito: 'part', coordinador: 'full' }],
  ['Despachos MEL → La Negra',    { limpieza: 'full', vendor: 'part', ito: 'full', coordinador: 'full' }],
  ['Recepciones y traslados',     { limpieza: 'none', vendor: 'full', ito: 'part', coordinador: 'full' }],
  ['Valorización y precios',      { limpieza: 'none', vendor: 'none', ito: 'part', coordinador: 'full' }],
  ['Cuadratura semanal',          { limpieza: 'none', vendor: 'none', ito: 'full', coordinador: 'full' }],
  ['Estados de pago',             { limpieza: 'none', vendor: 'part', ito: 'full', coordinador: 'full' }],
  ['Auditoría',                   { limpieza: 'none', vendor: 'none', ito: 'part', coordinador: 'full' }],
];

r.get('/seguridad/matriz', auth('ito', 'coordinador'), (_req, res) => {
  res.json({ roles: ['limpieza', 'vendor', 'ito', 'coordinador'], modulos: MATRIZ });
});

export default r;
