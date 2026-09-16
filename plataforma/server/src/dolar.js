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

// dd-mm-aaaa, que es como mindicador espera la fecha.
const alFormatoApi = (iso) => iso.split('-').reverse().join('-');

async function consultarApi(fecha) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${alFormatoApi(fecha)}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    const v = Number(j?.serie?.[0]?.valor);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;   // la API es una conveniencia, nunca un bloqueo
  } finally {
    clearTimeout(t);
  }
}

// Última cotización guardada en la historia, sea de la fecha que sea.
async function ultimoGuardado() {
  const rows = await q(supa.from('dolar').select('fecha,valor').order('fecha', { ascending: false }).limit(1));
  return rows.length ? { fecha: rows[0].fecha, valor: Number(rows[0].valor) } : null;
}

/**
 * Valor del dólar para una fecha. Devuelve `null` si la migración no está
 * aplicada; nunca lanza por un problema de red.
 * @returns {Promise<{valor:number, fecha:string, estimado:boolean}|null>}
 */
export async function valorDolar(fecha = hoy()) {
  if (!tiene.usd) return null;

  const guardado = await q(supa.from('dolar').select('valor').eq('fecha', fecha).limit(1));
  if (guardado.length) return { valor: Number(guardado[0].valor), fecha, estimado: false };

  const v = await consultarApi(fecha);
  if (v != null) {
    // upsert: dos recepciones simultáneas del mismo día no se pisan
    await q(supa.from('dolar').upsert({ fecha, valor: v, fuente: 'mindicador.cl' }, { onConflict: 'fecha' }).select());
    return { valor: v, fecha, estimado: false };
  }

  // Fin de semana, feriado o API caída: se arrastra la última publicada.
  const ultimo = await ultimoGuardado();
  return ultimo ? { valor: ultimo.valor, fecha: ultimo.fecha, estimado: true } : null;
}

// Historia para la pantalla de valorización.
export async function historialDolar(dias = 30) {
  if (!tiene.usd) return [];
  return q(supa.from('dolar').select('fecha,valor,fuente').order('fecha', { ascending: false }).limit(dias));
}

// Registro manual, para cuando el ITO necesita fijar un tipo de cambio.
export async function fijarDolar(fecha, valor, usuario) {
  return q(supa.from('dolar')
    .upsert({ fecha, valor, fuente: `manual · ${usuario}` }, { onConflict: 'fecha' })
    .select().single());
}
