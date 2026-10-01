// Detección de las migraciones aplicadas.
//
// Las migraciones de Supabase se aplican a mano en el SQL Editor, mientras la
// aplicación se despliega automáticamente con cada push. Para que un despliegue
// nunca quede roto esperando que alguien ejecute el SQL, el servidor comprueba
// al arrancar qué columnas y tablas existen y omite las funciones que aún no
// tienen respaldo en la base, en vez de fallar al guardar.
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
};

const existe = async (tabla, columnas) => {
  const { error } = await supa.from(tabla).select(columnas).limit(1);
  return !error;
};

export async function detectarEsquema() {
  tiene.guia_mel = await existe('despachos', 'guia_mel');
  tiene.ep_contrato = await existe('estados_pago', 'numero,revision,desde,hasta,presentado_el,anticipo,no_afecto_iva,descuentos');
  tiene.descuentos = await existe('ep_descuentos', 'id');
  tiene.contrato = await existe('contrato', 'id');

  tiene.transporte = await existe('despachos', 'transportista,transportista_rut,patente_tracto,patente_rampla');
  tiene.pesaje = await existe('despachos', 'ticket_numero,vale_numero,tara_kg');
  tiene.anulacion = await existe('despachos', 'anulada_el,anulada_por,motivo_anulacion,reemplazada_por');
  tiene.usd = (await existe('precios', 'precio_usd'))
    && (await existe('despachos', 'precio_usd,dolar,valor_usd'))
    && (await existe('dolar', 'fecha,valor'));
  tiene.desc_item = await existe('despacho_descuentos', 'id');

  tiene.tm = (await existe('precios', 'precio_usd_tm,precio_usd_tm_madera'))
    && (await existe('despachos', 'con_madera,precio_usd_tm'));

  tiene.tara_origen = await existe('despachos', 'tara_origen_kg');
  tiene.cdf_doc = await existe('traslados', 'cert_fotos');
  tiene.cuad_doble = await existe('cuadraturas', 'confirmada_por,confirmada_el');
  // El folio interno se renombró de 'GD' a 'CI'. Se detecta por la existencia
  // del tipo 'CI' en la tabla folios; si no está, se sigue emitiendo 'GD'.
  try {
    const { data } = await supa.from('folios').select('tipo').eq('tipo', 'CI').limit(1);
    tiene.codigo_interno = !!data?.length;
  } catch { tiene.codigo_interno = false; }

  tiene.obsoletos = (await existe('componentes', 'id,codigo,estado'))
    && (await existe('publicaciones', 'id,componente_id,estado'))
    && (await existe('ofertas', 'id,publicacion_id,comprador_id'))
    && (await existe('adjudicaciones', 'id,cert_folio'));

  // El memo solo tiene sentido con la Fase 2 aplicada: sin componentes que
  // respaldar, la tabla existe pero no hay de dónde colgarla.
  tiene.memos = tiene.obsoletos
    && (await existe('memos', 'id,folio,area_usuaria'))
    && (await existe('componentes', 'memo_id,nota_terreno'));

  // El puente a Fase 1: sin estas columnas el obsoleto no vendido se marca
  // chatarra pero no puede derivarse al programa de limpieza.
  tiene.chatarra_obs = tiene.obsoletos
    && (await existe('componentes', 'programa_id,patio_id,categoria_id,peso_estimado_kg,chatarra_el'));

  tiene.cantidades = tiene.obsoletos
    && (await existe('componentes', 'cant_comprometida,cant_encontrada,cant_enviada,cant_recibida'));
  tiene.plazo_ampliable = tiene.obsoletos && (await existe('publicaciones', 'plazo_ampliado_dias'));
  tiene.ofertas_moneda = tiene.obsoletos && (await existe('ofertas', 'moneda,monto_usd,dolar'));
  tiene.ofertas_solicitante = tiene.obsoletos
    && (await existe('ofertas', 'solicitante_tipo,solicitante_nombre,solicitante_rut,empresa_rut'));
  tiene.user_email = await existe('users', 'email');

  tiene.edp_respaldo  = await existe('ep_descuentos', 'respaldos');
  tiene.edp_acumulado = await existe('estados_pago', 'acumulado_manual,acumulado_nota');

  const faltan = Object.entries(tiene).filter(([, ok]) => !ok).map(([k]) => k);
  if (faltan.length) {
    const archivos = [...new Set(faltan.map((k) => ORIGEN[k]))].sort();
    console.warn(
      `[GEA] Falta aplicar en la base: ${archivos.map((a) => `db/${a}`).join(', ')}\n` +
      `      Sin: ${faltan.join(', ')}. La plataforma opera sin esas funciones hasta que se ejecute.`
    );
  }
  return tiene;
}
