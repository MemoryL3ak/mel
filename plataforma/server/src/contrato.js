// Datos del contrato: encabezado y firmas del estado de pago, IVA, día de
// corte del período y vigencia de la tabla de precios.
//
// La tabla `contrato` llega con la migración 0003. Mientras no esté aplicada
// se opera con estos valores por defecto en lugar de caer, para que la
// plataforma siga funcionando durante la actualización.
import { supa, hoy } from './supa.js';

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
  comision_vendor_pct: 0,
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

// Período del estado de pago que contiene una fecha: del día siguiente al
// corte del mes anterior hasta el día de corte de este mes. El EP se nombra por
// el mes en que cierra: con corte el 20, el 21-sep → 20-oct es el EP de octubre.
export function periodoEP(diaCorte = 20, fecha = hoy()) {
  const [a, m, d] = String(fecha).split('-').map(Number);
  const corte = Number(diaCorte) || 20;
  // Pasado el corte, la fecha ya pertenece al período que cierra el mes siguiente.
  const cierre = new Date(Date.UTC(a, m - 1 + (d > corte ? 1 : 0), 1));
  const iso = (x) => x.toISOString().slice(0, 10);
  return {
    periodo: iso(cierre).slice(0, 7),
    desde: iso(new Date(Date.UTC(cierre.getUTCFullYear(), cierre.getUTCMonth() - 1, corte + 1))),
    hasta: iso(new Date(Date.UTC(cierre.getUTCFullYear(), cierre.getUTCMonth(), corte))),
  };
}

// Período que acumulan el panel, los despachos y los indicadores: el del EP en
// curso, salvo que desde el corte el material todavía no se haya movido. En ese
// caso sigue siendo el período recién cerrado, que es el que se está
// valorizando: el día después del corte el panel no puede amanecer en cero.
export async function periodoActivo(diaCorte) {
  const actual = periodoEP(diaCorte);
  const { data } = await supa.from('despachos').select('fecha')
    .not('estado', 'in', '(anulado,pendiente_guia)').order('fecha', { ascending: false }).limit(1).maybeSingle();
  const ultima = data?.fecha;
  const periodo = ultima && ultima < actual.desde ? periodoEP(diaCorte, ultima) : actual;
  return { ...periodo, cerrado: periodo.hasta < hoy() };
}

// Fecha en que vence una vigencia de precio (n meses después de su inicio).
export function venceElPrecio(vigenteDesde, meses) {
  const [a, m, d] = String(vigenteDesde).split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1 + meses, d));
  return f.toISOString().slice(0, 10);
}
