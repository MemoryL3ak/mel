// Datos del contrato: encabezado y firmas del estado de pago, IVA, día de
// corte del período y vigencia de la tabla de precios.
//
// La tabla `contrato` llega con la migración 0003. Mientras no esté aplicada
// se opera con estos valores por defecto en lugar de caer, para que la
// plataforma siga funcionando durante la actualización.
import { supa } from './supa.js';

const DEFECTO = {
  numero: null,
  gerencia: 'GERENCIA W&L',
  glosa: 'ADJUDICACIÓN LICITACIÓN DE CHATARRA',
  mandante: 'MINERA ESCONDIDA LIMITADA',
  contratista: '',
  firma_mandante: '',
  firma_contratista: '',
  monto_original: 0,
  modificaciones: 0,
  iva_pct: 19,
  dia_corte: 20,
  meses_vigencia_precio: 3,
};

let cache = null;
let cacheAt = 0;

export async function contrato() {
  if (cache && Date.now() - cacheAt < 60_000) return cache;
  const { data, error } = await supa.from('contrato').select('*').eq('id', 1).maybeSingle();
  cache = error || !data ? { ...DEFECTO } : { ...DEFECTO, ...data };
  cacheAt = Date.now();
  return cache;
}

export const olvidarContrato = () => { cache = null; cacheAt = 0; };

// Fecha en que vence una vigencia de precio (n meses después de su inicio).
export function venceElPrecio(vigenteDesde, meses) {
  const [a, m, d] = String(vigenteDesde).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1 + meses, d));
  return f.toISOString().slice(0, 10);
}
