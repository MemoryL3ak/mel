// Valor del dólar observado, con historia propia.
//
// La valorización del contrato es en USD/kg, así que cada recepción necesita
// el tipo de cambio del día. Se consulta a mindicador.cl (serie del Banco
// Central, sin credenciales; si no responde, a la tabla del SII, que publica
// la misma serie) y se guarda en la tabla `dolar`: esa copia local
// es la que manda después, para que un mismo día siempre valorice igual y para
// que la plataforma siga operando si la API no responde.
import { supa, q, hoy } from './supa.js';
import { tiene } from './esquema.js';

const API = 'https://mindicador.cl/api/dolar';
const TIMEOUT_MS = 6000;
// El Banco Central no publica fines de semana ni feriados, y el valor del día
// en curso aparece recién avanzada la mañana. Con las Fiestas Patrias de por
// medio el hueco puede ser de varios días seguidos.
const DIAS_ATRAS = 10;

// dd-mm-aaaa, que es como mindicador espera la fecha.
const alFormatoApi = (iso) => iso.split('-').reverse().join('-');

// Mediodía UTC: así ningún cambio de huso mueve el día por una hora.
const restarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// Cuando mindicador deja de contestar no se le vuelve a preguntar por un rato:
// cada intento cuesta el timeout completo, y recorrer diez días hacia atrás
// con la API caída serían diez esperas seguidas.
const PAUSA_MINDICADOR_MS = 5 * 60 * 1000;
let mindicadorCaidaHasta = 0;

async function consultarMindicador(fecha) {
  if (Date.now() < mindicadorCaidaHasta) return { alcanzada: false, valor: null };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${alFormatoApi(fecha)}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const v = Number(j?.serie?.[0]?.valor);
    return { alcanzada: true, valor: Number.isFinite(v) && v > 0 ? v : null };
  } catch {
    mindicadorCaidaHasta = Date.now() + PAUSA_MINDICADOR_MS;
    return { alcanzada: false, valor: null };   // la API es una conveniencia, nunca un bloqueo
  } finally {
    clearTimeout(t);
  }
}

// Segunda fuente: la tabla anual del SII, que publica el mismo dólar observado
// del Banco Central. Existe porque mindicador estuvo sin responder días
// enteros (nov-2026) y, sin otra fuente, las recepciones de esos días se
// valorizaron arrastrando el último valor guardado.
const SII = (anio) => `https://www.sii.cl/valores_y_fechas/dolar/dolar${anio}.htm`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Lee la página anual del SII: un bloque por mes (`id='mes_noviembre'`) con
 * celdas día / valor. La página mezcla "977,05" con "992.66", así que se
 * aceptan los dos separadores; un valor fuera de rango se descarta antes que
 * valorizar con una cifra mal leída.
 * @returns {Map<string, number>} fecha ISO → valor
 */
export function leerTablaSii(html, anio) {
  const tabla = new Map();
  MESES.forEach((mes, i) => {
    const ini = html.search(new RegExp(`id=['"]mes_${mes}['"]`, 'i'));
    if (ini < 0) return;
    const fin = html.indexOf('id=\'mes_', ini + 10);
    const fin2 = html.indexOf('id="mes_', ini + 10);
    const corte = [fin, fin2].filter((x) => x > 0).sort((a, b) => a - b)[0];
    const bloque = html.slice(ini, corte);
    for (const c of bloque.matchAll(/<th[^>]*>\s*<strong>\s*(\d{1,2})\s*<\/strong>\s*<\/th>\s*<td[^>]*>([^<]*)<\/td>/gi)) {
      const txt = c[2].trim();
      if (!txt) continue;
      const v = Number(txt.includes(',') ? txt.replace(/\./g, '').replace(',', '.') : txt);
      if (v >= 100 && v <= 5000) {
        tabla.set(`${anio}-${String(i + 1).padStart(2, '0')}-${c[1].padStart(2, '0')}`, v);
      }
    }
  });
  return tabla;
}

// Año completo del SII, o null si no se pudo leer. `fresca` salta la memoria:
// la sincronización periódica quiere ver la publicación de hoy apenas salga.
const paginasSii = new Map();   // año → { en, tabla }
async function tablaSii(anio, { fresca = false } = {}) {
  const memo = paginasSii.get(anio);
  if (!fresca && memo && Date.now() - memo.en < CACHE_MS) return memo.tabla;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 2);
  try {
    const r = await fetch(SII(anio), { signal: ctrl.signal });
    if (!r.ok) return null;
    const tabla = leerTablaSii(await r.text(), anio);
    // Una página sin ningún valor es una página que cambió de formato, no un
    // año sin publicaciones: se trata como fuente caída.
    if (!tabla.size) return null;
    paginasSii.set(anio, { en: Date.now(), tabla });
    return tabla;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function consultarSii(fecha) {
  const tabla = await tablaSii(fecha.slice(0, 4));
  return tabla ? { alcanzada: true, valor: tabla.get(fecha) ?? null } : { alcanzada: false, valor: null };
}

// El mismo año completo, desde mindicador: respaldo de la tabla del SII.
async function tablaMindicador(anio) {
  if (Date.now() < mindicadorCaidaHasta) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS * 2);
  try {
    const r = await fetch(`${API}/${anio}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const tabla = new Map();
    for (const x of j?.serie ?? []) {
      const v = Number(x?.valor);
      const f = String(x?.fecha ?? '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(f) && v >= 100 && v <= 5000) tabla.set(f, v);
    }
    return tabla.size ? tabla : null;
  } catch {
    mindicadorCaidaHasta = Date.now() + PAUSA_MINDICADOR_MS;
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Consulta un día puntual, primero en mindicador y, si no trae valor, en el
 * SII. Distingue los dos "no hay valor" que importan: que la fuente conteste
 * que ese día no tiene publicación, o que no se pueda hablar con ninguna. Lo
 * primero invita a probar el día anterior; lo segundo, a dejar de insistir.
 * @returns {Promise<{alcanzada:boolean, valor:number|null, fuente:string|null}>}
 */
async function consultarApi(fecha) {
  const m = await consultarMindicador(fecha);
  if (m.valor != null) return { ...m, fuente: 'mindicador.cl' };
  const s = await consultarSii(fecha);
  if (s.valor != null) return { ...s, fuente: 'sii.cl' };
  return { alcanzada: m.alcanzada || s.alcanzada, valor: null, fuente: null };
}

const guardar = (fecha, valor, fuente = 'mindicador.cl') =>
  q(supa.from('dolar').upsert({ fecha, valor, fuente }, { onConflict: 'fecha' }).select());

const leerGuardado = async (fecha) => {
  const rows = await q(supa.from('dolar').select('valor').eq('fecha', fecha).limit(1));
  return rows.length ? Number(rows[0].valor) : null;
};

// Memoria de corta duración de la respuesta ya resuelta para una fecha.
//
// Un día sin publicación —hoy antes de media mañana, un feriado— obliga a
// recorrer los días anteriores, y la pantalla de Valorización pide el dólar
// en cada carga. Sin esto, cada visita repetiría esas consultas para llegar
// al mismo valor. Diez minutos es corto para que la publicación del día
// aparezca sola, y largo para que nadie pague el recorrido dos veces.
// La tabla `dolar` sigue siendo la fuente de verdad; esto solo evita repetir
// el camino hasta ella.
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();
export const olvidarDolar = () => cache.clear();

// Última cotización guardada antes de esa fecha. Si la historia empieza
// después —una guía vieja cargada en una base recién poblada— se usa la más
// antigua que haya, porque es la única referencia existente.
async function ultimoGuardado(fecha) {
  const previo = await q(supa.from('dolar').select('fecha,valor')
    .lte('fecha', fecha).order('fecha', { ascending: false }).limit(1));
  const rows = previo.length ? previo
    : await q(supa.from('dolar').select('fecha,valor').order('fecha', { ascending: true }).limit(1));
  return rows.length ? { fecha: rows[0].fecha, valor: Number(rows[0].valor) } : null;
}

/**
 * Valor del dólar para una fecha. Devuelve `null` si la migración no está
 * aplicada; nunca lanza por un problema de red.
 * @returns {Promise<{valor:number, fecha:string, estimado:boolean}|null>}
 */
export async function valorDolar(fecha = hoy()) {
  if (!tiene.usd) return null;

  const propio = await leerGuardado(fecha);
  if (propio != null) return { valor: propio, fecha, estimado: false };

  const memo = cache.get(fecha);
  if (memo && Date.now() - memo.en < CACHE_MS) return memo.valor;
  const recordar = (v) => { cache.set(fecha, { en: Date.now(), valor: v }); return v; };

  const r = await consultarApi(fecha);
  if (r.valor != null) {
    // upsert: dos recepciones simultáneas del mismo día no se pisan
    await guardar(fecha, r.valor, r.fuente);
    return { valor: r.valor, fecha, estimado: false };
  }

  // La API contestó que ese día no tiene publicación: era sábado, feriado, o
  // todavía no sale la del día. Se retrocede hasta la última que sí exista, y
  // cada valor se guarda con SU fecha, que es la que el Banco Central publicó.
  // Si en cambio la API no se pudo alcanzar, no se insiste: diez timeouts
  // seguidos dejarían la pantalla colgada por nada.
  if (r.alcanzada) {
    for (let i = 1; i <= DIAS_ATRAS; i++) {
      const f = restarDias(fecha, i);
      const local = await leerGuardado(f);
      if (local != null) return recordar({ valor: local, fecha: f, estimado: true });
      const prev = await consultarApi(f);
      if (!prev.alcanzada) break;
      if (prev.valor != null) {
        await guardar(f, prev.valor, prev.fuente);
        return recordar({ valor: prev.valor, fecha: f, estimado: true });
      }
    }
  }

  // API caída o hueco más largo que el que vale la pena recorrer: se arrastra
  // la última cotización que haya en la historia propia.
  const ultimo = await ultimoGuardado(fecha);
  return recordar(ultimo ? { valor: ultimo.valor, fecha: ultimo.fecha, estimado: true } : null);
}

/**
 * Trae la serie completa del año desde la fuente que conteste (SII, y si no,
 * mindicador) y guarda las fechas que falten en la tabla `dolar`. Es lo que
 * mantiene el dólar al día sin esperar a que una recepción lo pida: corre con
 * el barrido periódico (jobs.js). Nunca pisa un valor ya guardado, sea de una
 * fuente o fijado a mano.
 *
 * Devuelve además la serie resultante (lo guardado manda sobre la fuente) y
 * `ultima`, la fecha de la publicación más reciente: hasta ese día el dólar de
 * cualquier fecha es definitivo, porque ya no puede aparecer una publicación
 * anterior. Con `simular` no escribe.
 * @returns {Promise<{ok:boolean, fuente?:string, nuevos?:number, ultima?:string, serie?:Map<string,number>}>}
 */
export async function sincronizarDolar({ anios = [hoy().slice(0, 4)], simular = false } = {}) {
  if (!tiene.usd) return { ok: false };
  const lista = [...new Set(anios)].sort();
  const fuenteDe = new Map();
  const fuentes = new Set();
  for (const anio of lista) {
    let tabla = await tablaSii(anio, { fresca: true });
    let fuente = 'sii.cl';
    if (!tabla) { tabla = await tablaMindicador(anio); fuente = 'mindicador.cl'; }
    // Sin el año en curso no se sabe cuál es la última publicación: no hay
    // nada firme que informar. Un año anterior que falle solo deja sus guías
    // para la próxima pasada.
    if (!tabla) { if (anio === lista[lista.length - 1]) return { ok: false }; continue; }
    fuentes.add(fuente);
    for (const [f, v] of tabla) if (f <= hoy()) fuenteDe.set(f, { valor: v, fuente });
  }
  if (!fuenteDe.size) return { ok: false };

  // Diciembre del año anterior entra para que una guía del 1 o 2 de enero
  // encuentre la última publicación previa.
  const desde = `${Number(lista[0]) - 1}-12-01`;
  const guardados = await q(supa.from('dolar').select('fecha,valor').gte('fecha', desde).order('fecha').limit(5000));
  const tengo = new Set(guardados.map((x) => x.fecha));
  const faltan = [...fuenteDe].filter(([f]) => !tengo.has(f))
    .map(([fecha, x]) => ({ fecha, valor: x.valor, fuente: x.fuente }));
  if (faltan.length && !simular) {
    // ignoreDuplicates: si alguien fijó ese día a mano entre la lectura y la
    // escritura, se respeta lo que fijó.
    await q(supa.from('dolar').upsert(faltan, { onConflict: 'fecha', ignoreDuplicates: true }).select('fecha'));
    olvidarDolar();
  }
  const serie = new Map([...fuenteDe].map(([f, x]) => [f, x.valor]));
  for (const x of guardados) serie.set(x.fecha, Number(x.valor));
  const ultima = [...fuenteDe.keys()].sort().pop();
  return { ok: true, fuente: [...fuentes].join(' + '), nuevos: faltan.length, ultima, serie };
}

// Historia para la pantalla de valorización.
export async function historialDolar(dias = 30) {
  if (!tiene.usd) return [];
  return q(supa.from('dolar').select('fecha,valor,fuente').order('fecha', { ascending: false }).limit(dias));
}

// Registro manual, para cuando el ITO necesita fijar un tipo de cambio.
// Olvida lo memorizado: fijar el valor de un día cambia también de qué día
// arrastran los que vienen después, y eso tiene que verse de inmediato.
export async function fijarDolar(fecha, valor, usuario) {
  const row = await q(supa.from('dolar')
    .upsert({ fecha, valor, fuente: `manual · ${usuario}` }, { onConflict: 'fecha' })
    .select().single());
  olvidarDolar();
  return row;
}
