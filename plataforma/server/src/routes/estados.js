// Estados de pago, según el ciclo del flujo real:
//   ITO genera al cierre del período → envía a revisión → Coordinador:
//   ¿EDP correcto? no → devuelve con ajustes (observación obligatoria, sube
//   la revisión) y el ITO corrige → sí → firma y envía al vendor → vendor
//   registra la factura de compra → vendor registra el pago (<15 días) → el
//   Coordinador revisa la transferencia y concilia.
//
// El período NO es el mes calendario: el contrato corta el día `dia_corte`,
// de modo que el EP va del día siguiente al corte del mes anterior hasta el
// corte del mes del período (por ejemplo, del 21-jul al 20-ago).
import { Router } from 'express';
import { supa, q, ah, audit, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';
import { contrato } from '../contrato.js';
import { tiene } from '../esquema.js';

const r = Router();

function rangoPeriodo(periodo, diaCorte) {
  const [anio, mes] = periodo.split('-').map(Number);
  const f = (d) => d.toISOString().slice(0, 10);
  return {
    desde: f(new Date(Date.UTC(anio, mes - 2, diaCorte + 1))),
    hasta: f(new Date(Date.UTC(anio, mes - 1, diaCorte))),
  };
}

const DESP_SEL = '*, cat:categorias!despachos_categoria_id_fkey(nombre), catf:categorias!despachos_categoria_final_id_fkey(nombre)';

async function detalleEP(ep) {
  const [desp, descs] = await Promise.all([
    q(supa.from('despachos').select(DESP_SEL).eq('ep_id', ep.id).order('fecha').order('id')),
    tiene.descuentos ? q(supa.from('ep_descuentos').select('*').eq('ep_id', ep.id).order('id')) : [],
  ]);
  const porCat = {};
  for (const d of desp) {
    const k = d.catf?.nombre ?? d.cat?.nombre ?? '—';
    porCat[k] ??= { categoria: k, guias: 0, kg: 0, valor: 0 };
    porCat[k].guias += 1;
    porCat[k].kg += Number(d.kg_destino ?? 0);
    porCat[k].valor += Number(d.valor ?? 0);
  }
  return {
    lineas: Object.values(porCat).sort((a, b) => b.valor - a.valor),
    descuentos_lineas: descs,
    n_guias: desp.length,
    kg_total: desp.reduce((a, d) => a + Number(d.kg_destino ?? 0), 0),
    // Anexo: el detalle guía por guía que respalda el monto del EP.
    guias: desp.map((d) => ({
      id: d.id, guia: d.guia, guia_mel: d.guia_mel ?? null, fecha: d.fecha,
      categoria: d.catf?.nombre ?? d.cat?.nombre ?? '—',
      kg: Number(d.kg_destino ?? 0),
      precio_kg: d.precio_kg == null ? null : Number(d.precio_kg),
      valor: Number(d.valor ?? 0),
    })),
  };
}

// Vista pública del EP: agrega los cálculos del formato de contrato
// (acumulados, IVA y total a facturar) sobre los valores guardados.
function pub(ep, cfg, acumuladoAnterior = 0) {
  const bruto = Number(ep.bruto);
  const descuentos = Number(ep.descuentos ?? 0);
  const total = Number(ep.total);
  const noAfecto = Number(ep.no_afecto_iva ?? 0);
  const afecto = Math.max(total - noAfecto, 0);
  const ivaPct = Number(cfg.iva_pct);
  const iva = Math.round((afecto * ivaPct) / 100);
  return {
    ...ep,
    bruto, descuentos, total,
    numero: ep.numero ?? null,
    revision: ep.revision ?? 0,
    anticipo: Number(ep.anticipo ?? 0),
    no_afecto_iva: noAfecto,
    afecto_iva: afecto,
    iva_pct: ivaPct,
    iva,
    total_con_iva: total + iva,
    acumulado_anterior: acumuladoAnterior,
    acumulado_presente: acumuladoAnterior + total,
    pago_monto: ep.pago_monto == null ? null : Number(ep.pago_monto),
    firmado_el: ep.firmado_el && fmtFecha(ep.firmado_el),
    generado_el: ep.generado_el && fmtFecha(ep.generado_el),
  };
}

r.get('/eps', auth('vendor', 'ito', 'coordinador'), ah(async (_req, res) => {
  const [eps, cfg] = await Promise.all([
    q(supa.from('estados_pago').select('*').order('periodo')),
    contrato(),
  ]);
  // Los acumulados del formato se calculan recorriendo la serie en orden.
  let acumulado = 0;
  const out = [];
  for (const ep of eps) {
    const previo = acumulado;
    acumulado += Number(ep.total);
    out.push({ ...pub(ep, cfg, previo), ...(await detalleEP(ep)) });
  }
  res.json({ eps: out.reverse(), contrato: cfg });
}));

// Genera el EP del período con todos los despachos recepcionados sin EP.
r.post('/eps/generar', auth('ito', 'coordinador'), ah(async (req, res) => {
  const periodo = String(req.body?.periodo || '').trim();       // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Período inválido: use AAAA-MM' });
  const cfg = await contrato();
  const existe = await q(supa.from('estados_pago').select('id').eq('periodo', periodo));
  if (existe.length) return res.status(409).json({ error: `El período ${periodo} ya tiene estado de pago` });

  const { desde, hasta } = rangoPeriodo(periodo, cfg.dia_corte);
  const desp = await q(supa.from('despachos').select('id, valor')
    .eq('estado', 'recepcionado').is('ep_id', null)
    .gte('fecha', desde).lte('fecha', hasta));
  if (!desp.length) {
    return res.status(400).json({ error: `Entre el ${desde} y el ${hasta} no hay despachos recepcionados pendientes de EP` });
  }

  const previos = await q(supa.from('estados_pago').select('numero'));
  const numero = previos.reduce((max, e) => Math.max(max, Number(e.numero ?? 0)), 0) + 1;
  const bruto = desp.reduce((a, d) => a + Number(d.valor ?? 0), 0);

  const ep = await q(supa.from('estados_pago').insert({
    folio: `EP-${periodo}`, periodo, bruto, total: bruto,
    generado_por: req.user.name,
    ...(tiene.ep_contrato ? { numero, revision: 0, desde, hasta, descuentos: 0 } : {}),
  }).select().single());
  await q(supa.from('despachos').update({ ep_id: ep.id }).in('id', desp.map((d) => d.id)).select('id'));
  await audit(req.user.name, req.user.role, 'Generó estado de pago del período',
    `EP N° ${numero} · ${desde} a ${hasta} · ${desp.length} guías`);
  res.json({ ...pub(ep, cfg), ...(await detalleEP(ep)) });
}));

async function recalcular(epId) {
  const [ep, descs] = await Promise.all([
    q(supa.from('estados_pago').select('*').eq('id', epId).single()),
    q(supa.from('ep_descuentos').select('monto').eq('ep_id', epId)),
  ]);
  const totalDesc = descs.reduce((a, d) => a + Number(d.monto), 0);
  return q(supa.from('estados_pago')
    .update({ descuentos: totalDesc, total: Number(ep.bruto) - totalDesc })
    .eq('id', epId).select().single());
}

const editable = (ep) => ['generado', 'con_ajustes'].includes(ep.estado);

const SIN_MIGRACION = 'Esta función requiere aplicar db/0003_ep_contrato.sql en la base de datos';

r.post('/eps/:id/descuentos', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.descuentos) return res.status(503).json({ error: SIN_MIGRACION });
  const { glosa, monto } = req.body || {};
  if (!glosa || !(Number(monto) > 0)) return res.status(400).json({ error: 'Glosa y monto válido son obligatorios' });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!editable(ep)) return res.status(409).json({ error: 'El EP ya no admite cambios de descuentos' });
  if (Number(monto) > Number(ep.bruto) - Number(ep.descuentos ?? 0)) {
    return res.status(400).json({ error: 'El descuento no puede dejar el estado de pago en negativo' });
  }
  await q(supa.from('ep_descuentos').insert({ ep_id: ep.id, glosa, monto: Number(monto), creado_por: req.user.name }).select());
  const upd = await recalcular(ep.id);
  const cfg = await contrato();
  await audit(req.user.name, req.user.role, 'Registró descuento en EP', `${ep.folio} · ${glosa} · $${monto}`);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}));

r.delete('/eps/:id/descuentos/:descId', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.descuentos) return res.status(503).json({ error: SIN_MIGRACION });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!editable(ep)) return res.status(409).json({ error: 'El EP ya no admite cambios de descuentos' });
  await q(supa.from('ep_descuentos').delete().eq('id', req.params.descId).eq('ep_id', ep.id).select());
  const upd = await recalcular(ep.id);
  const cfg = await contrato();
  await audit(req.user.name, req.user.role, 'Eliminó descuento de EP', ep.folio);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}));

// Campos del encabezado que el ITO completa antes de presentar el EP.
r.patch('/eps/:id', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.ep_contrato) return res.status(503).json({ error: SIN_MIGRACION });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!editable(ep)) return res.status(409).json({ error: 'El EP ya fue enviado a revisión y no admite cambios' });
  const permitidos = ['presentado_el', 'anticipo', 'no_afecto_iva', 'desde', 'hasta'];
  const cambios = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const upd = await q(supa.from('estados_pago').update(cambios).eq('id', ep.id).select().single());
  const cfg = await contrato();
  await audit(req.user.name, req.user.role, 'Actualizó encabezado del EP', `${ep.folio} · ${Object.keys(cambios).join(', ')}`);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}));

// Transiciones del ciclo. Cada una valida el estado de origen.
async function transicion(req, res, desde, hasta, extra = {}, accion, obsObligatoria = false) {
  const obs = (req.body?.observacion || '').trim();
  if (obsObligatoria && !obs) return res.status(400).json({ error: 'La observación es obligatoria' });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!desde.includes(ep.estado)) {
    return res.status(409).json({ error: `El EP está "${ep.estado}"; esta acción requiere: ${desde.join(' o ')}` });
  }
  const valores = typeof extra === 'function' ? extra(ep) : extra;
  const upd = await q(supa.from('estados_pago')
    .update({ estado: hasta, ...(obs ? { observacion: obs } : {}), ...valores })
    .eq('id', ep.id).select().single());
  const cfg = await contrato();
  await audit(req.user.name, req.user.role, accion, `${ep.folio}${obs ? ' · ' + obs : ''}`);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}

r.post('/eps/:id/enviar', auth('ito', 'coordinador'), ah((req, res) =>
  transicion(req, res, ['generado', 'con_ajustes'], 'en_revision',
    (ep) => (tiene.ep_contrato ? { presentado_el: ep.presentado_el ?? new Date().toISOString().slice(0, 10) } : {}),
    'Envió EP a revisión del Coordinador')));

// Cada devolución con ajustes sube la revisión del documento (Rev. 0, 1, 2…).
r.post('/eps/:id/ajustar', auth('coordinador'), ah((req, res) =>
  transicion(req, res, ['en_revision'], 'con_ajustes',
    (ep) => (tiene.ep_contrato ? { revision: Number(ep.revision ?? 0) + 1 } : {}),
    'Devolvió EP con ajustes', true)));

r.post('/eps/:id/firmar', auth('coordinador'), ah((req, res) =>
  transicion(req, res, ['en_revision'], 'firmado',
    { firmado_por: req.user.name, firmado_el: new Date().toISOString() },
    'Firmó y envió EP a empresa vendor')));

r.post('/eps/:id/factura', auth('vendor', 'coordinador'), ah(async (req, res) => {
  const { numero, fecha } = req.body || {};
  if (!numero || !fecha) return res.status(400).json({ error: 'Número y fecha de la factura son obligatorios' });
  return transicion(req, res, ['firmado'], 'facturado',
    { factura_numero: String(numero), factura_fecha: fecha },
    `Registró factura de compra N° ${numero}`);
}));

r.post('/eps/:id/pago', auth('vendor', 'coordinador'), ah(async (req, res) => {
  const { monto, fecha, referencia } = req.body || {};
  if (!(Number(monto) > 0) || !fecha) return res.status(400).json({ error: 'Monto y fecha del pago son obligatorios' });
  return transicion(req, res, ['facturado'], 'pagado',
    { pago_monto: Number(monto), pago_fecha: fecha, pago_ref: referencia || null },
    `Registró transferencia de pago por $${Number(monto).toLocaleString('es-CL')}`);
}));

r.post('/eps/:id/conciliar', auth('coordinador'), ah(async (req, res) => {
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (ep.estado !== 'pagado') return res.status(409).json({ error: 'Solo se concilia un EP pagado' });
  const completo = Number(ep.pago_monto) >= Number(ep.total);
  if (!completo && !(req.body?.observacion || '').trim()) {
    return res.status(400).json({ error: 'El pago no cubre el total: la observación es obligatoria' });
  }
  return transicion(req, res, ['pagado'], 'conciliado', {}, 'Revisó transferencia y concilió EP');
}));

export default r;
