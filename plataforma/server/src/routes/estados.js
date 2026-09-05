// Estados de pago, según el ciclo del flujo real:
//   ITO genera al cierre de mes → envía a revisión → Coordinador:
//   ¿EDP correcto? no → devuelve con ajustes (observación obligatoria) y el
//   ITO corrige/regenera → sí → firma y envía al vendor → vendor registra la
//   factura de compra → vendor registra el pago (<15 días) → el Coordinador
//   revisa la transferencia y concilia.
import { Router } from 'express';
import { supa, q, ah, audit, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

async function detalleEP(ep) {
  const desp = await q(supa.from('despachos')
    .select('kg_destino, valor, precio_kg, categoria_id, categoria_final_id, cat:categorias!despachos_categoria_id_fkey(nombre), catf:categorias!despachos_categoria_final_id_fkey(nombre)')
    .eq('ep_id', ep.id));
  const porCat = {};
  for (const d of desp) {
    const k = d.catf?.nombre ?? d.cat?.nombre ?? '—';
    porCat[k] ??= { categoria: k, guias: 0, kg: 0, valor: 0 };
    porCat[k].guias += 1;
    porCat[k].kg += Number(d.kg_destino ?? 0);
    porCat[k].valor += Number(d.valor ?? 0);
  }
  return { lineas: Object.values(porCat).sort((a, b) => b.valor - a.valor), n_guias: desp.length };
}

const pub = ({ descuentos: _omitir, ...ep }) => ({
  ...ep,
  bruto: Number(ep.bruto), total: Number(ep.total),
  pago_monto: ep.pago_monto == null ? null : Number(ep.pago_monto),
  firmado_el: ep.firmado_el && fmtFecha(ep.firmado_el),
  generado_el: ep.generado_el && fmtFecha(ep.generado_el),
});

r.get('/eps', auth('vendor', 'ito', 'coordinador'), ah(async (_req, res) => {
  const eps = await q(supa.from('estados_pago').select('*').order('periodo', { ascending: false }));
  const out = [];
  for (const ep of eps) out.push({ ...pub(ep), ...(await detalleEP(ep)) });
  res.json(out);
}));

// Genera el EP del período con todos los despachos recepcionados sin EP.
r.post('/eps/generar', auth('ito', 'coordinador'), ah(async (req, res) => {
  const periodo = String(req.body?.periodo || '').trim();       // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(periodo)) return res.status(400).json({ error: 'Período inválido: use AAAA-MM' });
  const existe = await q(supa.from('estados_pago').select('id').eq('periodo', periodo));
  if (existe.length) return res.status(409).json({ error: `El período ${periodo} ya tiene estado de pago` });

  const [anio, mes] = periodo.split('-').map(Number);
  const mesSiguiente = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
  const desp = await q(supa.from('despachos').select('id, valor')
    .eq('estado', 'recepcionado').is('ep_id', null)
    .gte('fecha', periodo + '-01').lt('fecha', mesSiguiente));
  if (!desp.length) return res.status(400).json({ error: 'El período no tiene despachos recepcionados pendientes de EP' });

  const bruto = desp.reduce((a, d) => a + Number(d.valor ?? 0), 0);
  const ep = await q(supa.from('estados_pago').insert({
    folio: `EP-${periodo}`, periodo, bruto, total: bruto,
    generado_por: req.user.name,
  }).select().single());
  await q(supa.from('despachos').update({ ep_id: ep.id }).in('id', desp.map((d) => d.id)).select('id'));
  await audit(req.user.name, req.user.role, 'Generó estado de pago de cierre de mes', `${ep.folio} · ${desp.length} guías`);
  res.json({ ...pub(ep), ...(await detalleEP(ep)) });
}));

// Transiciones del ciclo. Cada una valida el estado de origen.
async function transicion(req, res, desde, hasta, extra = {}, accion, obsObligatoria = false) {
  const obs = (req.body?.observacion || '').trim();
  if (obsObligatoria && !obs) return res.status(400).json({ error: 'La observación es obligatoria' });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!desde.includes(ep.estado)) {
    return res.status(409).json({ error: `El EP está "${ep.estado}"; esta acción requiere: ${desde.join(' o ')}` });
  }
  const upd = await q(supa.from('estados_pago')
    .update({ estado: hasta, ...(obs ? { observacion: obs } : {}), ...extra })
    .eq('id', ep.id).select().single());
  await audit(req.user.name, req.user.role, accion, `${ep.folio}${obs ? ' · ' + obs : ''}`);
  res.json({ ...pub(upd), ...(await detalleEP(upd)) });
}

r.post('/eps/:id/enviar', auth('ito', 'coordinador'), ah((req, res) =>
  transicion(req, res, ['generado', 'con_ajustes'], 'en_revision', {}, 'Envió EP a revisión del Coordinador')));

r.post('/eps/:id/ajustar', auth('coordinador'), ah((req, res) =>
  transicion(req, res, ['en_revision'], 'con_ajustes', {}, 'Devolvió EP con ajustes', true)));

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
