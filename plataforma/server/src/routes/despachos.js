// Cadena física del material, según el flujo real del proceso:
//   MEL (patios) → La Negra (vendor: recibe, pesa, clasifica/reduce)
//   La Negra → Lampa (vendor: consolida y traslada; Lampa emite el
//   certificado de disposición final).
import { Router } from 'express';
import multer from 'multer';
import { supa, q, ah, folio, audit, precioVigente, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { valorDolar } from '../dolar.js';

const r = Router();

// Tipos de descuento que se aplican sobre una recepción.
export const TIPO_DESCUENTO = {
  kg: 'Kilos descontados',
  pct: 'Porcentaje del valor',
  usd: 'Monto fijo en USD',
};

// Valoriza una recepción: primero los kilos descontados, después el precio, y
// sobre ese valor los descuentos porcentuales y de monto fijo. El orden importa
// y es el del contrato: no se descuenta dos veces lo mismo.
export function valorizar({ kg, precio_usd, precio_kg, dolar, descuentos = [] }) {
  const suma = (t) => descuentos.filter((d) => d.tipo === t).reduce((a, d) => a + Number(d.valor), 0);
  const kgNeto = Math.max(Number(kg) - suma('kg'), 0);
  const pct = Math.min(suma('pct'), 100);

  if (precio_usd != null && dolar != null) {
    const bruto = kgNeto * precio_usd;
    const usd = Math.max(bruto * (1 - pct / 100) - suma('usd'), 0);
    return {
      kg_neto: kgNeto,
      valor_usd: Math.round(usd * 10000) / 10000,
      valor: Math.round(usd * dolar),
      bruto_usd: Math.round(bruto * 10000) / 10000,
    };
  }
  // Vigencias antiguas en pesos: el descuento "usd" se ignora por no ser convertible.
  const bruto = kgNeto * Number(precio_kg ?? 0);
  return {
    kg_neto: kgNeto,
    valor_usd: null,
    valor: Math.round(Math.max(bruto * (1 - pct / 100), 0)),
    bruto_usd: null,
  };
}

// Evidencia fotográfica por tipo de respaldo: el proceso exige la guía que
// viaja con el camión, el ticket de la báscula y el estado de la carga. El
// tipo va en el nombre del archivo (GD/<id>/<tipo>-<n>.<ext>), de modo que
// la evidencia queda autodescrita sin necesidad de una tabla aparte.
// Bucket privado "evidencia"; se sirven con URLs firmadas.
export const EVIDENCIA = {
  guia: 'Guía de despacho',
  bascula: 'Ticket de báscula MEL',
  carga: 'Carga en el camión',
  recepcion: 'Ticket de báscula La Negra',   // lo adjunta el vendor al recepcionar
};
const subir = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype)),
});
// Respaldos que se adjuntan al despachar; el de recepción va en su propio paso.
const CAMPOS_EVIDENCIA = ['guia', 'bascula', 'carga'].map((name) => ({ name, maxCount: 2 }));

// Sube los archivos de un tipo a la carpeta de la guía y devuelve cuántos entraron.
async function subirEvidencia(despachoId, tipo, archivos = []) {
  let n = 0;
  for (const f of archivos) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[f.mimetype];
    const { error } = await supa.storage.from('evidencia')
      .upload(`GD/${despachoId}/${tipo}-${++n}.${ext}`, f.buffer, { contentType: f.mimetype });
    if (error) console.error('[GEA] evidencia:', error.message);
  }
  return n;
}
const DESP_SEL = '*, patios(codigo, nombre), cat:categorias!despachos_categoria_id_fkey(nombre), catf:categorias!despachos_categoria_final_id_fkey(nombre), estados_pago(folio)';
const TRAS_SEL = '*, categorias(nombre)';

const num = (v) => (v == null ? null : Number(v));

const view = (d, descuentos = []) => ({
  id: d.id, guia: d.guia, guia_mel: d.guia_mel ?? null, fecha: d.fecha, estado: d.estado, fotos: d.fotos,
  patio: d.patios?.codigo, patio_nombre: d.patios?.nombre,
  categoria: d.cat?.nombre, categoria_final: d.catf?.nombre ?? null,
  kg_origen: Number(d.kg_origen), kg_destino: num(d.kg_destino),
  dif_pct: d.kg_destino == null ? null : Math.round(((d.kg_destino - d.kg_origen) / d.kg_origen) * 10000) / 100,
  precio_kg: num(d.precio_kg),
  valor: num(d.valor),
  obs_recepcion: d.obs_recepcion, recepcionado_el: d.recepcionado_el && fmtFecha(d.recepcionado_el),
  ep_folio: d.estados_pago?.folio ?? null, creado_por: d.creado_por,
  // transporte (Res. Ex. 154 del SII)
  transportista: d.transportista ?? null, transportista_rut: d.transportista_rut ?? null,
  patente_tracto: d.patente_tracto ?? null, patente_rampla: d.patente_rampla ?? null,
  // pesaje declarado en la recepción
  ticket_numero: d.ticket_numero ?? null, vale_numero: d.vale_numero ?? null,
  tara_kg: num(d.tara_kg),
  // bruto del ticket: neto + tara, cuando la romana pesó el camión completo
  bruto_kg: d.tara_kg != null && d.kg_destino != null ? Number(d.tara_kg) + Number(d.kg_destino) : null,
  // valorización en dólares
  precio_usd: num(d.precio_usd), dolar: num(d.dolar), valor_usd: num(d.valor_usd),
  // anulación
  anulada_el: d.anulada_el ? fmtFecha(d.anulada_el) : null,
  anulada_por: d.anulada_por ?? null, motivo_anulacion: d.motivo_anulacion ?? null,
  reemplazada_por: d.reemplazada_por ?? null,
  // descuentos por ítem
  descuentos: descuentos.map((x) => ({
    id: x.id, tipo: x.tipo, valor: Number(x.valor), glosa: x.glosa,
    etiqueta: TIPO_DESCUENTO[x.tipo] ?? x.tipo, creado_por: x.creado_por,
  })),
});

// Descuentos de un conjunto de guías, en una sola consulta.
async function descuentosDe(ids) {
  if (!tiene.desc_item || !ids.length) return new Map();
  const rows = await q(supa.from('despacho_descuentos').select('*').in('despacho_id', ids).order('id'));
  const m = new Map();
  for (const x of rows) {
    if (!m.has(x.despacho_id)) m.set(x.despacho_id, []);
    m.get(x.despacho_id).push(x);
  }
  return m;
}

// Recalcula la valorización de una guía con los descuentos que tenga en ese
// momento. Se usa al recepcionar y cada vez que un descuento entra o sale.
async function revalorizar(id) {
  const d = await q(supa.from('despachos').select('*').eq('id', id).single());
  if (d.kg_destino == null) return d;
  const descuentos = tiene.desc_item
    ? await q(supa.from('despacho_descuentos').select('tipo,valor').eq('despacho_id', id))
    : [];
  const v = valorizar({
    kg: d.kg_destino, precio_usd: num(d.precio_usd), precio_kg: num(d.precio_kg),
    dolar: num(d.dolar), descuentos,
  });
  return q(supa.from('despachos').update({
    valor: v.valor,
    ...(tiene.usd ? { valor_usd: v.valor_usd } : {}),
  }).eq('id', id).select('*').single());
}

/* ---------- despachos MEL → La Negra ---------- */

r.get('/despachos', auth(), ah(async (_req, res) => {
  const rows = await q(supa.from('despachos').select(DESP_SEL).order('id', { ascending: false }).limit(300));
  const desc = await descuentosDe(rows.map((d) => d.id));
  res.json(rows.map((d) => view(d, desc.get(d.id) ?? [])));
}));

// Datos de transporte que la Res. Ex. 154 del SII exige en la guía a contar
// del 1-nov-2026. Se digitan del documento: la plataforma no los deduce.
const transporteDe = (b) => (tiene.transporte ? {
  transportista: (b.transportista || '').trim() || null,
  transportista_rut: (b.transportista_rut || '').trim().toUpperCase() || null,
  patente_tracto: (b.patente_tracto || '').trim().toUpperCase() || null,
  patente_rampla: (b.patente_rampla || '').trim().toUpperCase() || null,
} : {});

r.post('/despachos', auth('limpieza', 'ito', 'coordinador'), subir.fields(CAMPOS_EVIDENCIA), ah(async (req, res) => {
  const { patio_id, categoria_id, kg_origen, guia_mel, fecha } = req.body || {};
  if (!patio_id || !categoria_id || !(Number(kg_origen) > 0)) {
    return res.status(400).json({ error: 'Patio, categoría y peso de báscula son obligatorios' });
  }
  // La guía de despacho de MEL y su fecha se digitan del documento en papel:
  // la plataforma no los deduce ni los lee de la fotografía.
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'Fecha inválida' });
  }
  const archivos = Object.entries(req.files ?? {})
    .flatMap(([tipo, lista]) => lista.map((f, i) => ({ tipo, n: i + 1, f })));
  const guia = await folio('GD');
  const row = await q(supa.from('despachos').insert({
    guia, patio_id: Number(patio_id), categoria_id: Number(categoria_id), kg_origen: Number(kg_origen),
    ...(tiene.guia_mel ? { guia_mel: (guia_mel || '').trim() || null } : {}),
    ...(fecha ? { fecha } : {}),
    ...transporteDe(req.body || {}),
    fotos: archivos.length, creado_por: req.user.name,
  }).select(DESP_SEL).single());

  for (const [tipo, lista] of Object.entries(req.files ?? {})) {
    await subirEvidencia(row.id, tipo, lista);
  }
  const resumen = Object.keys(req.files ?? {}).map((t) => EVIDENCIA[t]).join(', ');
  await audit(req.user.name, req.user.role, 'Registró despacho a La Negra',
    `${guia}${row.guia_mel ? ` (guía MEL ${row.guia_mel})` : ''} · ${kg_origen} kg${resumen ? ' · respaldo: ' + resumen : ''}`);
  res.json(view(row));
}));

// URLs firmadas (1 hora) de la evidencia de una guía, etiquetada por tipo.
r.get('/despachos/:id/evidencia', auth(), ah(async (req, res) => {
  const carpeta = `GD/${Number(req.params.id)}`;
  const { data: lista, error } = await supa.storage.from('evidencia').list(carpeta);
  if (error) throw new Error(error.message);
  if (!lista?.length) return res.json({ archivos: [] });
  const { data: firmadas, error: e2 } = await supa.storage.from('evidencia')
    .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
  if (e2) throw new Error(e2.message);
  // createSignedUrls responde en el mismo orden que se pidió: de ahí sale el nombre.
  // Se devuelven en el orden del proceso (guía, báscula, carga), no alfabético.
  const orden = Object.keys(EVIDENCIA);
  const archivos = firmadas
    .map((f, i) => ({ url: f.signedUrl, tipo: lista[i].name.split('-')[0] }))
    .filter((f) => f.url)
    .map((f) => ({ ...f, etiqueta: EVIDENCIA[f.tipo] ?? 'Evidencia adjunta' }))
    .sort((a, b) => (orden.indexOf(a.tipo) + 1 || 99) - (orden.indexOf(b.tipo) + 1 || 99));
  res.json({ archivos });
}));

// Recepción y pesaje en La Negra. Es una declaración INDEPENDIENTE: el vendor
// pesa en su propia báscula y registra ese peso, que puede adjuntar con el
// ticket de su romana. La plataforma conserva los dos pesajes y compara; una
// diferencia mayor al 2% deja la guía observada para el ITO.
// El vendor puede además reclasificar ("reducir") la carga: el precio se
// congela con la categoría final al momento de la recepción.
r.post('/despachos/:id/recepcionar', auth('vendor', 'ito', 'coordinador'),
  subir.fields([{ name: 'recepcion', maxCount: 2 }]), ah(async (req, res) => {
  const kg = Number(req.body?.kg_destino);
  if (!(kg > 0)) return res.status(400).json({ error: 'Ingrese el peso validado en báscula de La Negra' });

  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (d.estado === 'anulado') return res.status(409).json({ error: 'La guía está anulada' });
  if (d.estado !== 'en_transito') return res.status(409).json({ error: 'El despacho ya fue recepcionado' });

  const tara = Number(req.body?.tara_kg);
  if (req.body?.tara_kg && !(tara > 0)) return res.status(400).json({ error: 'La tara debe ser un peso mayor que cero' });

  // Descuentos aplicados en el mismo acto de recepcionar, si los hay.
  let descuentos = [];
  if (req.body?.descuentos) {
    try { descuentos = JSON.parse(req.body.descuentos); } catch { descuentos = []; }
    if (!Array.isArray(descuentos)) descuentos = [];
    descuentos = descuentos
      .filter((x) => TIPO_DESCUENTO[x?.tipo] && Number(x.valor) > 0 && (x.glosa || '').trim())
      .map((x) => ({ tipo: x.tipo, valor: Number(x.valor), glosa: String(x.glosa).trim() }));
    if (descuentos.some((x) => x.tipo === 'pct' && x.valor > 100)) {
      return res.status(400).json({ error: 'Un descuento porcentual no puede superar el 100%' });
    }
    if (descuentos.some((x) => x.tipo === 'kg' && x.valor >= kg)) {
      return res.status(400).json({ error: 'El descuento en kilos no puede igualar ni superar el peso recibido' });
    }
  }

  const catFinal = Number(req.body?.categoria_final_id) || Number(d.categoria_id);
  const precio = await precioVigente(catFinal, d.fecha, tiene.usd);
  // El tipo de cambio se congela junto con el precio: una variación posterior
  // del dólar no revaloriza una recepción ya declarada.
  const dol = precio.precio_usd != null ? await valorDolar(d.fecha) : null;
  if (precio.precio_usd != null && !dol) {
    return res.status(503).json({ error: 'No hay valor del dólar disponible para la fecha de la guía. Regístrelo en Valorización y reintente.' });
  }
  const v = valorizar({
    kg, precio_usd: precio.precio_usd, precio_kg: precio.precio_kg,
    dolar: dol?.valor ?? null, descuentos,
  });

  const dif = Math.abs((kg - Number(d.kg_origen)) / Number(d.kg_origen));
  const observado = dif > 0.02;
  const fotos = await subirEvidencia(d.id, 'recepcion', req.files?.recepcion);

  await q(supa.from('despachos').update({
    kg_destino: kg,
    categoria_final_id: catFinal === Number(d.categoria_id) ? null : catFinal,
    estado: observado ? 'observado' : 'recepcionado',
    obs_recepcion: req.body?.observacion || (observado ? `Diferencia de peso ${(dif * 100).toFixed(2)}%` : null),
    precio_kg: precio.precio_kg,
    valor: v.valor,
    ...(tiene.usd ? { precio_usd: precio.precio_usd, dolar: dol?.valor ?? null, valor_usd: v.valor_usd } : {}),
    ...(tiene.pesaje ? {
      ticket_numero: (req.body?.ticket_numero || '').trim() || null,
      vale_numero: (req.body?.vale_numero || '').trim() || null,
      tara_kg: tara > 0 ? tara : null,
    } : {}),
    fotos: Number(d.fotos ?? 0) + fotos,
    recepcionado_por: req.user.name,
    recepcionado_el: new Date().toISOString(),
  }).eq('id', req.params.id).select('id').single());

  if (descuentos.length && tiene.desc_item) {
    await q(supa.from('despacho_descuentos')
      .insert(descuentos.map((x) => ({ ...x, despacho_id: d.id, creado_por: req.user.name })))
      .select('id'));
  }
  const row = await q(supa.from('despachos').select(DESP_SEL).eq('id', d.id).single());
  const desc = await descuentosDe([d.id]);

  await audit(req.user.name, req.user.role,
    observado ? 'Recepción observada en La Negra (dif. > 2%)' : 'Recepción validada en La Negra',
    `${row.guia} · ${kg} kg${descuentos.length ? ` · ${descuentos.length} descuento(s)` : ''}` +
    `${dol ? ` · USD ${precio.precio_usd}/kg a $${dol.valor}` : ''}`);
  res.json(view(row, desc.get(d.id) ?? []));
}));

/* ---------- descuentos por ítem sobre una recepción ---------- */

const puedeDescontar = (d) => ['recepcionado', 'observado'].includes(d.estado) && !d.ep_id;

r.post('/despachos/:id/descuentos', auth('vendor', 'ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.desc_item) return res.status(503).json({ error: 'Esta función requiere aplicar db/0004_operacion.sql en la base de datos' });
  const { tipo, valor, glosa } = req.body || {};
  if (!TIPO_DESCUENTO[tipo] || !(Number(valor) > 0) || !(glosa || '').trim()) {
    return res.status(400).json({ error: 'Tipo, monto válido y glosa son obligatorios' });
  }
  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (!puedeDescontar(d)) {
    return res.status(409).json({ error: d.ep_id ? 'La guía ya está en un estado de pago' : 'La guía aún no se recepciona' });
  }
  if (tipo === 'pct' && Number(valor) > 100) return res.status(400).json({ error: 'El porcentaje no puede superar el 100%' });
  if (tipo === 'kg' && Number(valor) >= Number(d.kg_destino)) {
    return res.status(400).json({ error: 'El descuento en kilos no puede igualar ni superar el peso recibido' });
  }
  await q(supa.from('despacho_descuentos')
    .insert({ despacho_id: d.id, tipo, valor: Number(valor), glosa: String(glosa).trim(), creado_por: req.user.name })
    .select('id'));
  await revalorizar(d.id);
  const row = await q(supa.from('despachos').select(DESP_SEL).eq('id', d.id).single());
  const desc = await descuentosDe([d.id]);
  await audit(req.user.name, req.user.role, 'Aplicó descuento a una recepción',
    `${row.guia} · ${TIPO_DESCUENTO[tipo]} ${valor} · ${glosa}`);
  res.json(view(row, desc.get(d.id) ?? []));
}));

r.delete('/despachos/:id/descuentos/:descId', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.desc_item) return res.status(503).json({ error: 'Esta función requiere aplicar db/0004_operacion.sql en la base de datos' });
  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (!puedeDescontar(d)) return res.status(409).json({ error: 'La guía ya no admite cambios de descuentos' });
  await q(supa.from('despacho_descuentos').delete()
    .eq('id', req.params.descId).eq('despacho_id', d.id).select('id'));
  await revalorizar(d.id);
  const row = await q(supa.from('despachos').select(DESP_SEL).eq('id', d.id).single());
  const desc = await descuentosDe([d.id]);
  await audit(req.user.name, req.user.role, 'Quitó un descuento de una recepción', row.guia);
  res.json(view(row, desc.get(d.id) ?? []));
}));

/* ---------- anulación y reemplazo de guías ---------- */

// Una guía no se borra: se anula con motivo y queda en el libro. El folio
// sigue consumido, igual que una guía de papel anulada. Opcionalmente se emite
// en el acto la guía que la reemplaza, copiando los datos del despacho.
r.post('/despachos/:id/anular', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.anulacion) return res.status(503).json({ error: 'Esta función requiere aplicar db/0004_operacion.sql en la base de datos' });
  const motivo = (req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'El motivo de la anulación es obligatorio' });

  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (d.estado === 'anulado') return res.status(409).json({ error: 'La guía ya está anulada' });
  if (d.ep_id) {
    const ep = await q(supa.from('estados_pago').select('folio,estado').eq('id', d.ep_id).single());
    return res.status(409).json({
      error: `La guía está incluida en el estado de pago ${ep.folio} (${ep.estado}). Sáquela de ese EP antes de anularla.`,
    });
  }

  // Reemplazo: nace una guía nueva con folio propio y los datos corregidos.
  let nueva = null;
  if (req.body?.reemplazar) {
    const b = req.body.nueva || {};
    const guia = await folio('GD');
    nueva = await q(supa.from('despachos').insert({
      guia,
      patio_id: Number(b.patio_id) || d.patio_id,
      categoria_id: Number(b.categoria_id) || d.categoria_id,
      kg_origen: Number(b.kg_origen) > 0 ? Number(b.kg_origen) : Number(d.kg_origen),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(b.fecha || '') ? b.fecha : d.fecha,
      ...(tiene.guia_mel ? { guia_mel: (b.guia_mel || '').trim() || d.guia_mel } : {}),
      ...(tiene.transporte ? {
        transportista: b.transportista ?? d.transportista,
        transportista_rut: b.transportista_rut ?? d.transportista_rut,
        patente_tracto: b.patente_tracto ?? d.patente_tracto,
        patente_rampla: b.patente_rampla ?? d.patente_rampla,
      } : {}),
      fotos: 0, creado_por: req.user.name,
    }).select('*').single());
  }

  const row = await q(supa.from('despachos').update({
    estado: 'anulado',
    anulada_el: new Date().toISOString(),
    anulada_por: req.user.name,
    motivo_anulacion: motivo,
    reemplazada_por: nueva?.id ?? null,
  }).eq('id', d.id).select(DESP_SEL).single());

  await audit(req.user.name, req.user.role, 'Anuló una guía de despacho',
    `${row.guia} · ${motivo}${nueva ? ` · reemplazada por ${nueva.guia}` : ''}`);
  res.json({ anulada: view(row), reemplazo: nueva ? view(nueva) : null });
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
