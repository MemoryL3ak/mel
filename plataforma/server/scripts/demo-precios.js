// Rehace la tabla de precios con vigencias escalonadas, para poder ver el
// semáforo de la pantalla de Valorización con sus tres estados a la vez.
//
// Uso:  npm run demo:precios              → muestra lo que haría, sin tocar nada
//       npm run demo:precios -- --confirmar  → BORRA el historial de precios y lo reemplaza
//
// Ojo: el historial de precios es dato de contrato y no se sobrescribe nunca en
// la operación normal (cada cambio se apila). Este script es solo para dejar un
// ambiente de demostración en estado presentable; no correrlo en producción.
import { supa, hoy } from '../src/supa.js';
import { contrato, venceElPrecio } from '../src/contrato.js';

const confirmar = process.argv.includes('--confirmar');

// Días hacia atrás medidos desde hoy, para que el semáforo salga igual sin
// importar el día en que se corra. Con 3 meses de vigencia: ~131 y ~122 días
// atrás quedan vencidos, ~87 y ~82 vencen dentro de 15 días, el resto holgado.
const TABLA = [
  ['Fierro pesado',           172.00, 260, 'Carga inicial'],
  ['Fierro pesado',           185.00, 131, 'Coordinador Logístico MEL'],
  ['Fierro liviano / mixto',  128.00, 260, 'Carga inicial'],
  ['Fierro liviano / mixto',  120.00, 122, 'Coordinador Logístico MEL'],
  ['Acero inoxidable',        610.00, 250, 'Carga inicial'],
  ['Acero inoxidable',        650.00,  87, 'Coordinador Logístico MEL'],
  ['Cables forrados',        2250.00, 250, 'Carga inicial'],
  ['Cables forrados',        2400.00,  82, 'Coordinador Logístico MEL'],
  ['Bronce',                 3980.00, 240, 'Carga inicial'],
  ['Bronce',                 4200.00,  34, 'Coordinador Logístico MEL'],
  ['Aluminio',               1210.00, 240, 'Carga inicial'],
  ['Aluminio',               1150.00,  13, 'Coordinador Logístico MEL'],
];

const h = hoy();
const menosDias = (n) => {
  const [a, m, d] = h.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - n)).toISOString().slice(0, 10);
};
const diasPara = (f) => Math.round((new Date(f + 'T12:00:00') - new Date(h + 'T12:00:00')) / 86400000);

const { data: categorias, error } = await supa.from('categorias').select('id, nombre').order('id');
if (error) { console.error('✗ No se pudo leer categorías:', error.message); process.exit(1); }
const idDe = Object.fromEntries(categorias.map((c) => [c.nombre, c.id]));

const faltan = [...new Set(TABLA.map((f) => f[0]))].filter((n) => !(n in idDe));
if (faltan.length) { console.error('✗ Faltan categorías en la base:', faltan.join(', ')); process.exit(1); }

const filas = TABLA.map(([nombre, precio_kg, dias, creado_por]) => ({
  categoria_id: idDe[nombre], precio_kg, vigente_desde: menosDias(dias), creado_por,
}));

// Resumen del semáforo que va a quedar, calculado igual que el servidor.
const meses = (await contrato()).meses_vigencia_precio;
const resumen = categorias.map((c) => {
  const vig = filas.filter((f) => f.categoria_id === c.id && f.vigente_desde <= h)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0];
  if (!vig) return { categoría: c.nombre, precio: '—', desde: '—', vence: '—', semáforo: '⚪ sin precio' };
  const vence = venceElPrecio(vig.vigente_desde, meses);
  const d = diasPara(vence);
  return {
    categoría: c.nombre,
    precio: `$ ${Number(vig.precio_kg).toLocaleString('es-CL')}`,
    desde: vig.vigente_desde,
    vence,
    semáforo: d < 0 ? `🔴 vencido hace ${-d} d` : d <= 15 ? `🟡 vence en ${d} d` : `🟢 vigente (${d} d)`,
  };
});

console.log(`\nVigencia del contrato: ${meses} meses. Semáforo que va a quedar al ${h}:\n`);
console.table(resumen);

if (!confirmar) {
  const { count } = await supa.from('precios').select('*', { count: 'exact', head: true });
  console.log(`\nSimulación. Se borrarían los ${count} precios actuales y se cargarían ${filas.length}.`);
  console.log('Para aplicarlo:  npm run demo:precios -- --confirmar\n');
  process.exit(0);
}

const del = await supa.from('precios').delete().gte('id', 0);
if (del.error) { console.error('✗ No se pudo limpiar precios:', del.error.message); process.exit(1); }
const ins = await supa.from('precios').insert(filas);
if (ins.error) { console.error('✗ No se pudieron cargar los precios:', ins.error.message); process.exit(1); }

console.log(`\n✓ ${filas.length} vigencias cargadas (2 por categoría: la anterior y la actual).`);
console.log('  Los despachos ya recepcionados no cambian: cada uno tiene su precio congelado.\n');
