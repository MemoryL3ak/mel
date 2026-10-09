// Fase 3 · Repositorio documental: lo que comparten la pantalla del repositorio,
// el panel, el barrido de vencimientos y los flujos que ya adjuntaban archivos.
//
// Un documento siempre respalda un HITO del proceso (una guía, un traslado, un
// estado de pago, una adjudicación…). El catálogo de hitos de este archivo dice
// cómo se llama cada uno, qué estados tiene y cómo se listan sus entidades para
// elegir a cuál se vincula un documento.
import { supa, q, folio, hoy } from './supa.js';
import { tiene } from './esquema.js';

export const BUCKET = 'documentos';

// Formatos que acepta el repositorio. Los contratos y actas suelen venir en
// Word; los registros de descuentos y ofertas, en planilla.
export const MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const lim = 500;
const seguro = async (fn) => { try { return await fn(); } catch { return []; } };

// Cada hito: nombre visible, estados posibles (para la regla de exigibilidad)
// y cómo se listan sus entidades. `ids` acota la consulta cuando solo se
// necesitan algunas (p. ej. para rotular documentos ya cargados).
export const HITOS = {
  contrato: {
    nombre: 'Contrato',
    estados: { vigente: 'Vigente' },
    listar: async () => {
      if (!tiene.contrato) return [];
      const c = await q(supa.from('contrato').select('id, numero').eq('id', 1).maybeSingle());
      return [{ id: 1, label: c?.numero ? `Contrato N° ${c.numero}` : 'Contrato vigente', estado: 'vigente' }];
    },
  },
  despacho: {
    nombre: 'Despacho a La Negra',
    estados: { en_transito: 'En tránsito', recepcionado: 'Recepcionado', observado: 'Observado', anulado: 'Anulado' },
    listar: (ids) => seguro(async () => {
      let b = supa.from('despachos').select(`id, guia, fecha, estado${tiene.guia_mel ? ', guia_mel' : ''}`)
        .order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((d) => ({
        id: d.id, estado: d.estado, fecha: d.fecha,
        label: `${d.guia}${d.guia_mel ? ` · GD MEL ${d.guia_mel}` : ''} · ${d.fecha}`,
      }));
    }),
  },
  traslado: {
    nombre: 'Traslado a Lampa',
    estados: { en_transito: 'En tránsito', recepcionado: 'Recepcionado' },
    listar: (ids) => seguro(async () => {
      let b = supa.from('traslados').select('id, guia, cert_folio, fecha, estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((t) => ({
        id: t.id, estado: t.estado, fecha: t.fecha,
        label: `${t.guia}${t.cert_folio ? ` · ${t.cert_folio}` : ''} · ${t.fecha}`,
      }));
    }),
  },
  estado_pago: {
    nombre: 'Estado de pago',
    estados: {
      generado: 'Generado', en_revision: 'En revisión', con_ajustes: 'Con ajustes', firmado: 'Firmado',
      facturado: 'Facturado', pagado: 'Pagado', conciliado: 'Conciliado',
    },
    listar: (ids) => seguro(async () => {
      let b = supa.from('estados_pago').select('id, folio, periodo, estado').order('periodo', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((e) => ({ id: e.id, estado: e.estado, label: `${e.folio} · período ${e.periodo}` }));
    }),
  },
  memo: {
    nombre: 'Memo de baja',
    estados: { recibido: 'Recibido', en_identificacion: 'En identificación', cerrado: 'Cerrado' },
    listar: (ids) => seguro(async () => {
      if (!tiene.memos) return [];
      let b = supa.from('memos').select('id, folio, area_usuaria, estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((m) => ({ id: m.id, estado: m.estado, label: `${m.folio} · ${m.area_usuaria}` }));
    }),
  },
  componente: {
    nombre: 'Componente obsoleto',
    estados: {
      por_identificar: 'Por identificar', no_encontrado: 'No encontrado', planificado: 'Confirmado en terreno',
      publicado: 'Publicado', adjudicado: 'Adjudicado', entregado: 'Entregado', chatarra: 'Chatarra',
    },
    listar: (ids) => seguro(async () => {
      if (!tiene.obsoletos) return [];
      let b = supa.from('componentes').select('id, codigo, nombre, estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((c) => ({ id: c.id, estado: c.estado, label: `${c.codigo} · ${c.nombre}` }));
    }),
  },
  comprador: {
    nombre: 'Comprador',
    estados: { pendiente: 'DD pendiente', aprobada: 'DD aprobada', rechazada: 'DD rechazada' },
    listar: (ids) => seguro(async () => {
      if (!tiene.obsoletos) return [];
      let b = supa.from('compradores').select('id, razon_social, rut, dd_estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      return (await q(b)).map((c) => ({ id: c.id, estado: c.dd_estado, label: `${c.razon_social} · ${c.rut}` }));
    }),
  },
  publicacion: {
    nombre: 'Publicación',
    estados: { activa: 'Activa', adjudicada: 'Adjudicada', convertida: 'Convertida a chatarra', cancelada: 'Cancelada' },
    listar: (ids) => seguro(async () => {
      if (!tiene.obsoletos) return [];
      let b = supa.from('publicaciones').select('id, componente_id, publicado_el, estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      const pubs = await q(b);
      const comps = await compsPorId(pubs.map((p) => p.componente_id));
      return pubs.map((p) => ({
        id: p.id, estado: p.estado,
        label: `${comps.get(p.componente_id)?.codigo ?? 'Componente'} · publicada el ${p.publicado_el}`,
      }));
    }),
  },
  adjudicacion: {
    nombre: 'Adjudicación',
    estados: { adjudicada: 'Adjudicada', pagada: 'Pagada', entregada: 'Entregada' },
    listar: (ids) => seguro(async () => {
      if (!tiene.obsoletos) return [];
      let b = supa.from('adjudicaciones').select('id, cert_folio, publicacion_id, estado').order('id', { ascending: false }).limit(lim);
      if (ids) b = b.in('id', ids);
      const adj = await q(b);
      const pubs = adj.length
        ? new Map((await q(supa.from('publicaciones').select('id, componente_id').in('id', adj.map((a) => a.publicacion_id)))).map((p) => [p.id, p]))
        : new Map();
      const comps = await compsPorId([...pubs.values()].map((p) => p.componente_id));
      return adj.map((a) => ({
        id: a.id, estado: a.estado,
        label: `${a.cert_folio} · ${comps.get(pubs.get(a.publicacion_id)?.componente_id)?.codigo ?? 'Componente'}`,
      }));
    }),
  },
};

async function compsPorId(ids) {
  const unicos = [...new Set(ids.filter(Boolean))];
  if (!unicos.length) return new Map();
  return new Map((await q(supa.from('componentes').select('id, codigo, nombre').in('id', unicos))).map((c) => [c.id, c]));
}

// Catálogo para el cliente: nombre y estados de cada hito.
export const catalogoHitos = () =>
  Object.fromEntries(Object.entries(HITOS).map(([k, h]) => [k, { nombre: h.nombre, estados: h.estados }]));

export const tiposDe = async () => q(supa.from('doc_tipos').select('*').order('orden'));

// Lo que un rol puede ver y lo que puede cargar, según el catálogo.
export const puedeVer = (t, rol) => rol === 'coordinador' || t.roles_carga.includes(rol) || t.roles_ver.includes(rol);
export const puedeCargar = (t, rol) => t.roles_carga.includes(rol);

// Días que faltan para una fecha (negativo si ya pasó). Mediodía para que el
// cambio de horario no corra el resultado un día.
export const diasHasta = (fecha) =>
  Math.round((new Date(fecha + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000);

// Situación del vencimiento de un documento.
//   no_vence   el tipo no tiene vencimiento
//   sin_fecha  el tipo vence pero el documento no declara fecha (cargas antiguas)
//   vigente / por_vencer / vencido
export function vencimiento(doc, tipo) {
  if (!doc.vence_el) return { clave: tipo?.vence ? 'sin_fecha' : 'no_vence', dias: null };
  const dias = diasHasta(doc.vence_el);
  if (dias < 0) return { clave: 'vencido', dias };
  if (dias <= (tipo?.aviso_dias ?? 30)) return { clave: 'por_vencer', dias };
  return { clave: 'vigente', dias };
}

// Rótulo de cada entidad referida por un conjunto de documentos, por hito.
export async function rotulos(docs) {
  const porHito = new Map();
  for (const d of docs) {
    if (!porHito.has(d.hito)) porHito.set(d.hito, new Set());
    porHito.get(d.hito).add(d.ref_id);
  }
  const out = new Map();
  await Promise.all([...porHito].map(async ([hito, ids]) => {
    const ents = HITOS[hito] ? await HITOS[hito].listar([...ids]) : [];
    for (const e of ents) out.set(`${hito}:${e.id}`, e);
  }));
  return out;
}

// Documentos que faltan: entidades cuyo estado ya exige un tipo documental y
// que no tienen ningún documento vigente de ese tipo.
export async function faltantes(rol) {
  if (!tiene.documentos) return [];
  const tipos = (await tiposDe()).filter((t) => t.activo && t.exigible_en?.length && puedeVer(t, rol));
  if (!tipos.length) return [];
  const hitos = [...new Set(tipos.map((t) => t.hito))];
  const [entidades, docs] = await Promise.all([
    Promise.all(hitos.map(async (h) => [h, await HITOS[h].listar()])).then((xs) => new Map(xs)),
    q(supa.from('documentos').select('tipo, ref_id').eq('estado', 'vigente').in('tipo', tipos.map((t) => t.codigo))),
  ]);
  const hay = new Set(docs.map((d) => `${d.tipo}:${d.ref_id}`));
  const out = [];
  for (const t of tipos) {
    for (const e of entidades.get(t.hito) ?? []) {
      if (!t.exigible_en.includes(e.estado) || hay.has(`${t.codigo}:${e.id}`)) continue;
      out.push({
        tipo: t.codigo, tipo_nombre: t.nombre, proceso: t.proceso, hito: t.hito,
        ref_id: e.id, ref_label: e.label, estado: e.estado,
        estado_nombre: HITOS[t.hito].estados[e.estado] ?? e.estado,
        responsable: t.responsable, puede_cargar: puedeCargar(t, rol),
      });
    }
  }
  return out;
}

// Registra en el repositorio archivos que otro flujo ya subió (la guía al
// despachar, el CDF al recepcionar en Lampa, el acta de entrega…). Si el hito
// ya tiene un documento vigente de ese tipo, se crea una versión nueva con los
// archivos anteriores más los recién llegados: en esos flujos adjuntar en
// varias tandas completa el documento, no lo reemplaza.
// Nunca interrumpe la operación que la llama: como la auditoría, si falla se
// registra en el log y el flujo principal sigue.
export async function registrarArchivos({ tipo, hito, refId, archivos, quien, nota }) {
  if (!tiene.documentos || !archivos?.length) return null;
  try {
    const t = await q(supa.from('doc_tipos').select('*').eq('codigo', tipo).maybeSingle());
    if (!t?.activo) return null;
    const previo = (await q(supa.from('documentos').select('*')
      .eq('tipo', tipo).eq('hito', hito).eq('ref_id', refId).eq('estado', 'vigente')
      .order('id', { ascending: false }).limit(1)))[0];
    if (previo) {
      const ult = await q(supa.from('documento_versiones').select('archivos')
        .eq('documento_id', previo.id).eq('version', previo.version_actual).maybeSingle());
      const version = previo.version_actual + 1;
      await q(supa.from('documento_versiones').insert({
        documento_id: previo.id, version, archivos: [...(ult?.archivos ?? []), ...archivos],
        vence_el: previo.vence_el, nota: nota ?? 'Se agregaron archivos desde el proceso',
        subido_por: quien?.name ?? 'Sistema', subido_rol: quien?.role ?? 'sistema',
      }).select('id').single());
      await q(supa.from('documentos').update({ version_actual: version, actualizado_el: new Date().toISOString() })
        .eq('id', previo.id).select('id').single());
      return previo.id;
    }
    const [ent] = HITOS[hito] ? await HITOS[hito].listar([refId]) : [];
    const doc = await q(supa.from('documentos').insert({
      folio: await folio('DOC'), tipo, hito, ref_id: refId, ref_label: ent?.label ?? null,
      titulo: `${t.nombre} · ${ent?.label ?? `#${refId}`}`,
      creado_por: quien?.name ?? 'Sistema',
    }).select('id').single());
    await q(supa.from('documento_versiones').insert({
      documento_id: doc.id, version: 1, archivos, nota: nota ?? null,
      subido_por: quien?.name ?? 'Sistema', subido_rol: quien?.role ?? 'sistema',
    }).select('id').single());
    return doc.id;
  } catch (e) {
    console.error('[GEA] repositorio documental:', e.message);
    return null;
  }
}
