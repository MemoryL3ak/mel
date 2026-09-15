// Detección de las migraciones aplicadas.
//
// Las migraciones de Supabase se aplican a mano en el SQL Editor, mientras la
// aplicación se despliega automáticamente con cada push. Para que un despliegue
// nunca quede roto esperando que alguien ejecute el SQL, el servidor comprueba
// al arrancar qué columnas y tablas existen y omite las funciones que aún no
// tienen respaldo en la base, en vez de fallar al guardar.
import { supa } from './supa.js';

export const tiene = {
  guia_mel: false,     // despachos.guia_mel
  ep_contrato: false,  // estados_pago: numero, revision, desde, hasta, ...
  descuentos: false,   // tabla ep_descuentos
  contrato: false,     // tabla contrato
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

  const faltan = Object.entries(tiene).filter(([, ok]) => !ok).map(([k]) => k);
  if (faltan.length) {
    console.warn(
      `[GEA] Falta aplicar db/0003_ep_contrato.sql en la base (sin: ${faltan.join(', ')}).\n` +
      `      La plataforma opera sin esas funciones hasta que se ejecute.`
    );
  }
  return tiene;
}
