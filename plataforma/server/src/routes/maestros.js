// Maestros y valorización: patios, categorías con precio vigente, historial de precios.
import { Router } from 'express';
import { supa, q, ah, hoy, audit } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

r.get('/maestros', auth(), ah(async (_req, res) => {
  const [patios, categorias, precios, sitios] = await Promise.all([
    q(supa.from('patios').select('*').eq('activo', true).order('id')),
    q(supa.from('categorias').select('*').eq('activo', true).order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    q(supa.from('sitios').select('*').order('id')),
  ]);
  // precio vigente por categoría (el más reciente no futuro)
  const h = hoy();
  const vigente = {};
  for (const p of precios) {
    if (p.vigente_desde <= h && !(p.categoria_id in vigente)) vigente[p.categoria_id] = Number(p.precio_kg);
  }
  res.json({
    patios,
    sitios,
    categorias: categorias.map((c) => ({ ...c, precio_kg: vigente[c.id] ?? null })),
  });
}));

r.get('/valorizacion', auth('ito', 'coordinador'), ah(async (_req, res) => {
  const [categorias, precios, desp] = await Promise.all([
    q(supa.from('categorias').select('*').order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    q(supa.from('despachos').select('categoria_id, categoria_final_id, kg_destino, valor').not('kg_destino', 'is', null)),
  ]);
  const h = hoy();
  const porCat = categorias.map((c) => {
    const vig = precios.find((p) => p.categoria_id === c.id && p.vigente_desde <= h);
    const propios = desp.filter((d) => (d.categoria_final_id ?? d.categoria_id) === c.id);
    return {
      ...c,
      precio_kg: vig ? Number(vig.precio_kg) : null,
      vigente_desde: vig?.vigente_desde ?? null,
      kg_ytd: propios.reduce((a, d) => a + Number(d.kg_destino), 0),
      valor_ytd: propios.reduce((a, d) => a + Number(d.valor ?? 0), 0),
    };
  });
  res.json({ categorias: porCat, historial: precios });
}));

// Nueva vigencia de precio (solo Coordinador): no edita, agrega historia.
r.post('/precios', auth('coordinador'), ah(async (req, res) => {
  const { categoria_id, precio_kg, vigente_desde } = req.body || {};
  if (!categoria_id || !(Number(precio_kg) > 0)) return res.status(400).json({ error: 'Categoría y precio válido son obligatorios' });
  const row = await q(supa.from('precios').insert({
    categoria_id, precio_kg: Number(precio_kg),
    vigente_desde: vigente_desde || hoy(), creado_por: req.user.name,
  }).select().single());
  await audit(req.user.name, req.user.role, 'Actualizó precio de contrato', `categoría ${categoria_id} → $${precio_kg}/kg`);
  res.json(row);
}));

export default r;
