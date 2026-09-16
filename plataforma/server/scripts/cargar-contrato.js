// Carga las categorías y los precios del contrato Soproin, y borra los datos
// de marcha blanca que existían antes.
//
// Uso:  npm run cargar:contrato                → muestra lo que haría, sin tocar nada
//       npm run cargar:contrato -- --confirmar → BORRA y carga
//
// OJO: --confirmar elimina guías, traslados, estados de pago, cuadraturas y
// precios existentes. Hay un respaldo en db/respaldo/. No correr sin entender
// qué se pierde.
//
// Los precios vienen de la planilla del contrato, en USD por TONELADA MÉTRICA,
// con dos alternativas: A (sin madera) y B (con madera). Cuál se aplica lo
// decide quien recibe la carga, y queda congelado con la guía.
import { supa, hoy } from '../src/supa.js';

const confirmar = process.argv.includes('--confirmar');

// Vigencia declarada en la planilla: "Actualizado al 30/06/2026".
const VIGENTE_DESDE = '2026-06-30';

// nombre                                  A (sin madera)   B (con madera)
const MATERIALES = [
  ['Bolas de acero',                            184.07,     176.98],
  ['Bolas de Acero con Pebbles',                184.07,     176.98],
  ['Enajenados',                                184.07,     176.98],
  ['Excedente alto cromo',                      259.63,     246.68],
  ['Excedente de Bronce',                      7558.38,    6382.61],
  ['Excedente de cables electricos',           5374.87,    5038.91],
  ['Excedente de Fierro chatarra Liviana',      169.90,     159.29],
  ['Excedente de Fierro chatarra Pesada',       177.26,     166.21],
  ['Excedente de Goma con Fierro',               49.24,      30.80],
  ['Excedente de HDPE',                         334.16,     334.16],
  ['Excedente de Manganeso',                    192.08,     184.68],
  ['Excedente de Plasticos',                     75.52,      75.52],
  ['Excedente fierro cromo molibdeno',          199.46,     188.35],
  ['Excedente Manganeso',                       192.08,     184.68],
  ['Excendete acero especial',                  192.08,     184.68],
  ['Goteros',                                    89.12,      89.12],
  ['Motores Eléctricos',                        660.67,     660.67],
  ['Excedente de Acero Inoxidable',             398.34,     398.34],
];

// Tablas que se vacían, en orden de dependencia (las hijas primero).
const A_BORRAR = [
  'despacho_descuentos', 'ep_descuentos', 'cuadraturas',
  'despachos', 'traslados', 'estados_pago', 'precios', 'categorias',
];

const n = (v) => v.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

console.log(`Contrato Soproin · ${MATERIALES.length} materiales · vigencia desde ${VIGENTE_DESDE}\n`);

if (!confirmar) {
  console.log('MODO VISTA PREVIA — no se toca nada.\n');
  console.log('Se vaciarían, en este orden:');
  for (const t of A_BORRAR) {
    const { count } = await supa.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t.padEnd(22)} ${String(count ?? '?').padStart(5)} fila(s)`);
  }
  console.log('\nSe cargarían:');
  console.log('  ' + 'Material'.padEnd(40) + 'A (sin madera)'.padStart(16) + 'B (con madera)'.padStart(16));
  for (const [nom, a, b] of MATERIALES) {
    console.log('  ' + nom.padEnd(40) + `USD ${n(a)}`.padStart(16) + `USD ${n(b)}`.padStart(16));
  }
  console.log('\nPara ejecutarlo:  npm run cargar:contrato -- --confirmar');
  process.exit(0);
}

console.log('Vaciando…');
for (const t of A_BORRAR) {
  const { error } = await supa.from(t).delete().gte('id', 0);
  console.log(`  ${t.padEnd(22)} ${error ? 'ERROR: ' + error.message : 'ok'}`);
}

console.log('\nCargando categorías…');
const { data: cats, error: eCat } = await supa.from('categorias')
  .insert(MATERIALES.map(([nombre]) => ({ nombre, activo: true })))
  .select('id,nombre');
if (eCat) { console.error('  no se pudieron crear:', eCat.message); process.exit(1); }
console.log(`  ${cats.length} categoría(s)`);

console.log('\nCargando precios…');
const porNombre = new Map(cats.map((c) => [c.nombre, c.id]));
const filas = MATERIALES.map(([nombre, a, b]) => ({
  categoria_id: porNombre.get(nombre),
  precio_usd_tm: a,
  precio_usd_tm_madera: b,
  vigente_desde: VIGENTE_DESDE,
  creado_por: 'Carga del contrato',
}));
const { data: precios, error: ePre } = await supa.from('precios').insert(filas).select('id');
if (ePre) {
  console.error('  no se pudieron crear:', ePre.message);
  console.error('  ¿Ejecutó db/0005_precio_tm.sql?');
  process.exit(1);
}
console.log(`  ${precios.length} vigencia(s) desde ${VIGENTE_DESDE}`);

console.log(`\nListo. Hoy es ${hoy()}: con 3 meses de vigencia, estos precios vencen el 2026-09-30.`);
