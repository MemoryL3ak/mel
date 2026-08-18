import { Router } from 'express';
import { supa, q, ah, audit, hoy } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();
const OPER = ['limpieza', 'ito', 'coordinador'];
const LECT = ['limpieza', 'vendor', 'ito', 'coordinador'];

const finMes = (periodo) => periodo + '-31'; // límite superior inclusivo para fechas 'YYYY-MM-DD'

/* ---------- maestros ---------- */
r.get('/maestros', auth(), ah(async (_req, res) => {
  const [patios, categorias] = await Promise.all([
    q(supa.from('patios').select('*').order('id')),
    q(supa.from('categorias').select('*').order('nombre')),
  ]);
  res.json({ patios, categorias });
}));

/* ---------- programa de limpieza ---------- */
r.get('/programa', auth(...OPER), ah(async (_req, res) => {
  const rows = (await q(
    supa.from('programa').select('*, patios(nombre)').order('semana', { ascending: false }).order('id')
  )).map((p) => ({ ...p, patio: p.patios?.nombre, patios: undefined }));
  res.json({ semanas: [...new Set(rows.map((x) => x.semana))], rows });
}));

r.post('/programa/:id/ejecutar', auth(...OPER), ah(async (req, res) => {
  const { real_ton } = req.body || {};
  if (!real_ton || real_ton <= 0) return res.status(400).json({ error: 'Indique el tonelaje real retirado' });
  const rows = await q(
    supa.from('programa').update({ real_ton, estado: 'ejecutado' }).eq('id', req.params.id).select()
  );
  if (!rows.length) return res.status(404).json({ error: 'Retiro programado no encontrado' });
  if (!rows[0].fecha) await q(supa.from('programa').update({ fecha: hoy() }).eq('id', req.params.id).select('id'));
  audit(req.user.name, req.user.role, 'Registró ejecución de retiro programado', 'PRG-' + req.params.id);
  res.json({ ok: true });
}));

/* ---------- despachos y recepciones ---------- */
const DESP_SEL = '*, patios(nombre), categorias(nombre, precio_kg), estados_pago(folio)';
const despView = (d) => ({
  ...d,
  patio: d.patios?.nombre,
  categoria: d.categorias?.nombre,
  precio_kg: d.categorias?.precio_kg,
  valor: Math.round((d.kg_destino ?? d.kg_origen) * (d.categorias?.precio_kg ?? 0)),
  ep_folio: d.estados_pago?.folio ?? null,
  patios: undefined, categorias: undefined, estados_pago: undefined,
});

r.get('/despachos', auth(...LECT), ah(async (_req, res) => {
  const rows = await q(
    supa.from('despachos').select(DESP_SEL)
      .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(60)
  );
  res.json(rows.map(despView));
}));

r.get('/despachos/:id', auth(...LECT), ah(async (req, res) => {
  const d = await q(supa.from('despachos').select(DESP_SEL).eq('id', req.params.id).maybeSingle());
  if (!d) return res.status(404).json({ error: 'Despacho no encontrado' });
  res.json(despView(d));
}));

r.post('/despachos', auth(...OPER), ah(async (req, res) => {
  const { patio_id, categoria_id, kg_origen, fotos = 2 } = req.body || {};
  if (!patio_id || !categoria_id || !kg_origen) return res.status(400).json({ error: 'Patio, categoría y peso son obligatorios' });
  const guias = await q(supa.from('despachos').select('guia'));
  const last = guias.reduce((m, g) => Math.max(m, parseInt(g.guia.slice(3)) || 0), 4500);
  const guia = 'GD-' + (last + 1);
  await q(supa.from('despachos').insert({ guia, fecha: hoy(), patio_id, categoria_id, kg_origen, fotos }).select('id'));
  audit(req.user.name, req.user.role, 'Registró retiro con evidencia', guia);
  const d = await q(supa.from('despachos').select(DESP_SEL).eq('guia', guia).single());
  res.status(201).json(despView(d));
}));

r.post('/despachos/:id/recepcionar', auth('ito', 'coordinador', 'vendor'), ah(async (req, res) => {
  const { kg_destino } = req.body || {};
  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).maybeSingle());
  if (!d) return res.status(404).json({ error: 'Despacho no encontrado' });
  if (!kg_destino || kg_destino <= 0) return res.status(400).json({ error: 'Indique el peso validado en destino' });
  const dif = Math.abs(kg_destino - d.kg_origen) / d.kg_origen;
  const estado = dif > 0.02 ? 'observado' : 'recepcionado';
  await q(supa.from('despachos').update({ kg_destino, estado }).eq('id', d.id).select('id'));
  audit(req.user.name, req.user.role, estado === 'observado' ? 'Recepción observada (dif. de peso >2%)' : 'Validó recepción', d.guia);
  res.json({ ok: true, estado });
}));

/* ---------- valorización ---------- */
r.get('/valorizacion', auth('vendor', 'ito', 'coordinador'), ah(async (_req, res) => {
  const mes = hoy().slice(0, 7);
  const [categorias, desp] = await Promise.all([
    q(supa.from('categorias').select('*').order('precio_kg', { ascending: false })),
    q(supa.from('despachos').select('categoria_id, kg_origen, kg_destino').gte('fecha', mes + '-01').lte('fecha', finMes(mes))),
  ]);
  const resumen = categorias.map((c) => {
    const kg = desp.filter((d) => d.categoria_id === c.id)
      .reduce((s, d) => s + (d.kg_destino ?? d.kg_origen), 0);
    return { nombre: c.nombre, precio_kg: c.precio_kg, kg, valor: Math.round(kg * c.precio_kg) };
  }).sort((a, b) => b.valor - a.valor);
  res.json({ contrato: 'CTR-MEL-2025-114', vendor: 'Metarec SpA', vigencia: '2026-12-31', mes, categorias, resumen });
}));

/* ---------- estados de pago ---------- */
async function epsView() {
  const [eps, descs, pagos, desp] = await Promise.all([
    q(supa.from('estados_pago').select('*').order('periodo', { ascending: false })),
    q(supa.from('descuentos').select('*')),
    q(supa.from('pagos_vendor').select('*').order('fecha')),
    q(supa.from('despachos').select('id, ep_id, kg_destino, categorias(nombre, precio_kg)').not('ep_id', 'is', null)),
  ]);
  return eps.map((ep) => {
    const descuentos = descs.filter((x) => x.ep_id === ep.id);
    const pagosEp = pagos.filter((x) => x.ep_id === ep.id);
    const propios = desp.filter((x) => x.ep_id === ep.id);
    const porCat = {};
    propios.forEach((x) => {
      const L = (porCat[x.categorias.nombre] ??= { nombre: x.categorias.nombre, n: 0, kg: 0, monto: 0 });
      L.n += 1; L.kg += x.kg_destino; L.monto += x.kg_destino * x.categorias.precio_kg;
    });
    const lineas = Object.values(porCat)
      .map((l) => ({ ...l, monto: Math.round(l.monto) }))
      .sort((a, b) => b.monto - a.monto);
    const pagado = pagosEp.reduce((s, x) => s + x.monto, 0);
    return {
      ...ep, descuentos, pagos: pagosEp, pagado, n_despachos: propios.length, lineas,
      conciliacion: ep.estado !== 'aprobado' ? null : pagado >= ep.total ? 'conciliado' : pagado > 0 ? 'parcial' : 'pendiente',
      pct_pagado: ep.total ? Math.round((pagado / ep.total) * 100) : 0,
    };
  });
}
const epView = async (id) => (await epsView()).find((e) => e.id === +id);

r.get('/eps', auth('vendor', 'ito', 'coordinador'), ah(async (_req, res) => {
  res.json(await epsView());
}));

r.post('/eps/generar', auth('ito', 'coordinador'), ah(async (req, res) => {
  const periodo = (req.body && req.body.periodo) || hoy().slice(0, 7);
  const existe = await q(supa.from('estados_pago').select('id').eq('periodo', periodo));
  if (existe.length) return res.status(409).json({ error: `Ya existe un estado de pago para el período ${periodo}` });
  const pend = await q(
    supa.from('despachos').select('id, kg_destino, categorias(precio_kg)')
      .is('ep_id', null).in('estado', ['recepcionado', 'observado'])
      .gte('fecha', periodo + '-01').lte('fecha', finMes(periodo))
  );
  if (!pend.length) return res.status(400).json({ error: 'No hay despachos recepcionados sin EP en ese período' });
  const bruto = Math.round(pend.reduce((s, d) => s + d.kg_destino * d.categorias.precio_kg, 0));
  const [ep] = await q(supa.from('estados_pago').insert({ folio: 'EP-' + periodo, periodo, bruto, total: bruto }).select());
  await q(supa.from('despachos').update({ ep_id: ep.id }).in('id', pend.map((d) => d.id)).select('id'));
  audit(req.user.name, req.user.role, 'Generó estado de pago', ep.folio);
  res.status(201).json(await epView(ep.id));
}));

async function recalcularEP(epId) {
  const [descs, ep] = await Promise.all([
    q(supa.from('descuentos').select('monto').eq('ep_id', epId)),
    q(supa.from('estados_pago').select('bruto').eq('id', epId).single()),
  ]);
  const total = ep.bruto - descs.reduce((s, d) => s + d.monto, 0);
  await q(supa.from('estados_pago').update({ total }).eq('id', epId).select('id'));
}

r.post('/eps/:id/descuentos', auth('ito', 'coordinador'), ah(async (req, res) => {
  const { concepto, monto } = req.body || {};
  if (!concepto || !monto) return res.status(400).json({ error: 'Concepto y monto son obligatorios' });
  await q(supa.from('descuentos').insert({ ep_id: +req.params.id, concepto, monto }).select('id'));
  await recalcularEP(req.params.id);
  const ep = await epView(req.params.id);
  audit(req.user.name, req.user.role, `Registró descuento: ${concepto}`, ep.folio);
  res.json(ep);
}));

r.post('/eps/:id/aprobar', auth('coordinador'), ah(async (req, res) => {
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).maybeSingle());
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  if (ep.estado !== 'en_aprobacion') return res.status(409).json({ error: 'El EP no está en aprobación' });
  await q(supa.from('estados_pago')
    .update({ estado: 'aprobado', aprobado_por: req.user.name, fecha_aprobacion: hoy() })
    .eq('id', ep.id).select('id'));
  audit(req.user.name, req.user.role, 'Aprobó estado de pago', ep.folio);
  res.json(await epView(ep.id));
}));

r.post('/eps/:id/rechazar', auth('coordinador'), ah(async (req, res) => {
  const { observacion } = req.body || {};
  if (!observacion || !observacion.trim())
    return res.status(400).json({ error: 'La observación es obligatoria para rechazar' });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).maybeSingle());
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  await q(supa.from('estados_pago').update({ estado: 'rechazado', observacion: observacion.trim() }).eq('id', ep.id).select('id'));
  audit(req.user.name, req.user.role, `Rechazó EP con observación: "${observacion.trim()}"`, ep.folio);
  res.json(await epView(ep.id));
}));

r.post('/eps/:id/pagos', auth('vendor', 'ito', 'coordinador'), ah(async (req, res) => {
  const { monto, comprobante } = req.body || {};
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).maybeSingle());
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  if (ep.estado !== 'aprobado') return res.status(409).json({ error: 'Solo se concilian pagos de EP aprobados' });
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Indique el monto transferido' });
  await q(supa.from('pagos_vendor').insert({ ep_id: ep.id, fecha: hoy(), monto, comprobante: comprobante || null }).select('id'));
  audit(req.user.name, req.user.role, `Registró pago recibido ($${monto.toLocaleString('es-CL')})`, ep.folio);
  res.json(await epView(ep.id));
}));

export default r;
