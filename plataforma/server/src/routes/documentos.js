// Fase 3 · Repositorio documental.
// Los 9 tipos documentales de chatarra y los 14 de obsoletos, cada documento
// vinculado al hito que respalda, con versiones inmutables y control de
// vencimientos. Qué ve y qué carga cada perfil lo dice el catálogo doc_tipos,
// que el coordinador ajusta desde la pantalla sin tocar la base.
import { Router } from 'express';
import multer from 'multer';
import { supa, q, ah, folio, audit } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import {
  BUCKET, MIME, HITOS, catalogoHitos, tiposDe, puedeVer, puedeCargar,
  vencimiento, rotulos, faltantes,
} from '../documental.js';

const r = Router();
// Todos los perfiles internos; el comprador externo no entra al repositorio.
const ROLES = ['limpieza', 'vendor', 'ito', 'coordinador', 'lampa', 'admin_venta'];
const INTERNO = auth(...ROLES);
const sinTabla = (res) => res.status(503).json({ error: 'El repositorio documental requiere aplicar db/0015_documental.sql en la base de datos' });
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const subir = multer({
  storage: multer.memoryStorage(),
  // Nombres con tildes y eñes: sin esto el nombre original llega en latin1.
  defParamCharset: 'utf8',
  limits: { files: 10, fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, f, cb) => (MIME[f.mimetype]
    ? cb(null, true)
    : cb(Object.assign(new Error(`Formato no admitido: ${f.originalname}. Use PDF, imagen, Excel o Word.`), { code: 'FORMATO' }))),
});
// Los errores de multer llegan en inglés y como 500: se traducen a un 400 claro.
const recibir = (req, res, next) => subir.array('archivos', 10)(req, res, (err) => {
  if (!err) return next();
  const msg = {
    LIMIT_FILE_SIZE: 'Cada archivo puede pesar hasta 20 MB',
    LIMIT_FILE_COUNT: 'Puede adjuntar hasta 10 archivos por versión',
    LIMIT_UNEXPECTED_FILE: 'Puede adjuntar hasta 10 archivos por versión',
  }[err.code] ?? err.message;
  res.status(400).json({ error: msg });
});

// Sube los archivos de una versión. Devuelve los que entraron, listos para
// guardar en documento_versiones.archivos.
async function subirArchivos(docId, version, files = []) {
  const marca = Date.now();
  const out = [];
  for (const [i, f] of files.entries()) {
    const ext = MIME[f.mimetype];
    if (!ext) continue;
    const path = `${docId}/v${version}-${marca}-${i + 1}.${ext}`;
    const { error } = await supa.storage.from(BUCKET).upload(path, f.buffer, { contentType: f.mimetype });
    if (error) { console.error('[GEA] documento:', error.message); continue; }
    out.push({ bucket: BUCKET, path, nombre: f.originalname, mime: f.mimetype, bytes: f.size });
  }
  return out;
}

const tipoDe = async (codigo) => q(supa.from('doc_tipos').select('*').eq('codigo', codigo).maybeSingle());

// Documento con su tipo, verificando que el rol pueda verlo. Responde el error
// y devuelve null cuando no corresponde: al llamador le basta con cortar.
async function docVisible(req, res) {
  const doc = await q(supa.from('documentos').select('*').eq('id', Number(req.params.id) || 0).maybeSingle());
  const tipo = doc && (await tipoDe(doc.tipo));
  if (!doc || !tipo || !puedeVer(tipo, req.user.role)) {
    res.status(404).json({ error: 'Documento no encontrado' });
    return null;
  }
  return { doc, tipo };
}

const vista = (d, tipo, ent, ultima, rol) => ({
  id: d.id, folio: d.folio, titulo: d.titulo,
  tipo: d.tipo, tipo_nombre: tipo?.nombre ?? d.tipo, proceso: tipo?.proceso ?? null,
  hito: d.hito, hito_nombre: HITOS[d.hito]?.nombre ?? d.hito,
  ref_id: d.ref_id, ref_label: ent?.label ?? d.ref_label ?? `#${d.ref_id}`,
  ref_estado: ent?.estado ?? null,
  version_actual: d.version_actual, vence_el: d.vence_el, venc: vencimiento(d, tipo),
  estado: d.estado, anulado_motivo: d.anulado_motivo, anulado_por: d.anulado_por,
  creado_por: d.creado_por, creado_el: d.creado_el, actualizado_el: d.actualizado_el,
  ultima: ultima ? {
    subido_por: ultima.subido_por, subido_el: ultima.subido_el, archivos: ultima.archivos?.length ?? 0,
  } : null,
  puede_cargar: !!tipo && puedeCargar(tipo, rol),
});

/* ============================ catálogo ============================ */

r.get('/documentos/tipos', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const rol = req.user.role;
  const tipos = (await tiposDe())
    .filter((t) => puedeVer(t, rol) && (t.activo || rol === 'coordinador'))
    .map((t) => ({ ...t, puede_cargar: puedeCargar(t, rol) }));
  res.json({ tipos, hitos: catalogoHitos(), roles: ROLES });
}));

// Ajustes del catálogo (lo que se acordó en el levantamiento documental):
// responsables, vencimientos y en qué estado del hito el documento es exigible.
r.patch('/documentos/tipos/:codigo', auth('coordinador'), ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const t = await tipoDe(req.params.codigo);
  if (!t) return res.status(404).json({ error: 'Tipo documental no encontrado' });
  const b = req.body || {};
  const cambios = {};

  if (b.responsable !== undefined) cambios.responsable = String(b.responsable || '').trim() || null;
  if (b.descripcion !== undefined) cambios.descripcion = String(b.descripcion || '').trim() || null;
  if (b.activo !== undefined) cambios.activo = !!b.activo;
  if (b.vence !== undefined) cambios.vence = !!b.vence;
  if (b.vigencia_meses !== undefined) {
    const m = b.vigencia_meses === null || b.vigencia_meses === '' ? null : Number(b.vigencia_meses);
    if (m !== null && !(Number.isInteger(m) && m > 0 && m <= 120)) {
      return res.status(400).json({ error: 'La vigencia debe ser un número entero de meses entre 1 y 120' });
    }
    cambios.vigencia_meses = m;
  }
  if (b.aviso_dias !== undefined) {
    const d = Number(b.aviso_dias);
    if (!(Number.isInteger(d) && d >= 1 && d <= 365)) {
      return res.status(400).json({ error: 'La anticipación del aviso debe estar entre 1 y 365 días' });
    }
    cambios.aviso_dias = d;
  }
  for (const campo of ['roles_carga', 'roles_ver']) {
    if (b[campo] === undefined) continue;
    if (!Array.isArray(b[campo]) || b[campo].some((x) => !ROLES.includes(x))) {
      return res.status(400).json({ error: 'Perfil inválido en la configuración' });
    }
    cambios[campo] = [...new Set(b[campo])];
  }
  // El coordinador siempre puede cargar: alguien tiene que poder corregir.
  if (cambios.roles_carga && !cambios.roles_carga.includes('coordinador')) {
    return res.status(400).json({ error: 'El Coordinador Logístico MEL debe poder cargar todos los tipos documentales' });
  }
  if (b.exigible_en !== undefined) {
    const validos = Object.keys(HITOS[t.hito]?.estados ?? {});
    if (!Array.isArray(b.exigible_en) || b.exigible_en.some((x) => !validos.includes(x))) {
      return res.status(400).json({ error: 'Estado del hito inválido en la exigibilidad' });
    }
    cambios.exigible_en = [...new Set(b.exigible_en)];
  }
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });

  const row = await q(supa.from('doc_tipos').update(cambios).eq('codigo', t.codigo).select('*').single());
  await audit(req.user.name, req.user.role, 'Ajustó tipo documental',
    `${t.nombre} (${t.proceso}) · ${Object.keys(cambios).join(', ')}`);
  res.json({ ...row, puede_cargar: puedeCargar(row, req.user.role) });
}));

// Entidades de un hito, para elegir a cuál se vincula un documento.
r.get('/documentos/hitos/:hito', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const h = HITOS[req.params.hito];
  if (!h) return res.status(404).json({ error: 'Hito desconocido' });
  const rol = req.user.role;
  const tipos = (await tiposDe()).filter((t) => t.hito === req.params.hito && puedeVer(t, rol));
  if (!tipos.length) return res.status(403).json({ error: 'Su perfil no tiene documentos de este hito' });
  const ents = await h.listar();
  res.json(ents.map((e) => ({ ...e, estado_nombre: h.estados[e.estado] ?? e.estado })));
}));

/* ============================ documentos ============================ */

// Listado. Con ?hito=…&ref_id=… devuelve solo los de ese hito (para mostrarlos
// desde la pantalla del proceso).
r.get('/documentos', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const rol = req.user.role;
  const tipos = new Map((await tiposDe()).map((t) => [t.codigo, t]));
  const visibles = [...tipos.values()].filter((t) => puedeVer(t, rol)).map((t) => t.codigo);
  if (!visibles.length) return res.json([]);

  let b = supa.from('documentos').select('*').in('tipo', visibles).order('actualizado_el', { ascending: false }).limit(2000);
  if (req.query.hito) b = b.eq('hito', String(req.query.hito));
  if (req.query.ref_id) b = b.eq('ref_id', Number(req.query.ref_id) || 0);
  const docs = await q(b);
  if (!docs.length) return res.json([]);

  // Última versión de cada documento: quién la subió, cuándo y cuántos archivos.
  const vers = await q(supa.from('documento_versiones').select('documento_id, version, subido_por, subido_el, archivos')
    .in('documento_id', docs.map((d) => d.id)));
  const actual = new Map(docs.map((d) => [d.id, d.version_actual]));
  const ultima = new Map(vers.filter((v) => actual.get(v.documento_id) === v.version).map((v) => [v.documento_id, v]));
  const ents = await rotulos(docs);
  res.json(docs.map((d) => vista(d, tipos.get(d.tipo), ents.get(`${d.hito}:${d.ref_id}`), ultima.get(d.id), rol)));
}));

r.get('/documentos/pendientes', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  res.json(await faltantes(req.user.role));
}));

// Detalle con todas sus versiones (sin URLs: se firman al pedir cada versión).
r.get('/documentos/:id', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const v = await docVisible(req, res);
  if (!v) return;
  const { doc, tipo } = v;
  const [versiones, ents] = await Promise.all([
    q(supa.from('documento_versiones').select('*').eq('documento_id', doc.id).order('version', { ascending: false })),
    rotulos([doc]),
  ]);
  const ent = ents.get(`${doc.hito}:${doc.ref_id}`);
  res.json({
    ...vista(doc, tipo, ent, versiones[0], req.user.role),
    tipo_info: tipo,
    ref_estado_nombre: ent ? HITOS[doc.hito]?.estados[ent.estado] ?? ent.estado : null,
    versiones: versiones.map((x) => ({
      version: x.version, vence_el: x.vence_el, nota: x.nota,
      subido_por: x.subido_por, subido_rol: x.subido_rol, subido_el: x.subido_el,
      archivos: (x.archivos ?? []).map((a) => ({ nombre: a.nombre, mime: a.mime, bytes: a.bytes })),
    })),
  });
}));

// Archivos de una versión con URL firmada (1 hora).
r.get('/documentos/:id/versiones/:version', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const v = await docVisible(req, res);
  if (!v) return;
  const ver = await q(supa.from('documento_versiones').select('archivos')
    .eq('documento_id', v.doc.id).eq('version', Number(req.params.version) || 0).maybeSingle());
  if (!ver) return res.status(404).json({ error: 'Versión no encontrada' });
  const archivos = await Promise.all((ver.archivos ?? []).map(async (a) => {
    const { data } = await supa.storage.from(a.bucket || BUCKET).createSignedUrl(a.path, 3600);
    return { nombre: a.nombre, mime: a.mime, bytes: a.bytes, url: data?.signedUrl ?? null };
  }));
  res.json({ archivos });
}));

// Carga de un documento nuevo (versión 1).
r.post('/documentos', INTERNO, recibir, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const b = req.body || {};
  const tipo = await tipoDe(String(b.tipo || ''));
  if (!tipo || !tipo.activo) return res.status(400).json({ error: 'Seleccione un tipo documental válido' });
  if (!puedeCargar(tipo, req.user.role)) return res.status(403).json({ error: 'Su perfil no carga este tipo de documento' });

  const refId = Number(b.ref_id) || 0;
  const [ent] = refId ? await HITOS[tipo.hito].listar([refId]) : [];
  if (!ent) return res.status(400).json({ error: `Seleccione el ${HITOS[tipo.hito].nombre.toLowerCase()} al que corresponde el documento` });

  const venceEl = String(b.vence_el || '').trim() || null;
  if (venceEl && !FECHA.test(venceEl)) return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
  if (tipo.vence && !venceEl) return res.status(400).json({ error: `«${tipo.nombre}» vence: indique la fecha de vencimiento` });
  if (!req.files?.length) return res.status(400).json({ error: 'Adjunte al menos un archivo' });

  const titulo = String(b.titulo || '').trim() || `${tipo.nombre} · ${ent.label}`;
  const doc = await q(supa.from('documentos').insert({
    folio: await folio('DOC'), tipo: tipo.codigo, hito: tipo.hito, ref_id: refId, ref_label: ent.label,
    titulo, vence_el: tipo.vence ? venceEl : null, creado_por: req.user.name,
  }).select('*').single());

  const archivos = await subirArchivos(doc.id, 1, req.files);
  if (!archivos.length) {
    await supa.from('documentos').delete().eq('id', doc.id);
    return res.status(400).json({ error: 'No se pudo guardar ningún archivo. Intente nuevamente.' });
  }
  await q(supa.from('documento_versiones').insert({
    documento_id: doc.id, version: 1, archivos, vence_el: doc.vence_el,
    nota: String(b.nota || '').trim() || null, subido_por: req.user.name, subido_rol: req.user.role,
  }).select('id').single());
  await audit(req.user.name, req.user.role, 'Cargó documento al repositorio',
    `${doc.folio} · ${tipo.nombre} · ${ent.label}${doc.vence_el ? ` · vence ${doc.vence_el}` : ''}`);
  res.json({ ...doc, fallidos: req.files.length - archivos.length });
}));

// Versión nueva. Por defecto reemplaza los archivos; con conservar=1 suma los
// nuevos a los de la versión anterior (p. ej. un anexo que llegó después).
r.post('/documentos/:id/versiones', INTERNO, recibir, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const v = await docVisible(req, res);
  if (!v) return;
  const { doc, tipo } = v;
  if (!puedeCargar(tipo, req.user.role)) return res.status(403).json({ error: 'Su perfil no carga este tipo de documento' });
  if (doc.estado !== 'vigente') return res.status(409).json({ error: 'El documento está anulado: no admite versiones nuevas' });

  const b = req.body || {};
  const nota = String(b.nota || '').trim();
  if (!nota) return res.status(400).json({ error: 'Indique qué cambia en esta versión' });
  const venceEl = String(b.vence_el || '').trim() || null;
  if (venceEl && !FECHA.test(venceEl)) return res.status(400).json({ error: 'Fecha de vencimiento inválida' });
  if (tipo.vence && !venceEl) return res.status(400).json({ error: `«${tipo.nombre}» vence: indique la fecha de vencimiento de esta versión` });
  if (!req.files?.length) return res.status(400).json({ error: 'Adjunte al menos un archivo' });

  const version = doc.version_actual + 1;
  const nuevos = await subirArchivos(doc.id, version, req.files);
  if (!nuevos.length) return res.status(400).json({ error: 'No se pudo guardar ningún archivo. Intente nuevamente.' });
  let archivos = nuevos;
  if (['1', 'true', 'on'].includes(String(b.conservar))) {
    const ant = await q(supa.from('documento_versiones').select('archivos')
      .eq('documento_id', doc.id).eq('version', doc.version_actual).maybeSingle());
    archivos = [...(ant?.archivos ?? []), ...nuevos];
  }
  // La restricción única (documento, versión) frena dos cargas simultáneas.
  await q(supa.from('documento_versiones').insert({
    documento_id: doc.id, version, archivos, vence_el: tipo.vence ? venceEl : null, nota,
    subido_por: req.user.name, subido_rol: req.user.role,
  }).select('id').single());
  const row = await q(supa.from('documentos').update({
    version_actual: version, actualizado_el: new Date().toISOString(),
    ...(tipo.vence ? { vence_el: venceEl, aviso_por_vencer_el: null, aviso_vencido_el: null } : {}),
  }).eq('id', doc.id).select('*').single());
  await audit(req.user.name, req.user.role, 'Cargó nueva versión de documento',
    `${doc.folio} v${version} · ${tipo.nombre} · ${nota}`);
  res.json({ ...row, fallidos: req.files.length - nuevos.length });
}));

// Corrección del título o del vencimiento sin cargar archivos. El vencimiento
// declarado en cada versión queda intacto como historia; cambia el vigente.
r.patch('/documentos/:id', INTERNO, ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const v = await docVisible(req, res);
  if (!v) return;
  const { doc, tipo } = v;
  if (!puedeCargar(tipo, req.user.role)) return res.status(403).json({ error: 'Su perfil no carga este tipo de documento' });
  if (doc.estado !== 'vigente') return res.status(409).json({ error: 'El documento está anulado' });
  const b = req.body || {};
  const cambios = {};
  const detalle = [];
  if (b.titulo !== undefined) {
    const t = String(b.titulo || '').trim();
    if (!t) return res.status(400).json({ error: 'El título no puede quedar vacío' });
    if (t !== doc.titulo) { cambios.titulo = t; detalle.push(`título «${t}»`); }
  }
  if (b.vence_el !== undefined && tipo.vence) {
    const f = String(b.vence_el || '').trim();
    if (!FECHA.test(f)) return res.status(400).json({ error: 'Indique una fecha de vencimiento válida' });
    if (f !== doc.vence_el) {
      Object.assign(cambios, { vence_el: f, aviso_por_vencer_el: null, aviso_vencido_el: null });
      detalle.push(`vencimiento ${doc.vence_el ?? 'sin fecha'} → ${f}`);
    }
  }
  if (!detalle.length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const row = await q(supa.from('documentos').update({ ...cambios, actualizado_el: new Date().toISOString() })
    .eq('id', doc.id).select('*').single());
  await audit(req.user.name, req.user.role, 'Corrigió datos de documento', `${doc.folio} · ${detalle.join(' · ')}`);
  res.json(row);
}));

// Anulación: el documento deja de contar como vigente pero sus versiones y
// archivos se conservan. No hay borrado: el repositorio es la evidencia.
r.post('/documentos/:id/anular', auth('coordinador'), ah(async (req, res) => {
  if (!tiene.documentos) return sinTabla(res);
  const v = await docVisible(req, res);
  if (!v) return;
  const { doc, tipo } = v;
  if (doc.estado !== 'vigente') return res.status(409).json({ error: 'El documento ya está anulado' });
  const motivo = String(req.body?.motivo || '').trim();
  if (!motivo) return res.status(400).json({ error: 'Indique el motivo de la anulación' });
  const row = await q(supa.from('documentos').update({
    estado: 'anulado', anulado_motivo: motivo, anulado_por: req.user.name,
    anulado_el: new Date().toISOString(), actualizado_el: new Date().toISOString(),
  }).eq('id', doc.id).select('*').single());
  await audit(req.user.name, req.user.role, 'Anuló documento', `${doc.folio} · ${tipo.nombre} · ${motivo}`);
  res.json(row);
}));

export default r;
