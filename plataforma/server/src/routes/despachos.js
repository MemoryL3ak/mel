// Cadena física del material, según el flujo real del proceso:
//   MEL (patios) → La Negra (vendor: recibe, pesa, clasifica/reduce)
//   La Negra → Lampa (vendor: consolida y traslada; Lampa emite el
//   certificado de disposición final).
import { Router } from 'express';
import multer from 'multer';
import { supa, q, ah, folio, audit, precioVigente, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

// Evidencia fotográfica: hasta 6 imágenes de 5 MB por guía, en el bucket
// privado "evidencia" (rutas GD/<id>/...); se sirven con URLs firmadas.
const subir = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)),
});
const DESP_SEL = '*, patios(codigo, nombre), cat:categorias!despachos_categoria_id_fkey(nombre), catf:categorias!despachos_categoria_final_id_fkey(nombre), estados_pago(folio)';
const TRAS_SEL = '*, categorias(nombre)';

const view = (d) => ({
  id: d.id, guia: d.guia, fecha: d.fecha, estado: d.estado, fotos: d.fotos,
  patio: d.patios?.codigo, patio_nombre: d.patios?.nombre,
  categoria: d.cat?.nombre, categoria_final: d.catf?.nombre ?? null,
  kg_origen: Number(d.kg_origen), kg_destino: d.kg_destino == null ? null : Number(d.kg_destino),
  dif_pct: d.kg_destino == null ? null : Math.round(((d.kg_destino - d.kg_origen) / d.kg_origen) * 10000) / 100,
  precio_kg: d.precio_kg == null ? null : Number(d.precio_kg),
  valor: d.valor == null ? null : Number(d.valor),
  obs_recepcion: d.obs_recepcion, recepcionado_el: d.recepcionado_el && fmtFecha(d.recepcionado_el),
  ep_folio: d.estados_pago?.folio ?? null, creado_por: d.creado_por,
});

/* ---------- despachos MEL → La Negra ---------- */

r.get('/despachos', auth(), ah(async (_req, res) => {
  const rows = await q(supa.from('despachos').select(DESP_SEL).order('id', { ascending: false }).limit(300));
  res.json(rows.map(view));
}));

r.post('/despachos', auth('limpieza', 'ito', 'coordinador'), subir.array('fotos', 6), ah(async (req, res) => {
  const { patio_id, categoria_id, kg_origen } = req.body || {};
  if (!patio_id || !categoria_id || !(Number(kg_origen) > 0)) {
    return res.status(400).json({ error: 'Patio, categoría y peso de báscula son obligatorios' });
  }
  const archivos = req.files ?? [];
  const guia = await folio('GD');
  const row = await q(supa.from('despachos').insert({
    guia, patio_id: Number(patio_id), categoria_id: Number(categoria_id), kg_origen: Number(kg_origen),
    fotos: archivos.length, creado_por: req.user.name,
  }).select(DESP_SEL).single());

  for (const [i, f] of archivos.entries()) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f.mimetype];
    const { error } = await supa.storage.from('evidencia')
      .upload(`GD/${row.id}/${i + 1}.${ext}`, f.buffer, { contentType: f.mimetype });
    if (error) console.error('[GEA] evidencia:', error.message);
  }
  await audit(req.user.name, req.user.role, 'Registró despacho a La Negra',
    `${guia} · ${kg_origen} kg · ${archivos.length} foto(s)`);
  res.json(view(row));
}));

// URLs firmadas (1 hora) de la evidencia de una guía.
r.get('/despachos/:id/evidencia', auth(), ah(async (req, res) => {
  const carpeta = `GD/${Number(req.params.id)}`;
  const { data: lista, error } = await supa.storage.from('evidencia').list(carpeta);
  if (error) throw new Error(error.message);
  if (!lista?.length) return res.json({ urls: [] });
  const { data: firmadas, error: e2 } = await supa.storage.from('evidencia')
    .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
  if (e2) throw new Error(e2.message);
  res.json({ urls: firmadas.filter((f) => f.signedUrl).map((f) => f.signedUrl) });
}));

// Recepción y pesaje en La Negra. Diferencia > 2% queda observada para el ITO.
// El vendor puede reclasificar ("reducir") la carga: el precio se congela con
// la categoría final al momento de la recepción.
r.post('/despachos/:id/recepcionar', auth('vendor', 'ito', 'coordinador'), ah(async (req, res) => {
  const kg = Number(req.body?.kg_destino);
  if (!(kg > 0)) return res.status(400).json({ error: 'Ingrese el peso validado en báscula de La Negra' });

  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (d.estado !== 'en_transito') return res.status(409).json({ error: 'El despacho ya fue recepcionado' });

  const catFinal = req.body?.categoria_final_id || d.categoria_id;
  const precio = await precioVigente(catFinal, d.fecha);
  const dif = Math.abs((kg - Number(d.kg_origen)) / Number(d.kg_origen));
  const observado = dif > 0.02;

  const row = await q(supa.from('despachos').update({
    kg_destino: kg,
    categoria_final_id: catFinal === d.categoria_id ? null : catFinal,
    estado: observado ? 'observado' : 'recepcionado',
    obs_recepcion: req.body?.observacion || (observado ? `Diferencia de peso ${(dif * 100).toFixed(2)}%` : null),
    precio_kg: precio,
    valor: Math.round(kg * precio),
    recepcionado_por: req.user.name,
    recepcionado_el: new Date().toISOString(),
  }).eq('id', req.params.id).select(DESP_SEL).single());

  await audit(req.user.name, req.user.role,
    observado ? 'Recepción observada en La Negra (dif. > 2%)' : 'Recepción validada en La Negra',
    `${row.guia} · ${kg} kg`);
  res.json(view(row));
}));

// El ITO resuelve una recepción observada (la valida tras revisar).
r.post('/despachos/:id/resolver', auth('ito', 'coordinador'), ah(async (req, res) => {
  const obs = (req.body?.observacion || '').trim();
  if (!obs) return res.status(400).json({ error: 'Indique cómo se resolvió la diferencia' });
  const row = await q(supa.from('despachos')
    .update({ estado: 'recepcionado', obs_recepcion: obs })
    .eq('id', req.params.id).eq('estado', 'observado').select(DESP_SEL).single());
  await audit(req.user.name, req.user.role, 'Resolvió recepción observada', `${row.guia} · ${obs}`);
  res.json(view(row));
}));

/* ---------- traslados La Negra → Lampa ---------- */

r.get('/traslados', auth(), ah(async (_req, res) => {
  const rows = await q(supa.from('traslados').select(TRAS_SEL).order('id', { ascending: false }).limit(300));
  res.json(rows.map((t) => ({
    ...t, kg: Number(t.kg), kg_lampa: t.kg_lampa == null ? null : Number(t.kg_lampa),
    categoria: t.categorias?.nombre, recepcionado_el: t.recepcionado_el && fmtFecha(t.recepcionado_el),
  })));
}));

r.post('/traslados', auth('vendor', 'coordinador'), ah(async (req, res) => {
  const { categoria_id, kg } = req.body || {};
  if (!categoria_id || !(Number(kg) > 0)) return res.status(400).json({ error: 'Categoría y kilos son obligatorios' });
  const guia = await folio('GT');
  const row = await q(supa.from('traslados').insert({
    guia, categoria_id, kg: Number(kg), creado_por: req.user.name,
  }).select(TRAS_SEL).single());
  await audit(req.user.name, req.user.role, 'Despachó traslado a Lampa', `${guia} · ${kg} kg`);
  res.json(row);
}));

// Recepción en Lampa: pesa y emite el certificado de disposición final (CDF).
r.post('/traslados/:id/recepcionar', auth('vendor', 'coordinador'), ah(async (req, res) => {
  const kg = Number(req.body?.kg_lampa);
  if (!(kg > 0)) return res.status(400).json({ error: 'Ingrese el peso validado en báscula de Lampa' });
  const t = await q(supa.from('traslados').select('*').eq('id', req.params.id).single());
  if (t.estado !== 'en_transito') return res.status(409).json({ error: 'El traslado ya fue recepcionado' });

  const cert = await folio('CDF');
  const row = await q(supa.from('traslados').update({
    estado: 'recepcionado', kg_lampa: kg, cert_folio: cert,
    recepcionado_el: new Date().toISOString(),
  }).eq('id', req.params.id).select(TRAS_SEL).single());
  await audit(req.user.name, req.user.role, 'Recepcionó en Lampa y emitió certificado de disposición final', `${row.guia} → ${cert}`);
  res.json(row);
}));

export default r;
