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
import { registrarArchivos } from '../documental.js';

const r = Router();

// Folio del código interno del despacho. Desde la migración 0006 el tipo es
// 'CI' (antes 'GD', renombrado para no confundirlo con la GD que emite el SII).
// Se intenta 'CI' y, si la base todavía no migró, se cae a 'GD'. Así el folio
// NO depende del esquema detectado al arrancar: aplicar la migración con el
// servidor encendido deja de romper la creación de despachos.
async function folioInterno() {
  try {
    return await folio('CI');
  } catch (e) {
    if (/tipo de folio desconocido/i.test(e.message || '')) return await folio('GD');
    throw e;
  }
}

// Tipos de descuento que se aplican sobre una recepción.
export const TIPO_DESCUENTO = {
  kg: 'Kilos descontados',
  pct: 'Porcentaje del valor',
  usd: 'Monto fijo en USD',
  clp: 'Monto fijo en pesos',
};

// Valoriza una recepción: primero los kilos descontados, después el precio, y
// sobre ese valor los descuentos porcentuales y de monto fijo. El orden importa
// y es el del contrato: no se descuenta dos veces lo mismo.
export function valorizar({ kg, precio_usd_tm, precio_usd, precio_kg, dolar, descuentos = [] }) {
  const suma = (t) => descuentos.filter((d) => d.tipo === t).reduce((a, d) => a + Number(d.valor), 0);
  const kgNeto = Math.max(Number(kg) - suma('kg'), 0);
  const pct = Math.min(suma('pct'), 100);
  const clp = suma('clp');

  // El contrato está en USD por tonelada métrica. La conversión ocurre aquí y
  // no al guardar el precio, para que la tabla conserve la cifra del contrato
  // tal como fue pactada.
  if (precio_usd_tm != null && dolar != null) {
    const bruto = (kgNeto / 1000) * Number(precio_usd_tm);
    const usd = Math.max(bruto * (1 - pct / 100) - suma('usd') - clp / dolar, 0);
    return {
      kg_neto: kgNeto,
      valor_usd: Math.round(usd * 10000) / 10000,
      valor: Math.round(usd * dolar),
      bruto_usd: Math.round(bruto * 10000) / 10000,
    };
  }

  // Vigencias en USD/kg (0004, antes de que se supiera que el contrato va por
  // tonelada). Se conservan para no reescribir lo ya valorizado.
  if (precio_usd != null && dolar != null) {
    const bruto = kgNeto * precio_usd;
    // El descuento en pesos se convierte con el dólar congelado de la guía, no
    // con el de hoy: así el total en pesos y el total en dólares siguen siendo
    // la misma cifra vista en dos monedas. Y como el monto en pesos es entero,
    // restarlo antes de redondear descuenta exactamente lo que se digitó.
    const usd = Math.max(bruto * (1 - pct / 100) - suma('usd') - clp / dolar, 0);
    return {
      kg_neto: kgNeto,
      valor_usd: Math.round(usd * 10000) / 10000,
      valor: Math.round(usd * dolar),
      bruto_usd: Math.round(bruto * 10000) / 10000,
    };
  }
  // Vigencias antiguas en pesos: el descuento "usd" se ignora por no ser
  // convertible sin un tipo de cambio congelado; el de pesos sí se aplica.
  const bruto = kgNeto * Number(precio_kg ?? 0);
  return {
    kg_neto: kgNeto,
    valor_usd: null,
    valor: Math.round(Math.max(bruto * (1 - pct / 100) - clp, 0)),
    bruto_usd: null,
  };
}

// Reglas propias de cada tipo de descuento; devuelve el error o null.
export function revisarDescuento({ tipo, valor }, kg) {
  const v = Number(valor);
  if (tipo === 'pct' && v > 100) return 'Un descuento porcentual no puede superar el 100%';
  if (tipo === 'kg' && kg != null && v >= Number(kg)) {
    return 'El descuento en kilos no puede igualar ni superar el peso recibido';
  }
  // El peso chileno no tiene fracciones: un descuento de $1.500,25 no existe.
  if (tipo === 'clp' && !Number.isInteger(v)) return 'El descuento en pesos debe ser un monto entero';
  return null;
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
  defParamCharset: 'utf8',   // el nombre original pasa al repositorio documental
  limits: { files: 6, fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(f.mimetype)),
});
// Respaldos que se adjuntan al despachar; el de recepción va en su propio paso.
const CAMPOS_EVIDENCIA = ['guia', 'bascula', 'carga'].map((name) => ({ name, maxCount: 2 }));
// Al corregir se puede sumar cualquiera de los cuatro, incluido el de recepción
// si la guía ya pasó por La Negra.
const CAMPOS_TODOS = Object.keys(EVIDENCIA).map((name) => ({ name, maxCount: 2 }));

// Sube los archivos de un tipo a la carpeta de la guía y devuelve cuántos entraron.
// La guía de despacho además queda en el repositorio documental (Fase 3); el
// ticket de báscula y las fotos de la carga son evidencia, no documentos.
async function subirEvidencia(despachoId, tipo, archivos = [], quien = null) {
  let n = 0;
  const subidos = [];
  // La marca de tiempo permite adjuntar en varias tandas: con un contador que
  // reinicia en cada llamada, la segunda chocaba con `guia-1` de la primera y
  // el archivo se perdia en silencio (el error solo se logueaba).
  const marca = Date.now();
  for (const f of archivos) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[f.mimetype];
    if (!ext) continue;
    const path = `GD/${despachoId}/${tipo}-${marca}-${n + 1}.${ext}`;
    const { error } = await supa.storage.from('evidencia').upload(path, f.buffer, { contentType: f.mimetype });
    if (error) { console.error('[GEA] evidencia:', error.message); continue; }
    subidos.push({ bucket: 'evidencia', path, nombre: f.originalname, mime: f.mimetype, bytes: f.size });
    n++;
  }
  if (tipo === 'guia' && subidos.length) {
    await registrarArchivos({ tipo: 'ch_guia_despacho', hito: 'despacho', refId: despachoId, archivos: subidos, quien });
  }
  return n;
}
// Documento del certificado de disposición final que emite Lampa. Va en su
// propia carpeta (CDF/<trasladoId>/) del mismo bucket privado.
// El nombre lleva marca de tiempo porque el documento puede adjuntarse en
// varias tandas: con un contador que reinicia en cada llamada, la segunda
// chocaba con `cdf-1` de la primera y el archivo se perdía en silencio.
// También queda en el repositorio documental como certificado del traslado.
async function subirCDF(trasladoId, archivos = [], quien = null) {
  let n = 0;
  const marca = Date.now();
  const subidos = [];
  for (const f of archivos) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[f.mimetype];
    if (!ext) continue;
    const path = `CDF/${trasladoId}/cdf-${marca}-${n + 1}.${ext}`;
    const { error } = await supa.storage.from('evidencia').upload(path, f.buffer, { contentType: f.mimetype });
    if (error) { console.error('[GEA] CDF:', error.message); continue; }
    subidos.push({ bucket: 'evidencia', path, nombre: f.originalname, mime: f.mimetype, bytes: f.size });
    n++;
  }
  if (subidos.length) {
    await registrarArchivos({ tipo: 'ch_cdf', hito: 'traslado', refId: trasladoId, archivos: subidos, quien });
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
  // tara y bruto declarados en el despacho de origen (báscula MEL)
  tara_origen_kg: num(d.tara_origen_kg),
  bruto_origen_kg: d.tara_origen_kg != null ? Number(d.kg_origen) + Number(d.tara_origen_kg) : null,
  dif_pct: d.kg_destino == null ? null : Math.round(((d.kg_destino - d.kg_origen) / d.kg_origen) * 10000) / 100,
  observacion: d.observacion ?? null,
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
  precio_usd_tm: num(d.precio_usd_tm), con_madera: d.con_madera ?? null,
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

// El tipo 'clp' se agregó después de la primera versión de 0004. Si la base
// todavía tiene la restricción antigua, el rechazo dice qué hay que ejecutar,
// en vez de devolver el mensaje crudo de Postgres.
async function guardarDescuentos(filas) {
  try {
    return await q(supa.from('despacho_descuentos').insert(filas).select('id'));
  } catch (e) {
    if (/despacho_descuentos_tipo_check/.test(e.message)) {
      throw new Error('La base todavía no acepta descuentos en pesos: vuelva a ejecutar db/0004_operacion.sql');
    }
    throw e;
  }
}

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
    kg: d.kg_destino, precio_usd_tm: num(d.precio_usd_tm),
    precio_usd: num(d.precio_usd), precio_kg: num(d.precio_kg),
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
  // Tara del camión en la báscula de origen (opcional). El neto declarado por
  // MEL sigue siendo kg_origen; la tara solo respalda el bruto del ticket.
  const taraOrigen = Number(req.body?.tara_origen_kg);
  if (req.body?.tara_origen_kg && !(taraOrigen > 0)) {
    return res.status(400).json({ error: 'La tara debe ser un peso mayor que cero' });
  }
  const archivos = Object.entries(req.files ?? {})
    .flatMap(([tipo, lista]) => lista.map((f, i) => ({ tipo, n: i + 1, f })));
  const guia = await folioInterno();
  // Alternativa del contrato (A sin madera / B con madera): la declara quien
  // despacha, porque es quien ve como sale la carga del patio. Quien recibe en
  // La Negra la confirma o la corrige, y recien ahi se congela el precio.
  const conMaderaOrigen = ['true', '1', 'on', 'si', 'sí'].includes(String(req.body?.con_madera ?? '').toLowerCase());
  const row = await q(supa.from('despachos').insert({
    guia, patio_id: Number(patio_id), categoria_id: Number(categoria_id), kg_origen: Number(kg_origen),
    ...(tiene.guia_mel ? { guia_mel: (guia_mel || '').trim() || null } : {}),
    ...(tiene.tm ? { con_madera: conMaderaOrigen } : {}),
    ...(tiene.desp_obs ? { observacion: (req.body?.observacion || '').trim() || null } : {}),
    ...(fecha ? { fecha } : {}),
    ...(tiene.tara_origen && taraOrigen > 0 ? { tara_origen_kg: taraOrigen } : {}),
    ...transporteDe(req.body || {}),
    fotos: archivos.length, creado_por: req.user.name,
  }).select(DESP_SEL).single());

  for (const [tipo, lista] of Object.entries(req.files ?? {})) {
    await subirEvidencia(row.id, tipo, lista, req.user);
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
    for (const x of descuentos) {
      const mal = revisarDescuento(x, kg);
      if (mal) return res.status(400).json({ error: mal });
    }
  }

  const catFinal = Number(req.body?.categoria_final_id) || Number(d.categoria_id);
  const precio = await precioVigente(catFinal, d.fecha, tiene.usd, tiene.tm);

  // Alternativa A (sin madera) o B (con madera): lo declara quien recibe, según
  // cómo llegó la carga, y queda congelado con la guía.
  const conMadera = tiene.tm && ['true', '1', 'on', 'si', 'sí'].includes(String(req.body?.con_madera ?? '').toLowerCase());
  const precioTm = !tiene.tm ? null
    : conMadera ? (precio.precio_usd_tm_madera ?? precio.precio_usd_tm)
    : precio.precio_usd_tm;

  // El tipo de cambio se congela junto con el precio: una variación posterior
  // del dólar no revaloriza una recepción ya declarada.
  const enDolares = precioTm != null || precio.precio_usd != null;
  const dol = enDolares ? await valorDolar(d.fecha) : null;
  if (enDolares && !dol) {
    return res.status(503).json({ error: 'No hay valor del dólar disponible para la fecha de la guía. Regístrelo en Valorización y reintente.' });
  }
  const v = valorizar({
    kg, precio_usd_tm: precioTm, precio_usd: precio.precio_usd, precio_kg: precio.precio_kg,
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
    ...(tiene.tm ? { con_madera: conMadera, precio_usd_tm: precioTm } : {}),
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
    await guardarDescuentos(descuentos.map((x) => ({ ...x, despacho_id: d.id, creado_por: req.user.name })));
  }
  const row = await q(supa.from('despachos').select(DESP_SEL).eq('id', d.id).single());
  const desc = await descuentosDe([d.id]);

  await audit(req.user.name, req.user.role,
    observado ? 'Recepción observada en La Negra (dif. > 2%)' : 'Recepción validada en La Negra',
    `${row.guia} · ${kg} kg${descuentos.length ? ` · ${descuentos.length} descuento(s)` : ''}` +
    `${precioTm != null ? ` · USD ${precioTm}/TM (${conMadera ? 'con' : 'sin'} madera) a $${dol.valor}`
      : dol ? ` · USD ${precio.precio_usd}/kg a $${dol.valor}` : ''}`);
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
  const mal = revisarDescuento({ tipo, valor }, d.kg_destino);
  if (mal) return res.status(400).json({ error: mal });
  await guardarDescuentos({ despacho_id: d.id, tipo, valor: Number(valor), glosa: String(glosa).trim(), creado_por: req.user.name });
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
// Limpieza registra el despacho, asi que tambien corrige y anula el suyo: un
// error de digitacion no deberia necesitar al ITO. Los limites siguen siendo
// los mismos para todos —no se toca una guia anulada ni una que ya esta en un
// estado de pago—, y la anulacion siempre exige motivo y queda en bitacora.
r.post('/despachos/:id/anular', auth('limpieza', 'ito', 'coordinador'), ah(async (req, res) => {
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
    const guia = await folioInterno();
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

// Corrección de datos de digitación de una guía, MIENTRAS no haya entrado a un
// estado de pago. No se editan los kilos ni el precio de la recepción (eso
// altera lo valorizado: para eso se anula y se rehace); solo los datos del
// documento de origen: guía MEL, fecha, patio, categoría, transporte y tara.
// Corrección de la recepción ya aceptada. Es el otro lado de la observación de
// MEL: el despacho se podía corregir, la recepción no, y la única salida era
// anular la guía entera y rehacerla por un error de digitación en la báscula.
//
// Mueve plata, así que es más estricta que la corrección del despacho: la hace
// el ITO o el coordinador (no el vendor que la digitó), exige motivo, y todo
// queda en bitácora con el antes y el después.
//
// El precio y el dólar NO se recalculan: quedaron congelados al recepcionar y
// se reusan tal cual. Corregir un peso cambia los kilos, no lo que valía el
// material ese día.
r.patch('/despachos/:id/recepcion', auth('ito', 'coordinador'), ah(async (req, res) => {
  const motivo = (req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'El motivo de la corrección es obligatorio' });

  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (d.estado === 'anulado') return res.status(409).json({ error: 'La guía está anulada; no se corrige' });
  if (!['recepcionado', 'observado'].includes(d.estado)) {
    return res.status(409).json({ error: 'Esta guía todavía no se recepciona: no hay recepción que corregir' });
  }
  if (d.ep_id) {
    const ep = await q(supa.from('estados_pago').select('folio,estado').eq('id', d.ep_id).single());
    return res.status(409).json({ error: `La guía está en el estado de pago ${ep.folio} (${ep.estado}). Sáquela de ese EP antes de corregirla.` });
  }

  const cambios = {};
  const bitacora = [];
  const kg = req.body?.kg_destino !== undefined ? Number(req.body.kg_destino) : Number(d.kg_destino);
  if (req.body?.kg_destino !== undefined) {
    if (!(kg > 0)) return res.status(400).json({ error: 'El peso recibido debe ser mayor que cero' });
    if (kg !== Number(d.kg_destino)) bitacora.push(`kg recibidos ${d.kg_destino} → ${kg}`);
    cambios.kg_destino = kg;
  }
  if (tiene.pesaje) {
    for (const campo of ['ticket_numero', 'vale_numero']) {
      if (req.body?.[campo] !== undefined) {
        cambios[campo] = (req.body[campo] || '').trim() || null;
        bitacora.push(`${campo.replace('_', ' ')} → ${cambios[campo] ?? '—'}`);
      }
    }
    if (req.body?.tara_kg !== undefined) {
      const t = Number(req.body.tara_kg);
      if (req.body.tara_kg && !(t > 0)) return res.status(400).json({ error: 'La tara debe ser un peso mayor que cero' });
      cambios.tara_kg = t > 0 ? t : null;
      bitacora.push(`tara → ${cambios.tara_kg ?? '—'}`);
    }
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });

  // Se revaloriza solo si cambiaron los kilos, con el precio y el tipo de
  // cambio congelados en la guía y los descuentos que ya tenía.
  if (cambios.kg_destino !== undefined) {
    const descuentos = tiene.desc_item
      ? await q(supa.from('despacho_descuentos').select('tipo,valor').eq('despacho_id', d.id))
      : [];
    const v = valorizar({
      kg, precio_usd_tm: num(d.precio_usd_tm), precio_usd: num(d.precio_usd),
      precio_kg: num(d.precio_kg), dolar: num(d.dolar), descuentos,
    });
    cambios.valor = v.valor;
    if (tiene.usd) cambios.valor_usd = v.valor_usd;
    bitacora.push(`valor ${d.valor} → ${v.valor}`);

    // La marca de observado depende de la diferencia contra el peso de origen:
    // una corrección puede dejarla dentro de tolerancia, o sacarla de ella.
    const dif = Math.abs((kg - Number(d.kg_origen)) / Number(d.kg_origen));
    cambios.estado = dif > 0.02 ? 'observado' : 'recepcionado';
    if (cambios.estado !== d.estado) bitacora.push(`estado → ${cambios.estado}`);
  }

  const row = await q(supa.from('despachos').update(cambios).eq('id', d.id).select(DESP_SEL).single());
  await audit(req.user.name, req.user.role, 'Corrigió la recepción de una guía',
    `${d.guia} · ${bitacora.join(' · ')} · motivo: ${motivo}`);
  res.json(view(row));
}));

r.patch('/despachos/:id', auth('limpieza', 'ito', 'coordinador'),
  subir.fields(CAMPOS_TODOS), ah(async (req, res) => {
  const d = await q(supa.from('despachos').select('*').eq('id', req.params.id).single());
  if (d.estado === 'anulado') return res.status(409).json({ error: 'La guía está anulada; no se edita' });
  if (d.ep_id) {
    const ep = await q(supa.from('estados_pago').select('folio,estado').eq('id', d.ep_id).single());
    return res.status(409).json({ error: `La guía está en el estado de pago ${ep.folio} (${ep.estado}). Sáquela de ese EP antes de corregirla.` });
  }

  const b = req.body || {};
  const cambios = {};
  const bitacora = [];
  if (b.guia_mel !== undefined && tiene.guia_mel) {
    cambios.guia_mel = (b.guia_mel || '').trim() || null;
    bitacora.push(`guía MEL → ${cambios.guia_mel ?? '—'}`);
  }
  if (b.fecha !== undefined) {
    if (b.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return res.status(400).json({ error: 'Fecha inválida' });
    if (b.fecha) { cambios.fecha = b.fecha; bitacora.push(`fecha → ${b.fecha}`); }
  }
  if (b.patio_id !== undefined && Number(b.patio_id) > 0) { cambios.patio_id = Number(b.patio_id); bitacora.push('patio'); }
  if (b.categoria_id !== undefined && Number(b.categoria_id) > 0) { cambios.categoria_id = Number(b.categoria_id); bitacora.push('categoría'); }
  if (b.kg_origen !== undefined) {
    if (!(Number(b.kg_origen) > 0)) return res.status(400).json({ error: 'El peso de origen debe ser mayor que cero' });
    cambios.kg_origen = Number(b.kg_origen); bitacora.push(`kg origen → ${cambios.kg_origen}`);
  }
  if (tiene.tara_origen && b.tara_origen_kg !== undefined) {
    const t = Number(b.tara_origen_kg);
    if (b.tara_origen_kg && !(t > 0)) return res.status(400).json({ error: 'La tara debe ser un peso mayor que cero' });
    cambios.tara_origen_kg = t > 0 ? t : null; bitacora.push('tara de origen');
  }
  if (tiene.desp_obs && b.observacion !== undefined) {
    cambios.observacion = (b.observacion || '').trim() || null;
    bitacora.push('observación');
  }
  if (tiene.transporte) {
    const tr = transporteDe(b);
    for (const [k, v] of Object.entries(tr)) {
      if (b[k] !== undefined) { cambios[k] = v; }
    }
    if (['transportista', 'transportista_rut', 'patente_tracto', 'patente_rampla'].some((k) => b[k] !== undefined)) bitacora.push('transporte');
  }
  // Respaldos que llegan después. En terreno la foto de la carga o el ticket de
  // báscula muchas veces aparecen más tarde que la guía, y hasta ahora un
  // despacho que nació sin respaldo se quedaba sin él para siempre: adjuntar
  // solo existía en el momento de crear.
  let nuevos = 0;
  for (const [tipo, lista] of Object.entries(req.files ?? {})) {
    if (!EVIDENCIA[tipo] || !lista?.length) continue;
    const n = await subirEvidencia(d.id, tipo, lista, req.user);
    if (n) { nuevos += n; bitacora.push(`${n} ${EVIDENCIA[tipo].toLowerCase()}`); }
  }
  if (nuevos) cambios.fotos = Number(d.fotos ?? 0) + nuevos;

  // Adjuntar sin corregir nada es un uso válido: no se exige cambiar datos.
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios ni respaldos que guardar' });

  const row = await q(supa.from('despachos').update(cambios).eq('id', req.params.id).select(DESP_SEL).single());
  await audit(req.user.name, req.user.role,
    nuevos && bitacora.length === 1 ? 'Adjuntó respaldos a la guía' : 'Corrigió datos de la guía',
    `${row.guia} · ${bitacora.join(', ')}`);
  const desc = await descuentosDe([row.id]);
  res.json(view(row, desc.get(row.id) ?? []));
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
r.post('/traslados/:id/recepcionar', auth('vendor', 'coordinador', 'lampa'),
  subir.fields([{ name: 'cdf', maxCount: 2 }]), ah(async (req, res) => {
  const kg = Number(req.body?.kg_lampa);
  if (!(kg > 0)) return res.status(400).json({ error: 'Ingrese el peso validado en báscula de Lampa' });
  const t = await q(supa.from('traslados').select('*').eq('id', req.params.id).single());
  if (t.estado !== 'en_transito') return res.status(409).json({ error: 'El traslado ya fue recepcionado' });

  const cert = await folio('CDF');
  // El documento físico del CDF (PDF o foto) es opcional al recepcionar.
  const cdfN = await subirCDF(t.id, req.files?.cdf, req.user);
  const row = await q(supa.from('traslados').update({
    estado: 'recepcionado', kg_lampa: kg, cert_folio: cert,
    recepcionado_el: new Date().toISOString(),
    ...(tiene.cdf_doc ? { cert_fotos: cdfN } : {}),
  }).eq('id', req.params.id).select(TRAS_SEL).single());
  await audit(req.user.name, req.user.role, 'Recepcionó en Lampa y emitió certificado de disposición final',
    `${row.guia} → ${cert}${cdfN ? ` · ${cdfN} documento(s)` : ''}`);
  res.json({ ...row, kg: Number(row.kg), kg_lampa: row.kg_lampa == null ? null : Number(row.kg_lampa), categoria: row.categorias?.nombre });
}));

// Adjunta el documento del CDF a un traslado ya recepcionado. En la práctica el
// certificado firmado llega después de recibir el material, y antes solo se
// aceptaba en el mismo instante de recepcionar: si no lo tenías a mano en ese
// momento, no había ninguna forma de agregarlo nunca.
r.post('/traslados/:id/cdf', auth('vendor', 'coordinador', 'lampa'),
  subir.fields([{ name: 'cdf', maxCount: 4 }]), ah(async (req, res) => {
  const t = await q(supa.from('traslados').select('*').eq('id', req.params.id).single());
  if (t.estado !== 'recepcionado') {
    return res.status(409).json({ error: 'El certificado se emite al recepcionar en Lampa: registre primero la recepción.' });
  }
  const archivos = req.files?.cdf ?? [];
  if (!archivos.length) return res.status(400).json({ error: 'Adjunte el documento del certificado (PDF, JPG, PNG o WebP).' });
  const n = await subirCDF(t.id, archivos, req.user);
  if (!n) return res.status(400).json({ error: 'No se pudo adjuntar el documento. Revise el formato y que pese menos de 5 MB.' });
  if (tiene.cdf_doc) {
    await q(supa.from('traslados').update({ cert_fotos: (t.cert_fotos ?? 0) + n })
      .eq('id', t.id).select('id').single());
  }
  await audit(req.user.name, req.user.role, 'Adjuntó documento al certificado de disposición final',
    `${t.guia} · ${t.cert_folio} · ${n} documento(s)`);
  res.json({ ok: true, adjuntados: n, cert_fotos: (t.cert_fotos ?? 0) + n });
}));

// Documento(s) del certificado de disposición final de un traslado.
r.get('/traslados/:id/cdf', auth(), ah(async (req, res) => {
  const carpeta = `CDF/${Number(req.params.id)}`;
  const { data: lista, error } = await supa.storage.from('evidencia').list(carpeta);
  if (error) throw new Error(error.message);
  if (!lista?.length) return res.json({ archivos: [] });
  const { data: firmadas, error: e2 } = await supa.storage.from('evidencia')
    .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
  if (e2) throw new Error(e2.message);
  res.json({ archivos: firmadas.filter((f) => f.signedUrl).map((f) => ({ url: f.signedUrl })) });
}));

export default r;
