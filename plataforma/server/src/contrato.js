// Datos del contrato: encabezado y firmas del estado de pago, IVA, día de
// corte del período y vigencia de la tabla de precios.
//
// La tabla `contrato` llega con la migración 0003. Mientras no esté aplicada
// se opera con estos valores por defecto en lugar de caer, para que la
// plataforma siga funcionando durante la actualización.
import { supa, q, hoy, semanaDeFecha, rangoSemanaISO } from './supa.js';

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

// ---- Semanas ISO y estados de pago ----
// El programa, la cuadratura y las cuadrillas hablan en semanas; el contrato
// cobra por período de EP (del 21 al 20). Con el correr de las semanas se
// pierde la cuenta de en qué EDP se va: esto traduce de un lado al otro.

const MS_SEMANA = 7 * 86400000;
const lunesDe = ({ anio, semana }) => Date.parse(rangoSemanaISO(anio, semana).desde);

// N° del EDP de un período: el que tiene si ya se generó; si no, se proyecta
// desde el último numerado, uno por mes, porque el correlativo es mensual.
function numeroDelPeriodo(periodo, eps) {
  const propio = eps.find((e) => e.periodo === periodo && e.numero != null);
  if (propio) return Number(propio.numero);
  const base = eps.filter((e) => e.numero != null).sort((a, b) => (a.periodo < b.periodo ? 1 : -1))[0];
  if (!base) return null;
  const mes = (p) => { const [a, m] = p.split('-').map(Number); return a * 12 + m; };
  const n = Number(base.numero) + mes(periodo) - mes(base.periodo);
  return n >= 1 ? n : null;
}

async function numerosEP() {
  try { return await q(supa.from('estados_pago').select('periodo, numero')); } catch { return []; }
}

// Un período con su N° de EDP y las semanas ISO en que parte y en que corta.
function conSemanas(p, eps) {
  const ini = semanaDeFecha(p.desde), fin = semanaDeFecha(p.hasta);
  return {
    ...p, numero: numeroDelPeriodo(p.periodo, eps),
    semana_inicio: ini, semana_fin: fin,
    semanas: Math.round((lunesDe(fin) - lunesDe(ini)) / MS_SEMANA) + 1,
  };
}

export async function periodoConSemanas(p) {
  return conSemanas(p, await numerosEP());
}

// A qué EDP pertenece una semana ISO y cuál es su lugar dentro de él. La
// semana del corte pertenece a dos: hasta el día de corte cierra un EDP y
// desde el día siguiente parte el otro.
export async function epDeSemana(anio, semana, diaCorte) {
  const eps = await numerosEP();
  const { desde, hasta } = rangoSemanaISO(anio, semana);
  const a = periodoEP(diaCorte, desde), b = periodoEP(diaCorte, hasta);
  const tramo = (p) => {
    const t = conSemanas(p, eps);
    return { ...t, semana_n: Math.round((Date.parse(desde) - lunesDe(t.semana_inicio)) / MS_SEMANA) + 1 };
  };
  const mismo = a.periodo === b.periodo;
  return { desde, hasta, tramos: mismo ? [tramo(a)] : [tramo(a), tramo(b)], corte: mismo ? null : a.hasta };
}
