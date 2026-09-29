// Fase 2 · Venta de componentes obsoletos.
// Inventario, publicaciones con regla de 15 días, ofertas, matriz de evaluación
// ponderada y adjudicación con comisión al vendor. El portal público que recibe
// las ofertas vive en routes/portal.js. Opera el Administrador de la Plataforma
// de Venta y el Coordinador; nadie más ve estas pantallas.
import { Router } from 'express';
import multer from 'multer';
import { supa, q, ah, folio, audit, hoy, semanaISO } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { contrato } from '../contrato.js';
import { enviarCorreo, plantilla } from '../mail.js';
import { convertirAChatarra } from '../jobs.js';

const r = Router();
const OP = auth('coordinador', 'admin_venta');
// El memo de baja lo recibe y carga MEL: el vendor lo lee, no lo emite.
const MEL = auth('coordinador');
const num = (v) => (v == null ? null : Number(v));
const usd = (n) => 'US$ ' + Number(n).toLocaleString('en-US');
const sinTabla = (res) => res.status(503).json({ error: 'Esta función requiere aplicar db/0007_obsoletos.sql en la base de datos' });
const sinMemos = (res) => res.status(503).json({ error: 'Esta función requiere aplicar db/0008_memos.sql en la base de datos' });

// Adjuntos de componentes. Bucket privado 'evidencia', carpeta OBS/<id>/.
//   fotos: imágenes (portada del portal).
//   ficha técnica: PDF, planilla Excel o imagen.
const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const FICHA = {
  ...IMG, 'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};
const subir = multer({
  storage: multer.memoryStorage(),
  limits: { files: 6, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, !!FICHA[f.mimetype]),
});
const CAMPOS_COMP = [{ name: 'fotos', maxCount: 4 }, { name: 'ficha', maxCount: 1 }];

// Días que acepta `programa` (no opera domingo), indexados por getDay().
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

async function subirFotos(componenteId, archivos = []) {
  let n = 0;
  for (const f of archivos) {
    if (!IMG[f.mimetype]) continue;
    const { error } = await supa.storage.from('evidencia')
      .upload(`OBS/${componenteId}/foto-${Date.now()}-${++n}.${IMG[f.mimetype]}`, f.buffer, { contentType: f.mimetype });
    if (error) console.error('[GEA] foto componente:', error.message);
  }
  return n;
}
async function subirFicha(componenteId, archivo) {
  const ext = archivo && FICHA[archivo.mimetype];
  if (!ext) return 0;
  const { error } = await supa.storage.from('evidencia')
    .upload(`OBS/${componenteId}/ficha-${Date.now()}.${ext}`, archivo.buffer, { contentType: archivo.mimetype });
  if (error) { console.error('[GEA] ficha técnica:', error.message); return 0; }
  return 1;
}

// Memo de baja firmado por el área usuaria. Bucket privado 'evidencia',
// carpeta MEMO/<id>/. Normalmente es un PDF, pero se acepta la foto del memo
// escaneado porque en faena a veces es lo único que llega.
const DOC_MEMO = { ...IMG, 'application/pdf': 'pdf' };
const subirMemo = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => cb(null, !!DOC_MEMO[f.mimetype]),
});

async function subirDocMemo(memoId, archivo) {
  const ext = archivo && DOC_MEMO[archivo.mimetype];
  if (!ext) return 0;
  const { error } = await supa.storage.from('evidencia')
    .upload(`MEMO/${memoId}/memo-${Date.now()}.${ext}`, archivo.buffer, { contentType: archivo.mimetype });
  if (error) { console.error('[GEA] documento del memo:', error.message); return 0; }
  return 1;
}

// Valida el memo que respalda un alta de componentes. Devuelve el id del memo,
// null si la migración aún no está aplicada, o false cuando ya respondió con el
// error: al llamador le basta con cortar.
async function memoDeLaSolicitud(req, res) {
  if (!tiene.memos) return null;
  const memo_id = Number(req.body?.memo_id) || null;
  if (!memo_id) {
    res.status(400).json({ error: 'Seleccione el memo de baja que respalda este componente' });
    return false;
  }
  const memo = await q(supa.from('memos').select('id').eq('id', memo_id).maybeSingle());
  if (!memo) { res.status(400).json({ error: 'El memo indicado no existe' }); return false; }
  return memo_id;
}

// Días corridos desde la publicación (0 el mismo día). El plazo se cumple
// cuando los días transcurridos igualan o superan plazo_dias.
const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);

/* ============================ memos de baja ============================ */

// Lista de memos con el avance de identificación en terreno de cada uno: el
// memo declara N componentes y el terreno confirma cuántos aparecieron.
r.get('/memos', OP, ah(async (_req, res) => {
  if (!tiene.memos) return res.json([]);
  const memos = await q(supa.from('memos').select('*').order('id', { ascending: false }));
  if (!memos.length) return res.json([]);
  const comps = await q(supa.from('componentes').select('id,memo_id,estado').in('memo_id', memos.map((m) => m.id)));
  res.json(memos.map((m) => {
    const suyos = comps.filter((c) => c.memo_id === m.id);
    return {
      ...m,
      componentes: suyos.length,
      por_identificar: suyos.filter((c) => c.estado === 'por_identificar').length,
      no_encontrados: suyos.filter((c) => c.estado === 'no_encontrado').length,
    };
  }));
}));

// Detalle del memo con los componentes que declara.
r.get('/memos/:id', OP, ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const m = await q(supa.from('memos').select('*').eq('id', Number(req.params.id) || 0).maybeSingle());
  if (!m) return res.status(404).json({ error: 'Memo no encontrado' });
  const comps = await q(supa.from('componentes').select('id,codigo,nombre,estado,nota_terreno,sitio_id')
    .eq('memo_id', m.id).order('id'));
  const sitios = new Map((await q(supa.from('sitios').select('id,nombre'))).map((s) => [s.id, s.nombre]));
  res.json({ ...m, componentes: comps.map((c) => ({ ...c, sitio: sitios.get(c.sitio_id) ?? null })) });
}));

// URL firmada (1 h) del memo escaneado.
r.get('/memos/:id/documento', OP, ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const carpeta = `MEMO/${Number(req.params.id) || 0}`;
  const { data: lista } = await supa.storage.from('evidencia').list(carpeta);
  if (!lista?.length) return res.json({ url: null });
  const { data } = await supa.storage.from('evidencia')
    .createSignedUrl(`${carpeta}/${lista[0].name}`, 3600);
  res.json({ url: data?.signedUrl ?? null });
}));

r.post('/memos', MEL, subirMemo.single('doc'), ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const area_usuaria = (req.body?.area_usuaria || '').trim();
  if (!area_usuaria) return res.status(400).json({ error: 'Indique el área usuaria que genera el memo' });
  const fecha_memo = (req.body?.fecha_memo || '').trim() || hoy();
  const f = await folio('MEMO');
  const row = await q(supa.from('memos').insert({
    folio: f, area_usuaria, fecha_memo,
    emitido_por: (req.body?.emitido_por || '').trim() || null,
    referencia: (req.body?.referencia || '').trim() || null,
    observaciones: (req.body?.observaciones || '').trim() || null,
    creado_por: req.user.name,
  }).select().single());
  const n = await subirDocMemo(row.id, req.file);
  if (n) await q(supa.from('memos').update({ doc: n }).eq('id', row.id).select('id').single());
  await audit(req.user.name, req.user.role, 'Cargó memo de baja',
    `${f} · ${area_usuaria}${n ? ' · documento firmado' : ' · sin documento adjunto'}`);
  res.json({ ...row, doc: n });
}));

r.patch('/memos/:id', MEL, ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const b = req.body || {};
  const cambios = {};
  for (const k of ['area_usuaria', 'emitido_por', 'referencia', 'observaciones']) {
    if (b[k] !== undefined) cambios[k] = (b[k] || '').trim() || null;
  }
  if (b.fecha_memo) cambios.fecha_memo = b.fecha_memo;
  if (b.estado !== undefined) {
    if (!['recibido', 'en_identificacion', 'cerrado'].includes(b.estado)) {
      return res.status(400).json({ error: 'Estado de memo inválido' });
    }
    cambios.estado = b.estado;
  }
  if (cambios.area_usuaria === null) return res.status(400).json({ error: 'El área usuaria es obligatoria' });
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const row = await q(supa.from('memos').update(cambios).eq('id', Number(req.params.id) || 0).select().single());
  await audit(req.user.name, req.user.role, 'Editó memo de baja', row.folio);
  res.json(row);
}));

// Solo se borra un memo que todavía no tiene componentes colgando: si los
// tiene, borrarlo dejaría activos sin respaldo de autorización.
r.delete('/memos/:id', MEL, ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const id = Number(req.params.id) || 0;
  const m = await q(supa.from('memos').select('folio').eq('id', id).maybeSingle());
  if (!m) return res.status(404).json({ error: 'Memo no encontrado' });
  const comps = await q(supa.from('componentes').select('id').eq('memo_id', id));
  if (comps.length) {
    return res.status(409).json({ error: `El memo ${m.folio} tiene ${comps.length} componente(s) asociados. Elimínelos primero.` });
  }
  try {
    const { data: lista } = await supa.storage.from('evidencia').list(`MEMO/${id}`);
    if (lista?.length) await supa.storage.from('evidencia').remove(lista.map((f) => `MEMO/${id}/${f.name}`));
  } catch (e) { console.error('[GEA] borrar documento de memo:', e.message); }
  await q(supa.from('memos').delete().eq('id', id).select('id').maybeSingle());
  await audit(req.user.name, req.user.role, 'Eliminó memo de baja', m.folio);
  res.json({ ok: true });
}));

/* ============================ inventario ============================ */

r.get('/componentes', OP, ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json({ componentes: [], pendientes: [] });
  const [comp, sitios, pubs, adj] = await Promise.all([
    q(supa.from('componentes').select('*').order('id', { ascending: false })),
    q(supa.from('sitios').select('id,codigo,nombre')),
    q(supa.from('publicaciones').select('*').eq('estado', 'activa')),
    q(supa.from('adjudicaciones').select('*').neq('estado', 'entregada')),
  ]);
  const sitio = new Map(sitios.map((s) => [s.id, s]));
  const pubDe = new Map(pubs.map((p) => [p.componente_id, p]));
  // Folio del memo que respalda cada componente, para que el inventario muestre
  // el origen de la autorización sin tener que abrir el memo.
  const memoDe = tiene.memos
    ? new Map((await q(supa.from('memos').select('id,folio,area_usuaria'))).map((m) => [m.id, m]))
    : new Map();
  const componentes = comp.map((c) => {
    const p = pubDe.get(c.id);
    const m = memoDe.get(c.memo_id);
    return {
      id: c.id, codigo: c.codigo, nombre: c.nombre, especificaciones: c.especificaciones,
      sitio_id: c.sitio_id, sitio: sitio.get(c.sitio_id)?.nombre ?? null, ubicacion: c.ubicacion,
      valor_referencial: num(c.valor_referencial), estado: c.estado, fotos: c.fotos ?? 0,
      memo_id: c.memo_id ?? null, memo: m?.folio ?? null, area_usuaria: m?.area_usuaria ?? null,
      nota_terreno: c.nota_terreno ?? null,
      programa_id: c.programa_id ?? null, chatarra_motivo: c.chatarra_motivo ?? null,
      dia: p ? diasDesde(p.publicado_el) : null, plazo: p?.plazo_dias ?? null,
    };
  });

  // Obsoletos que se fueron a chatarra y todavía nadie clasificó: sin patio,
  // categoría y peso no pueden entrar al programa de limpieza, y mientras tanto
  // están marcados como chatarra sin que nadie los vaya a buscar.
  const porClasificar = !tiene.chatarra_obs ? [] : comp
    .filter((c) => c.estado === 'chatarra' && !c.programa_id)
    .map((c) => ({
      id: c.id, codigo: c.codigo, nombre: c.nombre,
      sitio: sitio.get(c.sitio_id)?.nombre ?? null, ubicacion: c.ubicacion,
      motivo: c.chatarra_motivo ?? null,
      desde: c.chatarra_el ? diasDesde(c.chatarra_el.slice(0, 10)) : null,
    }));
  // Pendientes de entrega: adjudicados sin retiro coordinado.
  const compById = new Map(comp.map((c) => [c.id, c]));
  const pubById = new Map((await q(supa.from('publicaciones').select('id,componente_id'))).map((p) => [p.id, p]));
  const compradores = adj.length
    ? new Map((await q(supa.from('compradores').select('id,razon_social'))).map((x) => [x.id, x.razon_social]))
    : new Map();
  const pendientes = adj.map((a) => {
    const comp = compById.get(pubById.get(a.publicacion_id)?.componente_id);
    return {
      adjudicacion_id: a.id, componente: comp?.nombre ?? '—', codigo: comp?.codigo ?? null,
      comprador: compradores.get(a.comprador_id) ?? '—',
      adjudicado_el: a.creado_el?.slice(0, 10) ?? null,
      dias_espera: a.creado_el ? diasDesde(a.creado_el.slice(0, 10)) : null,
      estado: a.estado,
    };
  });
  res.json({ componentes, pendientes, porClasificar });
}));

r.post('/componentes', OP, subir.fields(CAMPOS_COMP), ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const { nombre, especificaciones, sitio_id, ubicacion, valor_referencial } = req.body || {};
  const codigo = (req.body?.codigo || '').trim();
  // El código es el SKU de SAP: lo digita el usuario, no es correlativo.
  if (!codigo) return res.status(400).json({ error: 'El código (SKU SAP) es obligatorio' });
  if (!(nombre || '').trim()) return res.status(400).json({ error: 'El nombre del componente es obligatorio' });
  if (valor_referencial != null && valor_referencial !== '' && !(Number(valor_referencial) >= 0)) {
    return res.status(400).json({ error: 'El valor referencial debe ser un monto válido' });
  }
  // El memo es el respaldo de autorización del activo: sin él no hay origen.
  // Nace "por identificar" porque el memo lo declara, pero todavía nadie lo vio
  // en terreno; recién confirmado pasa a estar disponible para publicar.
  const memo_id = await memoDeLaSolicitud(req, res);
  if (memo_id === false) return;
  const dup = await q(supa.from('componentes').select('id').eq('codigo', codigo));
  if (dup.length) return res.status(409).json({ error: `Ya existe un componente con el código ${codigo}` });
  const row = await q(supa.from('componentes').insert({
    codigo, nombre: nombre.trim(), especificaciones: (especificaciones || '').trim() || null,
    sitio_id: sitio_id ? Number(sitio_id) : null, ubicacion: (ubicacion || '').trim() || null,
    valor_referencial: Number(valor_referencial) >= 0 && valor_referencial !== '' ? Number(valor_referencial) : null,
    ...(tiene.memos ? { memo_id, estado: 'por_identificar' } : {}),
    creado_por: req.user.name,
  }).select().single());
  const nf = await subirFotos(row.id, req.files?.fotos);
  const nficha = await subirFicha(row.id, req.files?.ficha?.[0]);
  const total = nf + nficha;
  if (total) await q(supa.from('componentes').update({ fotos: total }).eq('id', row.id).select('id').single());
  await audit(req.user.name, req.user.role, 'Ingresó componente obsoleto al inventario',
    `${codigo} · ${nombre}${nf ? ` · ${nf} foto(s)` : ''}${nficha ? ' · ficha técnica' : ''}`);
  res.json({ ...row, fotos: total });
}));

// URLs firmadas (1 h) de los adjuntos de un componente: fotos y ficha técnica.
// El tipo se deduce del nombre del archivo (foto-… / ficha-…).
r.get('/componentes/:id/adjuntos', OP, ah(async (req, res) => {
  const carpeta = `OBS/${Number(req.params.id)}`;
  const { data: lista, error } = await supa.storage.from('evidencia').list(carpeta);
  if (error) throw new Error(error.message);
  if (!lista?.length) return res.json({ archivos: [] });
  const { data: firmadas, error: e2 } = await supa.storage.from('evidencia')
    .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
  if (e2) throw new Error(e2.message);
  res.json({
    archivos: firmadas.map((f, i) => ({ url: f.signedUrl, tipo: lista[i].name.startsWith('ficha-') ? 'ficha' : 'foto' }))
      .filter((f) => f.url),
  });
}));

// Elimina toda la carpeta de adjuntos de un componente en el bucket.
async function borrarAdjuntos(componenteId) {
  try {
    const { data: lista } = await supa.storage.from('evidencia').list(`OBS/${componenteId}`);
    if (lista?.length) await supa.storage.from('evidencia').remove(lista.map((f) => `OBS/${componenteId}/${f.name}`));
  } catch (e) { console.error('[GEA] borrar adjuntos:', e.message); }
}

r.patch('/componentes/:id', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const b = req.body || {};
  const cambios = {};
  if (b.codigo !== undefined) {
    const codigo = (b.codigo || '').trim();
    if (!codigo) return res.status(400).json({ error: 'El código (SKU SAP) es obligatorio' });
    const dup = await q(supa.from('componentes').select('id').eq('codigo', codigo).neq('id', req.params.id));
    if (dup.length) return res.status(409).json({ error: `Ya existe otro componente con el código ${codigo}` });
    cambios.codigo = codigo;
  }
  for (const k of ['nombre', 'especificaciones', 'ubicacion']) {
    if (b[k] !== undefined) cambios[k] = (b[k] || '').trim() || null;
  }
  if (b.sitio_id !== undefined) cambios.sitio_id = b.sitio_id ? Number(b.sitio_id) : null;
  if (b.valor_referencial !== undefined) cambios.valor_referencial = Number(b.valor_referencial) >= 0 && b.valor_referencial !== '' ? Number(b.valor_referencial) : null;
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const row = await q(supa.from('componentes').update(cambios).eq('id', req.params.id).select().single());
  await audit(req.user.name, req.user.role, 'Editó componente obsoleto', row.codigo);
  res.json(row);
}));

// Elimina un componente. No se puede si ya tuvo publicación (para no romper la
// trazabilidad de publicaciones/ofertas/adjudicaciones): en ese caso se sigue
// el flujo (cancelar/convertir), no el borrado.
r.delete('/componentes/:id', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const id = Number(req.params.id);
  const comp = await q(supa.from('componentes').select('*').eq('id', id).single());
  const pubs = await q(supa.from('publicaciones').select('id').eq('componente_id', id));
  if (pubs.length) return res.status(409).json({ error: 'El componente ya tuvo publicación; no se elimina. Cancele o convierta la publicación en su lugar.' });
  if (comp.fotos > 0) await borrarAdjuntos(id);   // sin adjuntos, no se toca el storage
  await q(supa.from('componentes').delete().eq('id', id).select('id'));
  await audit(req.user.name, req.user.role, 'Eliminó componente obsoleto', comp.codigo);
  res.json({ ok: true });
}));

// Conciliación de terreno: el memo declara el componente, y acá se confirma si
// apareció. Es el decisor "¿componentes encontrados?" del diagrama — su lado NO
// dejaba de existir, porque un componente que nunca se vio no se ingresaba.
r.post('/componentes/:id/terreno', OP, ah(async (req, res) => {
  if (!tiene.memos) return sinMemos(res);
  const id = Number(req.params.id) || 0;
  const c = await q(supa.from('componentes').select('id,codigo,nombre,estado').eq('id', id).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Componente no encontrado' });
  if (!['por_identificar', 'no_encontrado', 'planificado'].includes(c.estado)) {
    return res.status(409).json({ error: 'El componente ya avanzó en el proceso: no se puede reabrir la identificación en terreno' });
  }
  const encontrado = req.body?.encontrado !== false;
  const nota = (req.body?.nota || '').trim() || null;
  if (!encontrado && !nota) {
    return res.status(400).json({ error: 'Indique por qué el componente no se encontró en terreno' });
  }
  const row = await q(supa.from('componentes').update({
    estado: encontrado ? 'planificado' : 'no_encontrado', nota_terreno: nota,
  }).eq('id', id).select().single());
  await audit(req.user.name, req.user.role,
    encontrado ? 'Confirmó componente en terreno' : 'Registró componente no encontrado en terreno',
    `${c.codigo} · ${c.nombre}${nota ? ` · ${nota}` : ''}`);
  res.json(row);
}));

// Carga masiva de componentes: o entran todos, o no entra ninguno. Cada fila
// puede traer nombre de sitio (MEL/La Negra) o sitio_id.
r.post('/componentes/masivo', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  if (!filas.length) return res.status(400).json({ error: 'No hay filas que cargar' });
  if (filas.length > 500) return res.status(400).json({ error: 'Máximo 500 filas por carga' });
  // La carga masiva es justamente la lista que viene en el memo.
  const memo_id = await memoDeLaSolicitud(req, res);
  if (memo_id === false) return;

  const sitios = await q(supa.from('sitios').select('id,codigo,nombre'));
  const porNombre = new Map(sitios.map((s) => [s.nombre.trim().toLowerCase(), s.id]));
  const existentes = new Set((await q(supa.from('componentes').select('codigo'))).map((c) => c.codigo));
  const errores = [];
  const vistos = new Set();
  const limpias = [];
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i], n = i + 1;
    const codigo = String(f.codigo ?? '').trim();
    const nombre = String(f.nombre ?? '').trim();
    if (!codigo) errores.push(`Fila ${n}: falta el código (SKU SAP)`);
    else if (existentes.has(codigo) || vistos.has(codigo)) errores.push(`Fila ${n}: código repetido ("${codigo}")`);
    vistos.add(codigo);
    if (!nombre) { errores.push(`Fila ${n}: falta el nombre`); continue; }
    let sitio_id = Number(f.sitio_id) || null;
    if (!sitio_id && f.sitio) {
      sitio_id = porNombre.get(String(f.sitio).trim().toLowerCase()) || null;
      if (!sitio_id) errores.push(`Fila ${n}: sitio desconocido ("${f.sitio}")`);
    }
    const vr = f.valor_referencial;
    if (vr != null && vr !== '' && !(Number(vr) >= 0)) errores.push(`Fila ${n}: valor referencial inválido`);
    limpias.push({
      codigo, nombre, especificaciones: String(f.especificaciones ?? '').trim() || null,
      sitio_id, ubicacion: String(f.ubicacion ?? '').trim() || null,
      valor_referencial: Number(vr) >= 0 && vr !== '' && vr != null ? Number(vr) : null,
      ...(tiene.memos ? { memo_id, estado: 'por_identificar' } : {}),
      creado_por: req.user.name,
    });
  }
  if (errores.length) return res.status(400).json({ error: 'La carga no entró', detalle: errores.slice(0, 12) });

  const rows = await q(supa.from('componentes').insert(limpias).select('id,codigo'));
  await audit(req.user.name, req.user.role, 'Carga masiva de componentes', `${rows.length} componente(s)`);
  res.json({ cargados: rows.length, filas: rows });
}));

/* ==================== derivación a chatarra (Fase 1) ==================== */

// Clasificación del obsoleto no vendido. Fase 1 mueve kilos de una categoría
// desde un patio, y el componente no trae ninguno de los tres datos: por eso
// los pide una persona que fue a mirar la pieza. Con ellos se crea el registro
// en `programa`, que es lo que manda a la cuadrilla a buscarlo; hasta entonces
// el componente estaba marcado como chatarra y nadie se enteraba.
r.post('/componentes/:id/clasificar', OP, ah(async (req, res) => {
  if (!tiene.chatarra_obs) {
    return res.status(503).json({ error: 'Esta función requiere aplicar db/0009_chatarra.sql en la base de datos' });
  }
  const id = Number(req.params.id) || 0;
  const c = await q(supa.from('componentes').select('*').eq('id', id).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Componente no encontrado' });
  if (c.estado !== 'chatarra') return res.status(409).json({ error: 'Solo se clasifica un componente derivado a chatarra' });
  if (c.programa_id) return res.status(409).json({ error: 'Este componente ya fue derivado al programa de limpieza' });

  const patio_id = Number(req.body?.patio_id) || 0;
  const categoria_id = Number(req.body?.categoria_id) || 0;
  const peso = Number(req.body?.peso_estimado_kg);
  const fecha = (req.body?.fecha || '').trim() || hoy();
  if (!patio_id) return res.status(400).json({ error: 'Indique el patio donde se retirará' });
  if (!categoria_id) return res.status(400).json({ error: 'Indique la categoría de chatarra' });
  if (!(peso > 0)) return res.status(400).json({ error: 'Indique el peso estimado en kilos' });

  // `programa` planifica en toneladas y exige año, semana y día de la semana.
  const { anio, semana } = semanaISO(new Date(fecha + 'T12:00:00'));
  const dia = DIAS[new Date(fecha + 'T12:00:00').getDay()];
  if (!dia) return res.status(400).json({ error: 'El programa de limpieza no opera los domingos' });
  const ton = Math.round((peso / 1000) * 10) / 10;
  if (!(ton > 0)) return res.status(400).json({ error: 'El peso estimado es demasiado bajo: el programa se planifica en toneladas (mínimo 100 kg)' });

  const prog = await q(supa.from('programa').insert({
    anio, semana, dia, fecha, patio_id, categoria_id, ton_estimadas: ton,
    observacion: `Obsoleto no vendido · ${c.codigo} · ${c.nombre}`,
    creado_por: req.user.name,
  }).select('id').single());

  const row = await q(supa.from('componentes').update({
    patio_id, categoria_id, peso_estimado_kg: peso, programa_id: prog.id,
    clasificado_el: new Date().toISOString(), clasificado_por: req.user.name,
  }).eq('id', id).select().single());

  await audit(req.user.name, req.user.role, 'Derivó obsoleto al programa de chatarra',
    `${c.codigo} · ${peso} kg · semana ${semana}/${anio}`);
  res.json({ ...row, programa: { id: prog.id, anio, semana, dia, ton } });
}));

/* ============================ publicaciones ============================ */

async function vistaPublicacion(p, comp, conteo) {
  const dia = diasDesde(p.publicado_el);
  const restantes = p.plazo_dias - dia;
  return {
    id: p.id, componente_id: p.componente_id,
    componente: comp?.nombre ?? '—', codigo: comp?.codigo ?? null, especificaciones: comp?.especificaciones ?? null,
    publicado_el: p.publicado_el, plazo_dias: p.plazo_dias, oferta_minima: num(p.oferta_minima),
    dia, dias_restantes: restantes, vencido: dia >= p.plazo_dias,
    ofertas: conteo ?? 0, estado: p.estado, cerrada_el: p.cerrada_el,
  };
}

r.get('/publicaciones', OP, ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json([]);
  const [pubs, comps, ofertas] = await Promise.all([
    q(supa.from('publicaciones').select('*').order('id', { ascending: false })),
    q(supa.from('componentes').select('id,codigo,nombre,especificaciones')),
    q(supa.from('ofertas').select('publicacion_id')),
  ]);
  const compById = new Map(comps.map((c) => [c.id, c]));
  const conteo = new Map();
  for (const o of ofertas) conteo.set(o.publicacion_id, (conteo.get(o.publicacion_id) ?? 0) + 1);
  const filas = await Promise.all(pubs.map((p) => vistaPublicacion(p, compById.get(p.componente_id), conteo.get(p.id))));
  res.json(filas);
}));

r.post('/publicaciones', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const { componente_id, oferta_minima, plazo_dias, publicado_el } = req.body || {};
  if (!componente_id) return res.status(400).json({ error: 'Elija el componente a publicar' });
  const comp = await q(supa.from('componentes').select('*').eq('id', componente_id).single());
  if (comp.estado === 'publicado') return res.status(409).json({ error: 'El componente ya está publicado' });
  if (['adjudicado', 'entregado'].includes(comp.estado)) return res.status(409).json({ error: 'El componente ya fue adjudicado' });
  if (publicado_el && !/^\d{4}-\d{2}-\d{2}$/.test(publicado_el)) return res.status(400).json({ error: 'Fecha inválida' });
  const plazo = Number(plazo_dias) > 0 ? Number(plazo_dias) : 15;

  const p = await q(supa.from('publicaciones').insert({
    componente_id: Number(componente_id),
    publicado_el: publicado_el || hoy(), plazo_dias: plazo,
    oferta_minima: Number(oferta_minima) > 0 ? Number(oferta_minima) : null,
    creado_por: req.user.name,
  }).select().single());
  await q(supa.from('componentes').update({ estado: 'publicado' }).eq('id', componente_id).select('id').single());
  await audit(req.user.name, req.user.role, 'Publicó componente en el portal', `${comp.codigo} · plazo ${plazo} días`);
  res.json(await vistaPublicacion(p, comp, 0));
}));

// Regla de 15 días: sin adjudicar al cumplirse el plazo, el componente se
// convierte en chatarra y pasa al flujo de enajenación (Fase 1). La baja del
// activo la ejecuta el Coordinador; aquí se marca y se deja en la bitácora.
r.post('/publicaciones/:id/convertir', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const p = await q(supa.from('publicaciones').select('*').eq('id', req.params.id).single());
  if (p.estado !== 'activa') return res.status(409).json({ error: 'La publicación no está activa' });
  // Se puede forzar antes de que se cumpla el plazo (es lo que permite probar
  // el paso sin esperar los 15 días). La conversión es la misma que aplica el
  // barrido automático, para que no vuelvan a divergir.
  const r2 = await convertirAChatarra(p, { usuario: req.user.name, rol: req.user.role });
  res.json({ ok: true, anticipada: r2.anticipada, ofertas: r2.ofertas });
}));

r.post('/publicaciones/:id/cancelar', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const p = await q(supa.from('publicaciones').select('*').eq('id', req.params.id).single());
  if (p.estado !== 'activa') return res.status(409).json({ error: 'Solo se cancela una publicación activa' });
  await q(supa.from('publicaciones').update({ estado: 'cancelada', cerrada_el: new Date().toISOString() }).eq('id', p.id).select('id').single());
  await q(supa.from('componentes').update({ estado: 'planificado' }).eq('id', p.componente_id).select('id').single());
  await audit(req.user.name, req.user.role, 'Canceló publicación', String(p.id));
  res.json({ ok: true });
}));

/* ============================ ofertas ============================ */

r.get('/publicaciones/:id/ofertas', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return res.json({ ofertas: [] });
  const ofertas = await q(supa.from('ofertas').select('*').eq('publicacion_id', req.params.id).order('monto', { ascending: false }));
  const ids = [...new Set(ofertas.map((o) => o.comprador_id))];
  const compradores = ids.length
    ? new Map((await q(supa.from('compradores').select('*').in('id', ids))).map((c) => [c.id, c]))
    : new Map();
  res.json({
    ofertas: ofertas.map((o) => {
      const c = compradores.get(o.comprador_id);
      return {
        id: o.id, comprador_id: o.comprador_id, oferente: c?.razon_social ?? '—', dd_estado: c?.dd_estado ?? null,
        monto: num(o.monto), plazo_retiro: o.plazo_retiro, forma_pago: o.forma_pago,
        comentarios: o.comentarios, estado: o.estado,
      };
    }),
  });
}));

/* ============================ matriz de evaluación ============================ */

r.get('/criterios', OP, ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json([]);
  res.json(await q(supa.from('criterios').select('*').eq('activo', true).order('orden')));
}));

// Ajuste de ponderaciones (no cambia adjudicaciones ya emitidas: la matriz
// queda congelada en cada certificado).
r.patch('/criterios', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const filas = Array.isArray(req.body?.pesos) ? req.body.pesos : [];
  if (!filas.length) return res.status(400).json({ error: 'No hay ponderaciones que guardar' });
  for (const f of filas) {
    if (!(Number(f.peso) >= 0 && Number(f.peso) <= 100)) return res.status(400).json({ error: 'Cada peso debe estar entre 0 y 100' });
    await q(supa.from('criterios').update({ peso: Number(f.peso) }).eq('id', f.id).select('id').single());
  }
  await audit(req.user.name, req.user.role, 'Ajustó ponderaciones de la matriz de evaluación', `${filas.length} criterio(s)`);
  res.json(await q(supa.from('criterios').select('*').eq('activo', true).order('orden')));
}));

/* ============================ adjudicación ============================ */

// Recibe los puntajes (1–10) de cada oferta en cada criterio, calcula el puntaje
// ponderado, adjudica a la oferta indicada (por defecto la de mayor puntaje) y
// emite el certificado. Congela la matriz y calcula la comisión al vendor.
r.post('/publicaciones/:id/adjudicar', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const p = await q(supa.from('publicaciones').select('*').eq('id', req.params.id).single());
  if (p.estado !== 'activa') return res.status(409).json({ error: 'La publicación no está activa' });
  const ofertas = await q(supa.from('ofertas').select('*').eq('publicacion_id', p.id));
  if (!ofertas.length) return res.status(400).json({ error: 'No hay ofertas que adjudicar' });

  const criterios = await q(supa.from('criterios').select('*').eq('activo', true).order('orden'));
  const pesoTotal = criterios.reduce((a, c) => a + c.peso, 0) || 1;
  const puntajes = req.body?.puntajes || {};   // { ofertaId: { criterioId: 1..10 } }
  const totales = ofertas.map((o) => {
    const pj = puntajes[o.id] || {};
    const suma = criterios.reduce((a, c) => a + (Number(pj[c.id]) || 0) * c.peso, 0);
    return { oferta_id: o.id, total: Math.round((suma / pesoTotal) * 100) / 100 };
  });
  const orden = [...totales].sort((a, b) => b.total - a.total);
  const ganadorId = Number(req.body?.oferta_id) || orden[0]?.oferta_id;
  const ganadora = ofertas.find((o) => o.id === ganadorId);
  if (!ganadora) return res.status(400).json({ error: 'La oferta ganadora no pertenece a esta publicación' });

  const cfg = await contrato();
  const comisionPct = Number(cfg.comision_vendor_pct) || 0;
  const comisionMonto = Math.round(Number(ganadora.monto) * comisionPct / 100);
  const cert = await folio('CA');
  const comp = await q(supa.from('componentes').select('*').eq('id', p.componente_id).single());
  const compradores = new Map((await q(supa.from('compradores').select('id,razon_social,rut,email').in('id', ofertas.map((o) => o.comprador_id)))).map((c) => [c.id, c]));

  const matriz = {
    criterios: criterios.map((c) => ({ id: c.id, nombre: c.nombre, peso: c.peso })),
    ofertas: ofertas.map((o) => ({
      oferta_id: o.id, oferente: compradores.get(o.comprador_id)?.razon_social ?? '—',
      puntajes: puntajes[o.id] || {}, total: totales.find((t) => t.oferta_id === o.id)?.total ?? 0,
    })),
    ganador: ganadorId,
  };

  const adj = await q(supa.from('adjudicaciones').insert({
    publicacion_id: p.id, oferta_id: ganadora.id, comprador_id: ganadora.comprador_id,
    cert_folio: cert, matriz, monto: Number(ganadora.monto),
    comision_pct: comisionPct, comision_monto: comisionMonto, creado_por: req.user.name,
  }).select().single());

  await q(supa.from('publicaciones').update({ estado: 'adjudicada', cerrada_el: new Date().toISOString() }).eq('id', p.id).select('id').single());
  await q(supa.from('componentes').update({ estado: 'adjudicado' }).eq('id', p.componente_id).select('id').single());
  await q(supa.from('ofertas').update({ estado: 'descartada' }).eq('publicacion_id', p.id).select('id'));
  await q(supa.from('ofertas').update({ estado: 'adjudicada' }).eq('id', ganadora.id).select('id').single());
  await audit(req.user.name, req.user.role, 'Adjudicó publicación y emitió certificado',
    `${cert} · ${comp.codigo} → ${compradores.get(ganadora.comprador_id)?.razon_social ?? ''} · ${usd(ganadora.monto)}`);

  // Notificación a todos los oferentes: al ganador su adjudicación, al resto el
  // cierre. Un mismo oferente que ofertó dos veces recibe un solo correo.
  const avisados = new Set();
  for (const o of ofertas) {
    const c = compradores.get(o.comprador_id);
    if (!c?.email || avisados.has(c.email)) continue;
    avisados.add(c.email);
    const gana = o.comprador_id === ganadora.comprador_id;
    enviarCorreo({
      to: c.email,
      subject: gana ? 'Adjudicación · Venta de obsoletos MEL' : 'Resultado de su oferta · Venta de obsoletos MEL',
      html: plantilla(gana ? {
        titulo: `Su oferta fue adjudicada`,
        cuerpo: `Felicitaciones: <b>${c.razon_social}</b> se adjudicó <b>${comp.nombre}</b> (${comp.codigo}) por <b>${usd(ganadora.monto)}</b>, certificado <b>${cert}</b>. Le contactaremos para coordinar el pago y el retiro.`,
      } : {
        titulo: 'Resultado de la adjudicación',
        cuerpo: `Le informamos que la publicación de <b>${comp.nombre}</b> (${comp.codigo}) fue adjudicada a otro oferente. Agradecemos su participación y lo invitamos a revisar nuevas publicaciones.`,
        cta: 'Ver publicaciones',
      }),
    });
  }
  res.json({ ...adj, cert_folio: cert });
}));

async function vistaAdjudicacion(a, comp, comprador) {
  return {
    id: a.id, cert_folio: a.cert_folio, componente: comp?.nombre ?? '—', codigo: comp?.codigo ?? null,
    comprador: comprador?.razon_social ?? '—', comprador_rut: comprador?.rut ?? null,
    monto: num(a.monto), comision_pct: num(a.comision_pct), comision_monto: num(a.comision_monto),
    estado: a.estado, matriz: a.matriz,
    pago_el: a.pago_el, pago_ref: a.pago_ref, guia_folio: a.guia_folio, entregado_el: a.entregado_el,
    creado_el: a.creado_el, creado_por: a.creado_por,
  };
}

r.get('/adjudicaciones', OP, ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json([]);
  const adj = await q(supa.from('adjudicaciones').select('*').order('id', { ascending: false }));
  if (!adj.length) return res.json([]);
  const pubs = new Map((await q(supa.from('publicaciones').select('id,componente_id'))).map((p) => [p.id, p]));
  const comps = new Map((await q(supa.from('componentes').select('id,codigo,nombre'))).map((c) => [c.id, c]));
  const compradores = new Map((await q(supa.from('compradores').select('id,razon_social,rut'))).map((c) => [c.id, c]));
  res.json(await Promise.all(adj.map((a) =>
    vistaAdjudicacion(a, comps.get(pubs.get(a.publicacion_id)?.componente_id), compradores.get(a.comprador_id)))));
}));

// Paso 2 del flujo posterior: registro y verificación del pago por transferencia.
r.post('/adjudicaciones/:id/pago', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const a = await q(supa.from('adjudicaciones').select('*').eq('id', req.params.id).single());
  if (a.estado !== 'adjudicada') return res.status(409).json({ error: 'El pago ya fue registrado o el retiro ya se entregó' });
  const row = await q(supa.from('adjudicaciones').update({
    estado: 'pagada', pago_el: new Date().toISOString(), pago_ref: (req.body?.pago_ref || '').trim() || null,
  }).eq('id', a.id).select('id').single());
  await audit(req.user.name, req.user.role, 'Registró pago de adjudicación', a.cert_folio);
  res.json(row);
}));

// Paso 4: guía de despacho + certificado de entrega, retiro coordinado.
r.post('/adjudicaciones/:id/entrega', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const a = await q(supa.from('adjudicaciones').select('*').eq('id', req.params.id).single());
  if (a.estado === 'entregada') return res.status(409).json({ error: 'El retiro ya fue entregado' });
  if (a.estado !== 'pagada') return res.status(409).json({ error: 'Registre el pago antes de coordinar el retiro' });
  const row = await q(supa.from('adjudicaciones').update({
    estado: 'entregada', entregado_el: new Date().toISOString(), guia_folio: (req.body?.guia_folio || '').trim() || null,
  }).eq('id', a.id).select('*').single());
  const pub = await q(supa.from('publicaciones').select('componente_id').eq('id', a.publicacion_id).single());
  await q(supa.from('componentes').update({ estado: 'entregado' }).eq('id', pub.componente_id).select('id').single());
  await audit(req.user.name, req.user.role, 'Registró entrega del componente adjudicado', `${a.cert_folio}${row.guia_folio ? ` · guía ${row.guia_folio}` : ''}`);
  res.json(row);
}));

/* ============================ compradores (due diligence) ============================ */

r.get('/compradores', OP, ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json([]);
  const [compradores, ofertas] = await Promise.all([
    q(supa.from('compradores').select('*').order('id', { ascending: false })),
    q(supa.from('ofertas').select('comprador_id')),
  ]);
  const conteo = new Map();
  for (const o of ofertas) conteo.set(o.comprador_id, (conteo.get(o.comprador_id) ?? 0) + 1);
  res.json(compradores.map((c) => ({ ...c, ofertas: conteo.get(c.id) ?? 0 })));
}));

r.post('/compradores/:id/dd', OP, ah(async (req, res) => {
  if (!tiene.obsoletos) return sinTabla(res);
  const estado = req.body?.dd_estado;
  if (!['aprobada', 'rechazada', 'pendiente'].includes(estado)) return res.status(400).json({ error: 'Estado de due diligence inválido' });
  const row = await q(supa.from('compradores').update({
    dd_estado: estado, dd_nota: (req.body?.dd_nota || '').trim() || null,
  }).eq('id', req.params.id).select('*').single());
  // La cuenta de acceso se habilita solo con la DD aprobada.
  if (row.user_id) {
    await q(supa.from('users').update({ activo: estado === 'aprobada' }).eq('id', row.user_id).select('id').single());
  }
  await audit(req.user.name, req.user.role, `Due diligence ${estado}`, `${row.razon_social} (${row.rut})`);
  if (estado === 'aprobada') {
    enviarCorreo({
      to: row.email, subject: 'Cuenta habilitada · Venta de obsoletos MEL',
      html: plantilla({
        titulo: 'Su due diligence fue aprobada',
        cuerpo: `La cuenta de <b>${row.razon_social}</b> quedó habilitada. Ya puede iniciar sesión en el portal con su correo y contraseña para presentar ofertas por las publicaciones vigentes.`,
        cta: 'Ir al portal',
      }),
    });
  } else if (estado === 'rechazada') {
    enviarCorreo({
      to: row.email, subject: 'Resultado de su registro · Venta de obsoletos MEL',
      html: plantilla({
        titulo: 'Registro no aprobado',
        cuerpo: `Lamentamos informar que el registro de <b>${row.razon_social}</b> no fue aprobado en esta oportunidad.${row.dd_nota ? ` Observación: ${row.dd_nota}.` : ''}`,
      }),
    });
  }
  res.json(row);
}));

export default r;
