import { Router } from 'express';
import { supa, q, ah, audit, hoy, diasDesde } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();
const GEST = ['adminventa', 'coordinador'];
const LIMITE_DIAS = 15;

const COMP_SEL = '*, patios(nombre), comprador_rel:compradores!componentes_adjudicado_a_fkey(razon_social), ofertas(count)';
const compView = (c) => ({
  ...c,
  patio: c.patios?.nombre,
  comprador: c.comprador_rel?.razon_social ?? null,
  n_ofertas: c.ofertas?.[0]?.count ?? 0,
  dias_publicado: c.publicado_el ? diasDesde(c.publicado_el) : null,
  dias_limite: LIMITE_DIAS,
  patios: undefined, comprador_rel: undefined, ofertas: undefined,
});

r.get('/componentes', auth(...GEST), ah(async (_req, res) => {
  await supa.rpc('convertir_vencidos');
  const rows = await q(supa.from('componentes').select(COMP_SEL).order('id', { ascending: false }));
  res.json(rows.map(compView));
}));

r.post('/componentes', auth(...GEST), ah(async (req, res) => {
  const { nombre, descripcion, patio_id, sector, valor_ref } = req.body || {};
  if (!nombre || !patio_id || !valor_ref) return res.status(400).json({ error: 'Nombre, patio y valor referencial son obligatorios' });
  const codigos = await q(supa.from('componentes').select('codigo'));
  const last = codigos.reduce((m, c) => Math.max(m, parseInt(c.codigo.slice(4)) || 0), 200);
  const codigo = 'OBS-' + (last + 1);
  const tonos = ['steel', 'copper', 'green', 'violet'];
  await q(supa.from('componentes').insert({
    codigo, nombre, descripcion: descripcion || '', patio_id, sector: sector || '',
    valor_ref, tono: tonos[(last + 1) % 4],
  }).select('id'));
  audit(req.user.name, req.user.role, 'Ingresó componente al inventario', codigo);
  res.status(201).json({ ok: true, codigo });
}));

r.post('/componentes/:id/publicar', auth(...GEST), ah(async (req, res) => {
  const c = await q(supa.from('componentes').select('*').eq('id', req.params.id).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Componente no encontrado' });
  if (c.estado !== 'planificado') return res.status(409).json({ error: 'Solo se publican componentes planificados' });
  await q(supa.from('componentes').update({ estado: 'publicado', publicado_el: hoy() }).eq('id', c.id).select('id'));
  audit(req.user.name, req.user.role, 'Publicó componente en el portal', c.codigo);
  res.json({ ok: true });
}));

r.get('/componentes/:id/ofertas', auth(...GEST), ah(async (req, res) => {
  const rows = (await q(
    supa.from('ofertas').select('*, compradores(razon_social, due_diligence)')
      .eq('componente_id', req.params.id).order('monto', { ascending: false })
  )).map((o) => ({
    ...o, razon_social: o.compradores?.razon_social, due_diligence: o.compradores?.due_diligence, compradores: undefined,
  }));
  res.json(rows);
}));

r.get('/matriz', auth(...GEST), ah(async (_req, res) => {
  res.json(await q(supa.from('matriz_criterios').select('*').order('peso', { ascending: false })));
}));

r.post('/componentes/:id/adjudicar', auth(...GEST), ah(async (req, res) => {
  const { oferta_id, puntaje } = req.body || {};
  const [c, o] = await Promise.all([
    q(supa.from('componentes').select('*').eq('id', req.params.id).maybeSingle()),
    q(supa.from('ofertas').select('*, compradores(razon_social, due_diligence)')
      .eq('id', oferta_id).eq('componente_id', req.params.id).maybeSingle()),
  ]);
  if (!c || !o) return res.status(404).json({ error: 'Componente u oferta no encontrados' });
  if (c.estado !== 'publicado') return res.status(409).json({ error: 'El componente no está publicado' });
  if (o.compradores.due_diligence !== 'aprobada')
    return res.status(409).json({ error: 'El oferente no tiene la due diligence aprobada' });

  const certs = await q(supa.from('adjudicaciones').select('certificado'));
  const last = certs.reduce((m, x) => Math.max(m, parseInt(x.certificado.slice(8)) || 0), 40);
  const cert = 'CA-2026-' + String(last + 1).padStart(3, '0');

  await q(supa.from('componentes').update({ estado: 'adjudicado', adjudicado_a: o.comprador_id }).eq('id', c.id).select('id'));
  await q(supa.from('ofertas').update({ estado: 'adjudicada' }).eq('id', o.id).select('id'));
  await q(supa.from('ofertas').update({ estado: 'no_adjudicada' }).eq('componente_id', c.id).neq('id', o.id).select('id'));
  await q(supa.from('adjudicaciones').insert({
    componente_id: c.id, oferta_id: o.id, certificado: cert, puntaje: puntaje || null, fecha: hoy(),
  }).select('id'));
  await q(supa.from('entregas').insert({ componente_id: c.id, comprador_id: o.comprador_id, adjudicado_el: hoy() }).select('id'));
  audit(req.user.name, req.user.role, `Adjudicó componente (certificado ${cert})`, c.codigo);
  res.json({ ok: true, certificado: cert, comprador: o.compradores.razon_social, monto: o.monto, puntaje: puntaje || null });
}));

/* ---------- pendientes de entrega ---------- */
r.get('/entregas', auth(...GEST), ah(async (_req, res) => {
  const rows = (await q(
    supa.from('entregas').select('*, componentes(nombre, codigo), compradores(razon_social)')
      .neq('estado', 'entregada').order('adjudicado_el')
  )).map((e) => ({
    ...e, componente: e.componentes?.nombre, codigo: e.componentes?.codigo,
    comprador: e.compradores?.razon_social, dias_espera: diasDesde(e.adjudicado_el),
    componentes: undefined, compradores: undefined,
  }));
  res.json(rows);
}));

r.post('/entregas/:id/notificar', auth(...GEST), ah(async (req, res) => {
  const e = await q(supa.from('entregas').select('*, componentes(codigo)').eq('id', req.params.id).maybeSingle());
  if (!e) return res.status(404).json({ error: 'Entrega no encontrada' });
  audit(req.user.name, req.user.role, 'Notificó al comprador retiro pendiente', e.componentes.codigo);
  res.json({ ok: true });
}));

r.post('/entregas/:id/agendar', auth(...GEST), ah(async (req, res) => {
  const { fecha } = req.body || {};
  if (!fecha) return res.status(400).json({ error: 'Indique la fecha de retiro' });
  const e = await q(supa.from('entregas').select('*, componentes(codigo)').eq('id', req.params.id).maybeSingle());
  if (!e) return res.status(404).json({ error: 'Entrega no encontrada' });
  await q(supa.from('entregas').update({ estado: 'agendada', agenda: fecha }).eq('id', e.id).select('id'));
  audit(req.user.name, req.user.role, `Agendó retiro para ${fecha}`, e.componentes.codigo);
  res.json({ ok: true });
}));

export default r;
