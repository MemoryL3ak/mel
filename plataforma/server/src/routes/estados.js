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
import multer from 'multer';
import { supa, q, ah, audit, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';
import { contrato } from '../contrato.js';
import { tiene } from '../esquema.js';
import { registrarArchivos } from '../documental.js';

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
  // Los acumulados del formato se calculan recorriendo la serie en orden, y
  // se REINICIAN en cada año calendario: MEL necesita el acumulado del año en
  // curso, no el del contrato completo. El periodo es 'AAAA-MM'.
  let acumulado = 0;
  let anioCorriente = null;
  const out = [];
  for (const ep of eps) {
    const anio = String(ep.periodo ?? '').slice(0, 4);
    if (anio !== anioCorriente) { anioCorriente = anio; acumulado = 0; }
    // Un ajuste manual reemplaza el arrastre calculado desde ese EDP en
    // adelante: sirve cuando lo que trae la contabilidad no calza con la serie.
    const previo = ep.acumulado_manual != null ? Number(ep.acumulado_manual) : acumulado;
    acumulado = previo + Number(ep.total);
    out.push({ ...pub(ep, cfg, previo), ...(await detalleEP(ep)) });
  }
  res.json({ eps: out.reverse(), contrato: cfg });
}));

// N° del EP: el correlativo del contrato. La plataforma propone el siguiente
// de la serie (el mayor + 1), pero se puede fijar a mano: el contrato ya
// llevaba estados de pago emitidos fuera de la plataforma cuando empezó a
// usarse, y la numeración tiene que continuar la real. Fijado uno, los
// siguientes siguen solos desde ahí. Devuelve el número o el error.
async function numeroEP(valor, excluirId = null) {
  const previos = await q(supa.from('estados_pago').select('id, numero, folio'));
  if (valor === undefined || valor === null || valor === '') {
    return { numero: previos.reduce((max, e) => Math.max(max, Number(e.numero ?? 0)), 0) + 1 };
  }
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 9999) return { error: 'El N° del estado de pago debe ser un entero entre 1 y 9999' };
  const otro = previos.find((e) => Number(e.numero) === n && e.id !== excluirId);
  if (otro) return { error: `El N° ${n} ya lo tiene el ${otro.folio}` };
  return { numero: n };
}

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

  const { numero, error: errNumero } = await numeroEP(req.body?.numero);
  if (errNumero) return res.status(400).json({ error: errNumero });
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
const SIN_EDP = 'Esta función requiere aplicar db/0011_edp.sql en la base de datos';

// Respaldo de un descuento: foto, PDF o Word. Quien revisa el EDP tiene que
// poder verificar de donde sale cada descuento, no solo leer su glosa.
const RESPALDO = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const subir = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',   // el nombre original pasa al repositorio documental
  limits: { files: 4, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, !!RESPALDO[f.mimetype]),
});

// Los respaldos también quedan en el repositorio documental como registro de
// descuentos del EP, con la glosa del descuento como nota de la versión.
async function subirRespaldos(descuentoId, archivos = [], { ep, glosa, quien } = {}) {
  let n = 0;
  const marca = Date.now();
  const subidos = [];
  for (const f of archivos) {
    const ext = RESPALDO[f.mimetype];
    if (!ext) continue;
    const path = `EPD/${descuentoId}/resp-${marca}-${n + 1}.${ext}`;
    const { error } = await supa.storage.from('evidencia').upload(path, f.buffer, { contentType: f.mimetype });
    if (error) { console.error('[GEA] respaldo de descuento:', error.message); continue; }
    subidos.push({ bucket: 'evidencia', path, nombre: f.originalname, mime: f.mimetype, bytes: f.size });
    n++;
  }
  if (subidos.length && ep) {
    await registrarArchivos({
      tipo: 'ch_descuentos', hito: 'estado_pago', refId: ep.id, archivos: subidos, quien,
      nota: `Respaldo del descuento «${glosa}»`,
    });
  }
  return n;
}

r.post('/eps/:id/descuentos', auth('ito', 'coordinador'),
  subir.fields([{ name: 'respaldo', maxCount: 4 }]), ah(async (req, res) => {
  if (!tiene.descuentos) return res.status(503).json({ error: SIN_MIGRACION });
  const { glosa, monto } = req.body || {};
  if (!glosa || !(Number(monto) > 0)) return res.status(400).json({ error: 'Glosa y monto válido son obligatorios' });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  if (!editable(ep)) return res.status(409).json({ error: 'El EP ya no admite cambios de descuentos' });
  if (Number(monto) > Number(ep.bruto) - Number(ep.descuentos ?? 0)) {
    return res.status(400).json({ error: 'El descuento no puede dejar el estado de pago en negativo' });
  }
  const fila = await q(supa.from('ep_descuentos')
    .insert({ ep_id: ep.id, glosa, monto: Number(monto), creado_por: req.user.name })
    .select('id').single());
  const nResp = await subirRespaldos(fila.id, req.files?.respaldo, { ep, glosa, quien: req.user });
  if (nResp && tiene.edp_respaldo) {
    await q(supa.from('ep_descuentos').update({ respaldos: nResp }).eq('id', fila.id).select('id').single());
  }
  const upd = await recalcular(ep.id);
  const cfg = await contrato();
  await audit(req.user.name, req.user.role, 'Registró descuento en EP',
    `${ep.folio} · ${glosa} · $${monto}${nResp ? ` · ${nResp} respaldo(s)` : ' · sin respaldo'}`);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}));

// Ajuste manual del acumulado del año que sale impreso. Se guarda por EDP y no
// en el contrato: es el número de ESE documento, y corregirlo después no debe
// cambiar lo que ya se imprimió y se firmó.
r.patch('/eps/:id/acumulado', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.edp_acumulado) return res.status(503).json({ error: SIN_EDP });
  const ep = await q(supa.from('estados_pago').select('*').eq('id', req.params.id).single());
  const limpiar = req.body?.acumulado_manual === null || req.body?.acumulado_manual === '';
  const monto = limpiar ? null : Math.round(Number(req.body?.acumulado_manual));
  if (!limpiar && !(monto >= 0)) return res.status(400).json({ error: 'Ingrese un monto acumulado válido' });
  const upd = await q(supa.from('estados_pago').update({
    acumulado_manual: monto,
    acumulado_nota: (req.body?.acumulado_nota || '').trim() || null,
  }).eq('id', ep.id).select().single());
  const cfg = await contrato();
  await audit(req.user.name, req.user.role,
    limpiar ? 'Volvió al acumulado calculado del EP' : 'Ajustó a mano el acumulado del EP',
    `${ep.folio}${limpiar ? '' : ` · $${monto}`}`);
  res.json({ ...pub(upd, cfg), ...(await detalleEP(upd)) });
}));

// Respaldos de un descuento, con URL firmada (1 h).
r.get('/eps/:id/descuentos/:descId/respaldos', auth('vendor', 'ito', 'coordinador'), ah(async (req, res) => {
  const carpeta = `EPD/${Number(req.params.descId) || 0}`;
  const { data: lista } = await supa.storage.from('evidencia').list(carpeta);
  if (!lista?.length) return res.json({ archivos: [] });
  const { data: firmadas } = await supa.storage.from('evidencia')
    .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
  res.json({ archivos: (firmadas ?? []).filter((f) => f.signedUrl).map((f) => ({ url: f.signedUrl })) });
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
  // El N° se corrige mientras el EP es editable: firmado, ya es el del papel.
  const detalle = [];
  if (req.body?.numero !== undefined && Number(req.body.numero) !== Number(ep.numero)) {
    const { numero, error } = await numeroEP(req.body.numero, ep.id);
    if (error) return res.status(400).json({ error });
    cambios.numero = numero;
    detalle.push(`N° ${ep.numero ?? '—'} → ${numero}`);
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const upd = await q(supa.from('estados_pago').update(cambios).eq('id', ep.id).select().single());
  const cfg = await contrato();
  const otros = Object.keys(cambios).filter((k) => k !== 'numero');
  await audit(req.user.name, req.user.role, 'Actualizó encabezado del EP',
    `${ep.folio} · ${[...detalle, ...otros].join(', ')}`);
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
