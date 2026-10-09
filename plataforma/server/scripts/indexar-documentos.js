// Registra en el repositorio documental (Fase 3) los archivos que se subieron
// antes de que existiera: guías de despacho, certificados de disposición final,
// respaldos de descuentos, actas de entrega y memos firmados. No copia nada:
// cada versión apunta a la ruta original en el bucket 'evidencia'.
//
// Uso:  npm run indexar:documentos
// Se puede correr las veces que haga falta: los archivos ya registrados se
// saltan, así que una segunda corrida no duplica nada.
import { supa, q } from '../src/supa.js';
import { detectarEsquema, tiene } from '../src/esquema.js';
import { registrarArchivos } from '../src/documental.js';

await detectarEsquema();
if (!tiene.documentos) {
  console.error('Falta aplicar db/0015_documental.sql en la base de datos.');
  process.exit(1);
}

// Carpeta del bucket → tipo documental, hito y cómo se llega del id de la
// carpeta al id del hito. Las fotos de carga y los tickets de báscula de GD/
// son evidencia, no documentos: de esa carpeta solo entra la guía.
const FUENTES = [
  { carpeta: 'GD', tipo: 'ch_guia_despacho', hito: 'despacho', filtro: (n) => n.startsWith('guia-') },
  { carpeta: 'CDF', tipo: 'ch_cdf', hito: 'traslado' },
  { carpeta: 'EPD', tipo: 'ch_descuentos', hito: 'estado_pago', aHito: 'descuento' },
  { carpeta: 'ENT', tipo: 'ob_cert_entrega', hito: 'adjudicacion' },
  { carpeta: 'MEMO', tipo: 'ob_memo', hito: 'memo' },
];

const listar = async (ruta) => {
  const todo = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supa.storage.from('evidencia').list(ruta, { limit: 1000, offset });
    if (error) throw new Error(`${ruta}: ${error.message}`);
    todo.push(...data);
    if (data.length < 1000) return todo;
  }
};

// Rutas que ya están en alguna versión de algún documento.
const yaRegistradas = new Set(
  (await q(supa.from('documento_versiones').select('archivos')))
    .flatMap((v) => (v.archivos ?? []).map((a) => `${a.bucket}/${a.path}`)),
);

// Un descuento pertenece a un EP: el respaldo se vincula al EP.
const epDeDescuento = new Map(
  (await q(supa.from('ep_descuentos').select('id, ep_id'))).map((d) => [String(d.id), d.ep_id]),
);

const quien = { name: 'Indexación inicial', role: 'sistema' };
let documentos = 0;
let archivos = 0;
for (const f of FUENTES) {
  const carpetas = (await listar(f.carpeta)).filter((x) => !x.id);   // sin id = subcarpeta
  for (const c of carpetas) {
    const refId = f.aHito === 'descuento' ? epDeDescuento.get(c.name) : Number(c.name);
    if (!refId) { console.warn(`· ${f.carpeta}/${c.name}: sin hito al que vincularlo, se omite`); continue; }
    const nuevos = (await listar(`${f.carpeta}/${c.name}`))
      .filter((x) => x.id && (!f.filtro || f.filtro(x.name)))
      .map((x) => ({
        bucket: 'evidencia', path: `${f.carpeta}/${c.name}/${x.name}`, nombre: x.name,
        mime: x.metadata?.mimetype ?? null, bytes: x.metadata?.size ?? null,
      }))
      .filter((a) => !yaRegistradas.has(`${a.bucket}/${a.path}`));
    if (!nuevos.length) continue;
    const id = await registrarArchivos({
      tipo: f.tipo, hito: f.hito, refId, archivos: nuevos, quien,
      nota: 'Archivos cargados antes del repositorio documental',
    });
    if (id) {
      documentos++;
      archivos += nuevos.length;
      console.log(`✓ ${f.carpeta}/${c.name} → ${f.tipo} (${nuevos.length} archivo(s))`);
    } else {
      console.warn(`✗ ${f.carpeta}/${c.name}: no se pudo registrar`);
    }
  }
}
console.log(`\nListo: ${archivos} archivo(s) en ${documentos} documento(s) del repositorio.`);
