// Valor del dólar observado, con historia propia.
//
// La valorización del contrato es en USD/kg, así que cada recepción necesita
// el tipo de cambio del día. Se consulta a mindicador.cl (serie del Banco
// Central, sin credenciales) y se guarda en la tabla `dolar`: esa copia local
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

/**
 * Consulta un día puntual. Distingue los dos "no hay valor" que importan:
 * que la API conteste que ese día no tiene publicación, o que no se pueda
 * hablar con ella. Lo primero invita a probar el día anterior; lo segundo, a
 * dejar de insistir.
 * @returns {Promise<{alcanzada:boolean, valor:number|null}>}
 */
async function consultarApi(fecha) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${alFormatoApi(fecha)}`, { signal: ctrl.signal });
    if (!r.ok) return { alcanzada: false, valor: null };
    const j = await r.json();
    const v = Number(j?.serie?.[0]?.valor);
    return { alcanzada: true, valor: Number.isFinite(v) && v > 0 ? v : null };
  } catch {
    return { alcanzada: false, valor: null };   // la API es una conveniencia, nunca un bloqueo
  } finally {
    clearTimeout(t);
  }
}

const guardar = (fecha, valor) =>
  q(supa.from('dolar').upsert({ fecha, valor, fuente: 'mindicador.cl' }, { onConflict: 'fecha' }).select());

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
    await guardar(fecha, r.valor);
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
        await guardar(f, prev.valor);
        return recordar({ valor: prev.valor, fecha: f, estimado: true });
      }
    }
  }

  // API caída o hueco más largo que el que vale la pena recorrer: se arrastra
  // la última cotización que haya en la historia propia.
  const ultimo = await ultimoGuardado(fecha);
  return recordar(ultimo ? { valor: ultimo.valor, fecha: ultimo.fecha, estimado: true } : null);
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
