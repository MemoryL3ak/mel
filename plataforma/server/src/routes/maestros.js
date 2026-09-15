// Maestros y valorización: patios, categorías con precio vigente, historial de precios.
import { Router } from 'express';
import { supa, q, ah, hoy, audit } from '../supa.js';
import { auth } from '../auth.js';
import { contrato, olvidarContrato, venceElPrecio } from '../contrato.js';
import { tiene } from '../esquema.js';

const r = Router();

// Días que faltan (o que ya pasaron, en negativo) para que venza un precio.
const diasPara = (fecha) =>
  Math.round((new Date(fecha + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000);

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
  const [categorias, precios, desp, cfg] = await Promise.all([
    q(supa.from('categorias').select('*').order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    q(supa.from('despachos').select('categoria_id, categoria_final_id, kg_destino, valor').not('kg_destino', 'is', null)),
    contrato(),
  ]);
  const h = hoy();
  const meses = cfg.meses_vigencia_precio;
  const porCat = categorias.map((c) => {
    const vig = precios.find((p) => p.categoria_id === c.id && p.vigente_desde <= h);
    const propios = desp.filter((d) => (d.categoria_final_id ?? d.categoria_id) === c.id);
    // El contrato fija la vigencia de cada precio: pasado ese plazo hay que
    // renegociar, y la plataforma tiene que avisarlo antes de que ocurra.
    const vence = vig ? venceElPrecio(vig.vigente_desde, meses) : null;
    const dias = vence ? diasPara(vence) : null;
    return {
      ...c,
      precio_kg: vig ? Number(vig.precio_kg) : null,
      vigente_desde: vig?.vigente_desde ?? null,
      vence_el: vence,
      dias_para_vencer: dias,
      estado_precio: vig == null ? 'sin_precio' : dias < 0 ? 'vencido' : dias <= 15 ? 'por_vencer' : 'vigente',
      kg_ytd: propios.reduce((a, d) => a + Number(d.kg_destino), 0),
      valor_ytd: propios.reduce((a, d) => a + Number(d.valor ?? 0), 0),
    };
  });
  res.json({ categorias: porCat, historial: precios, meses_vigencia: meses });
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

// `editable` es false mientras no se aplique la migración que crea la tabla:
// así la pantalla no ofrece un botón que iba a fallar.
r.get('/contrato', auth(), ah(async (_req, res) =>
  res.json({ ...(await contrato()), editable: tiene.contrato })));

r.patch('/contrato', auth('coordinador'), ah(async (req, res) => {
  if (!tiene.contrato) {
    return res.status(503).json({ error: 'Esta función requiere aplicar db/0003_ep_contrato.sql en la base de datos' });
  }
  const permitidos =['numero', 'gerencia', 'glosa', 'mandante', 'contratista', 'firma_mandante',
    'firma_contratista', 'monto_original', 'modificaciones', 'iva_pct', 'dia_corte', 'meses_vigencia_precio'];
  const cambios = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const row = await q(supa.from('contrato').update(cambios).eq('id', 1).select().single());
  olvidarContrato();
  await audit(req.user.name, req.user.role, 'Actualizó datos del contrato', Object.keys(cambios).join(', '));
  res.json(row);
}));

export default r;
