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
  // Tolerancias de la diferencia de pesaje entre MEL y La Negra (0019).
  tol_mel_pct: 3,
  tol_lampa_pct: 5,
};

// Regla del contrato para la diferencia entre el pesaje de MEL (origen) y el
// de La Negra (destino): hasta la tolerancia de MEL rige el peso de MEL; desde
// la tolerancia de Lampa rige el de La Negra; en la franja intermedia no hay
// regla automática y las partes lo acuerdan a mano (queda 'pendiente' hasta
// entonces, valorizando provisionalmente el peso de La Negra). La diferencia
// se mide en valor absoluto sobre el peso de origen.
export function reglaPeso(kgOrigen, kgDestino, cfg = DEFECTO) {
  const o = Number(kgOrigen), d = Number(kgDestino);
  const difPct = o > 0 ? Math.abs((d - o) / o) * 100 : 0;
  const tolMel = Number(cfg?.tol_mel_pct ?? DEFECTO.tol_mel_pct);
  const tolLampa = Number(cfg?.tol_lampa_pct ?? DEFECTO.tol_lampa_pct);
  const dif = Math.round(difPct * 100) / 100;
  if (difPct <= tolMel) {
    return { regla: 'mel', kg: o, dif_pct: dif, texto: `Diferencia de peso ${dif.toFixed(2)}% (hasta ${tolMel}%): rige el peso MEL según contrato` };
  }
  if (difPct < tolLampa) {
    return { regla: 'pendiente', kg: d, dif_pct: dif, texto: `Diferencia de peso ${dif.toFixed(2)}% (entre ${tolMel}% y ${tolLampa}%): el peso que rige se acuerda entre MEL y Lampa` };
  }
  return { regla: 'lampa', kg: d, dif_pct: dif, texto: `Diferencia de peso ${dif.toFixed(2)}% (${tolLampa}% o más): rige el peso de La Negra según contrato` };
}

// La misma regla cuando La Negra descontó kilos que no son material (madera,
// pallets, cartón). Esos kilos se restan SOLO del pesaje de La Negra: nunca
// del peso de MEL ni de un peso acordado, y nunca se valorizan.
//
// En terreno el descuento se usa de dos maneras, y la regla tiene que servir
// para las dos sin que nadie la intervenga a mano:
//   · La Negra pesa más que la guía de MEL y la diferencia es la madera: al
//     quitarla, los dos pesos calzan. No hay diferencia que acordar.
//   · Los dos pesajes calzan y La Negra descuenta la madera que venía dentro:
//     tampoco hay diferencia de pesaje, y lo que se valoriza es el neto.
// Por eso la diferencia se mide contra el pesaje de La Negra con y sin la
// madera, y manda la comparación que deja menos diferencia. El peso que se
// valoriza es el neto de La Negra; si rige MEL, el menor entre el peso de MEL y
// ese neto, para que la madera no entre por el lado de MEL.
export function reglaPesoNeto(kgOrigen, kgDestino, kgDescontados = 0, cfg = DEFECTO) {
  const o = Number(kgOrigen), d = Number(kgDestino);
  const w = Math.max(Number(kgDescontados) || 0, 0);
  const bruta = reglaPeso(o, d, cfg);
  if (!(w > 0)) return { ...bruta, kg_neto: d, kg_descontados: 0, kg_comparado: d };
  const neto = Math.max(d - w, 0);
  const conNeto = reglaPeso(o, neto, cfg);
  const usaNeto = Math.abs(neto - o) <= Math.abs(d - o);
  const r = usaNeto ? conNeto : bruta;
  const kg = r.regla === 'mel' ? Math.min(o, neto) : neto;
  const tolMel = Number(cfg?.tol_mel_pct ?? DEFECTO.tol_mel_pct);
  const tolLampa = Number(cfg?.tol_lampa_pct ?? DEFECTO.tol_lampa_pct);
  const sin = `descontados ${w} kg que no son material`;
  const texto = r.regla === 'mel'
    ? `Diferencia de peso ${r.dif_pct.toFixed(2)}% (hasta ${tolMel}%, ${sin}): se valorizan ${kg} kg`
    : r.regla === 'pendiente'
      ? `Diferencia de peso ${r.dif_pct.toFixed(2)}% (entre ${tolMel}% y ${tolLampa}%, ${sin}): el peso que rige se acuerda entre MEL y Lampa`
      : `Diferencia de peso ${r.dif_pct.toFixed(2)}% (${tolLampa}% o más, ${sin}): rige el peso de La Negra sin esos kilos`;
  return { regla: r.regla, kg, dif_pct: r.dif_pct, texto, kg_neto: neto, kg_descontados: w, kg_comparado: usaNeto ? neto : d };
}

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

// ---- Semana de cuadratura ----
// El EDP corta el día de corte caiga donde caiga, pero la semana ISO va de
// lunes a domingo: cuando el corte cae a mitad de semana, la cuadratura de esa
// semana se llevaba días que ya son del EDP siguiente (el 20-nov-2026 fue
// viernes y la semana 47 sumaba el sábado 21 y el domingo 22). Por eso la
// semana del corte termina ese día, y los días que le siguen pasan a la semana
// siguiente, que es la primera del EDP nuevo. Así las semanas de un EDP suman
// exactamente su período. Rige desde la semana 47 de 2026: las anteriores ya
// se cerraron de lunes a domingo y no se tocan.
const CORTE_SEMANAL_DESDE = '2026-11-16';

const masDias = (iso, n) => {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

// Día de corte que cae dentro de una semana (lunes a domingo) antes de su
// domingo, o null: si corta en domingo la semana ya termina con el EDP.
function cortePartido(base, diaCorte) {
  if (base.desde < CORTE_SEMANAL_DESDE) return null;
  const corte = periodoEP(diaCorte, base.desde).hasta;
  return corte < base.hasta ? corte : null;
}

// Rango de fechas que cuadra una semana. `corte`: día en que la semana termina
// antes de su domingo; `arrastra`: corte de la semana anterior, cuyos días
// restantes entran en esta.
export function rangoSemanaCorte(anio, semana, diaCorte = 20) {
  const base = rangoSemanaISO(anio, semana);
  const previa = { desde: masDias(base.desde, -7), hasta: masDias(base.desde, -1) };
  const corte = cortePartido(base, diaCorte), arrastra = cortePartido(previa, diaCorte);
  return { desde: arrastra ? masDias(arrastra, 1) : base.desde, hasta: corte ?? base.hasta, corte, arrastra };
}

// Semana en cuya cuadratura cae una fecha 'AAAA-MM-DD'.
export function semanaCorteDeFecha(iso, diaCorte = 20) {
  const s = semanaDeFecha(iso);
  const base = rangoSemanaISO(s.anio, s.semana);
  const corte = cortePartido(base, diaCorte);
  return corte && iso > corte ? semanaDeFecha(masDias(base.hasta, 1)) : s;
}

// Un período con su N° de EDP y las semanas en que parte y en que corta.
function conSemanas(p, eps, diaCorte) {
  const ini = semanaCorteDeFecha(p.desde, diaCorte), fin = semanaDeFecha(p.hasta);
  return {
    ...p, numero: numeroDelPeriodo(p.periodo, eps),
    semana_inicio: ini, semana_fin: fin,
    semanas: Math.round((lunesDe(fin) - lunesDe(ini)) / MS_SEMANA) + 1,
  };
}

export async function periodoConSemanas(p, diaCorte) {
  return conSemanas(p, await numerosEP(), diaCorte);
}

// A qué EDP pertenece una semana y cuál es su lugar dentro de él. En el
// programa la semana va de lunes a domingo, y la del corte pertenece a dos
// EDP: hasta el día de corte cierra uno y desde el día siguiente parte el
// otro. En la cuadratura (`cuadratura: true`) la semana ya viene cortada en el
// día de cierre, así que cae entera en un solo EDP; `cierra` y `arrastra`
// dicen si terminó antes del domingo o si trae días de la semana anterior.
export async function epDeSemana(anio, semana, diaCorte, { cuadratura = false } = {}) {
  const eps = await numerosEP();
  const rango = cuadratura ? rangoSemanaCorte(anio, semana, diaCorte) : rangoSemanaISO(anio, semana);
  const { desde, hasta } = rango;
  const a = periodoEP(diaCorte, desde), b = periodoEP(diaCorte, hasta);
  const tramo = (p) => {
    const t = conSemanas(p, eps, diaCorte);
    return { ...t, semana_n: Math.round((lunesDe({ anio, semana }) - lunesDe(t.semana_inicio)) / MS_SEMANA) + 1 };
  };
  const mismo = a.periodo === b.periodo;
  return {
    desde, hasta, tramos: mismo ? [tramo(a)] : [tramo(a), tramo(b)], corte: mismo ? null : a.hasta,
    cierra: rango.corte ?? null, arrastra: rango.arrastra ?? null,
  };
}
