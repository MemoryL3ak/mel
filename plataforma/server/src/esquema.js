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
};

// Qué migración aporta cada función, para que el aviso diga cuál falta correr.
const ORIGEN = {
  guia_mel: '0003_ep_contrato.sql', ep_contrato: '0003_ep_contrato.sql',
  descuentos: '0003_ep_contrato.sql', contrato: '0003_ep_contrato.sql',
  transporte: '0004_operacion.sql', pesaje: '0004_operacion.sql',
  anulacion: '0004_operacion.sql', usd: '0004_operacion.sql', desc_item: '0004_operacion.sql',
  tm: '0005_precio_tm.sql',
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
