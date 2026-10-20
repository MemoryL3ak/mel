// Detección de las migraciones aplicadas.
//
// Las migraciones de Supabase se aplican a mano en el SQL Editor, mientras la
// aplicación se despliega automáticamente con cada push. Para que un despliegue
// nunca quede roto esperando que alguien ejecute el SQL, el servidor comprueba
// al arrancar qué columnas y tablas existen y omite las funciones que aún no
// tienen respaldo en la base, en vez de fallar al guardar. Mientras falte
// alguna, lo vuelve a comprobar cada pocos minutos (vigilarMigraciones).
import { supa } from './supa.js';

export const tiene = {
  // db/0003_ep_contrato.sql
  guia_mel: false,     // despachos.guia_mel
  ep_contrato: false,  // estados_pago: numero, revision, desde, hasta, ...
  descuentos: false,   // tabla ep_descuentos
  contrato: false,     // tabla contrato
  // db/0004_operacion.sql
  transporte: false,   // despachos: transportista, rut, patentes
  pesaje: false,       // despachos: ticket_numero, vale_numero, tara_kg
  anulacion: false,    // despachos: anulada_el, motivo, reemplazada_por
  usd: false,          // precios.precio_usd, despachos.precio_usd/dolar, tabla dolar
  desc_item: false,    // tabla despacho_descuentos
  // db/0005_precio_tm.sql
  tm: false,           // precios.precio_usd_tm(+_madera), despachos.con_madera/precio_usd_tm
  // db/0006_review.sql
  tara_origen: false,    // despachos.tara_origen_kg
  cdf_doc: false,        // traslados.cert_fotos
  cuad_doble: false,     // cuadraturas.confirmada_por, confirmada_el
  codigo_interno: false, // folios: el tipo 'GD' se renombró a 'CI'
  // db/0007_obsoletos.sql
  obsoletos: false,      // Fase 2: componentes, publicaciones, ofertas, adjudicaciones
  // db/0008_memos.sql
  memos: false,          // tabla memos + componentes.memo_id/nota_terreno
  // db/0009_chatarra.sql
  chatarra_obs: false,   // componentes.programa_id/patio_id/categoria_id/peso_estimado_kg
  // db/0010_ofertas.sql
  cantidades: false,          // componentes.cant_comprometida/encontrada/enviada/recibida
  plazo_ampliable: false,     // publicaciones.plazo_ampliado_dias
  ofertas_moneda: false,      // ofertas.moneda/monto_usd/dolar
  ofertas_solicitante: false, // ofertas.solicitante_* y empresa_*
  user_email: false,          // users.email (aviso de ofertas al equipo)
  // db/0011_edp.sql
  edp_respaldo: false,        // ep_descuentos.respaldos
  edp_acumulado: false,       // estados_pago.acumulado_manual/acumulado_nota
  // db/0012_clave.sql
  clave_inicial: false,       // users.clave_inicial
  // db/0013_fase2_obs.sql
  acta_entrega: false,        // adjudicaciones.entrega_docs
  desp_componente: false,     // despachos.componente_id
  // db/0014_despacho_obs.sql
  desp_obs: false,            // despachos.observacion
  // db/0015_documental.sql
  documentos: false,          // Fase 3: doc_tipos, documentos, documento_versiones
  // db/0017_planilla_materiales.sql
  planilla: false,            // componentes: valor SAP en pesos, área, planta, estado de la planilla…
};

// Qué migración aporta cada función, para que el aviso diga cuál falta correr.
const ORIGEN = {
  guia_mel: '0003_ep_contrato.sql', ep_contrato: '0003_ep_contrato.sql',
  descuentos: '0003_ep_contrato.sql', contrato: '0003_ep_contrato.sql',
  transporte: '0004_operacion.sql', pesaje: '0004_operacion.sql',
  anulacion: '0004_operacion.sql', usd: '0004_operacion.sql', desc_item: '0004_operacion.sql',
  tm: '0005_precio_tm.sql',
  tara_origen: '0006_review.sql', cdf_doc: '0006_review.sql',
  cuad_doble: '0006_review.sql', codigo_interno: '0006_review.sql',
  obsoletos: '0007_obsoletos.sql',
  memos: '0008_memos.sql',
  chatarra_obs: '0009_chatarra.sql',
  cantidades: '0010_ofertas.sql', plazo_ampliable: '0010_ofertas.sql',
  ofertas_moneda: '0010_ofertas.sql', ofertas_solicitante: '0010_ofertas.sql',
  user_email: '0010_ofertas.sql',
  edp_respaldo: '0011_edp.sql', edp_acumulado: '0011_edp.sql',
  clave_inicial: '0012_clave.sql',
  acta_entrega: '0013_fase2_obs.sql', desp_componente: '0013_fase2_obs.sql',
  desp_obs: '0014_despacho_obs.sql',
  documentos: '0015_documental.sql',
  planilla: '0017_planilla_materiales.sql',
};

const existe = async (tabla, columnas) => {
  const { error } = await supa.from(tabla).select(columnas).limit(1);
  return !error;
};

// Revisa la base y devuelve qué funciones tienen respaldo, sin tocar `tiene`.
async function revisar() {
  const t = {};
  t.guia_mel = await existe('despachos', 'guia_mel');
  t.ep_contrato = await existe('estados_pago', 'numero,revision,desde,hasta,presentado_el,anticipo,no_afecto_iva,descuentos');
  t.descuentos = await existe('ep_descuentos', 'id');
  t.contrato = await existe('contrato', 'id');

  t.transporte = await existe('despachos', 'transportista,transportista_rut,patente_tracto,patente_rampla');
  t.pesaje = await existe('despachos', 'ticket_numero,vale_numero,tara_kg');
  t.anulacion = await existe('despachos', 'anulada_el,anulada_por,motivo_anulacion,reemplazada_por');
  t.usd = (await existe('precios', 'precio_usd'))
    && (await existe('despachos', 'precio_usd,dolar,valor_usd'))
    && (await existe('dolar', 'fecha,valor'));
  t.desc_item = await existe('despacho_descuentos', 'id');

  t.tm = (await existe('precios', 'precio_usd_tm,precio_usd_tm_madera'))
    && (await existe('despachos', 'con_madera,precio_usd_tm'));

  t.tara_origen = await existe('despachos', 'tara_origen_kg');
  t.cdf_doc = await existe('traslados', 'cert_fotos');
  t.cuad_doble = await existe('cuadraturas', 'confirmada_por,confirmada_el');
  // El folio interno se renombró de 'GD' a 'CI'. Se detecta por la existencia
  // del tipo 'CI' en la tabla folios; si no está, se sigue emitiendo 'GD'.
  try {
    const { data } = await supa.from('folios').select('tipo').eq('tipo', 'CI').limit(1);
    t.codigo_interno = !!data?.length;
  } catch { t.codigo_interno = false; }

  t.obsoletos = (await existe('componentes', 'id,codigo,estado'))
    && (await existe('publicaciones', 'id,componente_id,estado'))
    && (await existe('ofertas', 'id,publicacion_id,comprador_id'))
    && (await existe('adjudicaciones', 'id,cert_folio'));

  // El memo solo tiene sentido con la Fase 2 aplicada: sin componentes que
  // respaldar, la tabla existe pero no hay de dónde colgarla.
  t.memos = t.obsoletos
    && (await existe('memos', 'id,folio,area_usuaria'))
    && (await existe('componentes', 'memo_id,nota_terreno'));

  // El puente a Fase 1: sin estas columnas el obsoleto no vendido se marca
  // chatarra pero no puede derivarse al programa de limpieza.
  t.chatarra_obs = t.obsoletos
    && (await existe('componentes', 'programa_id,patio_id,categoria_id,peso_estimado_kg,chatarra_el'));

  t.cantidades = t.obsoletos
    && (await existe('componentes', 'cant_comprometida,cant_encontrada,cant_enviada,cant_recibida'));
  t.plazo_ampliable = t.obsoletos && (await existe('publicaciones', 'plazo_ampliado_dias'));
  t.ofertas_moneda = t.obsoletos && (await existe('ofertas', 'moneda,monto_usd,dolar'));
  t.ofertas_solicitante = t.obsoletos
    && (await existe('ofertas', 'solicitante_tipo,solicitante_nombre,solicitante_rut,empresa_rut'));
  t.user_email = await existe('users', 'email');

  t.edp_respaldo  = await existe('ep_descuentos', 'respaldos');
  t.edp_acumulado = await existe('estados_pago', 'acumulado_manual,acumulado_nota');
  t.clave_inicial = await existe('users', 'clave_inicial');

  t.acta_entrega    = t.obsoletos && (await existe('adjudicaciones', 'entrega_docs'));
  t.desp_componente = t.obsoletos && (await existe('despachos', 'componente_id'));
  t.desp_obs        = await existe('despachos', 'observacion');

  t.planilla = t.obsoletos && (await existe('componentes',
    'precio_unitario_clp,monto_clp,area,subarea,planta,estado_planilla,cant_no_encontrada,guias_gd,importado_el'));

  t.documentos = (await existe('doc_tipos', 'codigo,hito,roles_carga,roles_ver,exigible_en'))
    && (await existe('documentos', 'id,folio,tipo,ref_id,vence_el,aviso_por_vencer_el'))
    && (await existe('documento_versiones', 'id,documento_id,version,archivos'));

  return t;
}

const avisarFaltantes = () => {
  const faltan = Object.entries(tiene).filter(([, ok]) => !ok).map(([k]) => k);
  if (faltan.length) {
    const archivos = [...new Set(faltan.map((k) => ORIGEN[k]))].sort();
    console.warn(
      `[GEA] Falta aplicar en la base: ${archivos.map((a) => `db/${a}`).join(', ')}\n` +
      `      Sin: ${faltan.join(', ')}. La plataforma opera sin esas funciones hasta que se ejecute.`
    );
  }
};

export async function detectarEsquema() {
  Object.assign(tiene, await revisar());
  avisarFaltantes();
  return tiene;
}

// Una migración se aplica a mano con el servidor ya encendido, y antes solo se
// detectaba al arrancar: había que reiniciar el servicio para que la función
// nueva apareciera. Mientras falte alguna, se vuelve a revisar cada pocos
// minutos. Esta pasada solo ENCIENDE funciones: un error de red pasajero no
// debe apagar una que ya estaba operando. Devuelve las que se activaron.
export async function revisarMigraciones() {
  const pendientes = Object.keys(tiene).filter((k) => !tiene[k]);
  if (!pendientes.length) return [];
  const t = await revisar();
  const activadas = pendientes.filter((k) => t[k]);
  for (const k of activadas) tiene[k] = true;
  if (activadas.length) {
    const archivos = [...new Set(activadas.map((k) => ORIGEN[k]))].sort();
    console.log(`[GEA] Migración aplicada detectada: ${archivos.map((x) => `db/${x}`).join(', ')}. ` +
      `Activo sin reiniciar: ${activadas.join(', ')}.`);
  }
  return activadas;
}

export function vigilarMigraciones(cadaMs = 5 * 60 * 1000) {
  const t = setInterval(async () => {
    if (Object.values(tiene).every(Boolean)) { clearInterval(t); return; }
    await revisarMigraciones().catch((e) => console.error('[GEA] esquema:', e.message));
  }, cadaMs);
  if (typeof t.unref === 'function') t.unref();
}
