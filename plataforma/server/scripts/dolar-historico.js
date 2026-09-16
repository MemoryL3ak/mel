// Puebla la tabla `dolar` con la serie del Banco Central publicada por
// mindicador.cl, para que la pantalla de Valorización nazca con historia y
// para que el arrastre tenga de dónde tomar un valor el primer día.
//
// Uso:  npm run dolar:historico             → los últimos 60 días
//       npm run dolar:historico -- 180      → los últimos 180 días
//
// Es idempotente: cada fecha se inserta con upsert, así que volver a correrlo
// no duplica nada. Los días que ya estén guardados no se vuelven a consultar,
// de modo que correrlo seguido es barato.
//
// Va día por día a propósito: los endpoints de serie completa de mindicador
// (/api/dolar y /api/dolar/<año>) no responden de forma confiable, mientras
// que el de fecha puntual sí. Se omiten sábados y domingos, que nunca tienen
// publicación.
import { supa, hoy } from '../src/supa.js';

const API = 'https://mindicador.cl/api/dolar';
const EN_PARALELO = 5;
const TIMEOUT_MS = 10000;
const dias = Number(process.argv[2]) || 60;

const alFormatoApi = (iso) => iso.split('-').reverse().join('-');
const restarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const finDeSemana = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00Z`).getUTCDay());

async function valorDe(fecha) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${alFormatoApi(fecha)}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const v = Number((await r.json())?.serie?.[0]?.valor);
    return Number.isFinite(v) && v > 0 ? { fecha, valor: v } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

const desde = restarDias(hoy(), dias);
console.log(`Dólar observado desde ${desde} hasta ${hoy()}`);

const { data: yaEstan, error: eLeer } = await supa.from('dolar').select('fecha').gte('fecha', desde);
if (eLeer) {
  console.error('No se pudo leer la tabla `dolar`:', eLeer.message);
  console.error('¿Ejecutó db/0004_operacion.sql?');
  process.exit(1);
}
const conocidas = new Set((yaEstan ?? []).map((x) => x.fecha));

const pendientes = [];
for (let i = 0; i <= dias; i++) {
  const f = restarDias(hoy(), i);
  if (f >= desde && !finDeSemana(f) && !conocidas.has(f)) pendientes.push(f);
}
console.log(`  ${conocidas.size} día(s) ya guardado(s) · ${pendientes.length} por consultar`);

if (!pendientes.length) {
  console.log('\nNada que hacer: la historia ya está al día.');
  process.exit(0);
}

const filas = [];
let sinPublicacion = 0;
for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
  const tanda = await Promise.all(pendientes.slice(i, i + EN_PARALELO).map(valorDe));
  for (const x of tanda) (x ? filas.push(x) : sinPublicacion++);
  process.stdout.write(`\r  consultando… ${Math.min(i + EN_PARALELO, pendientes.length)}/${pendientes.length}`);
}
console.log();

if (!filas.length) {
  console.error('\nNo se obtuvo ninguna publicación. Revise la conexión a mindicador.cl.');
  process.exit(1);
}

const { error } = await supa.from('dolar')
  .upsert(filas.map((x) => ({ ...x, fuente: 'mindicador.cl' })), { onConflict: 'fecha' });
if (error) {
  console.error('\nNo se pudo guardar:', error.message);
  process.exit(1);
}

const ord = [...filas].sort((a, b) => a.fecha.localeCompare(b.fecha));
console.log(`\n${filas.length} día(s) guardado(s)${sinPublicacion ? ` · ${sinPublicacion} hábil(es) sin publicación (feriados o aún no publicados)` : ''}.`);
console.log(`  primero: ${ord[0].fecha} → $${ord[0].valor}`);
console.log(`  último:  ${ord[ord.length - 1].fecha} → $${ord[ord.length - 1].valor}`);
