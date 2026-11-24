// Historial de guías anteriores a la plataforma (planilla «HISTORIA CHATARRA»
// de MEL). Es un registro aparte: no entra a despachos, cuadraturas ni estados
// de pago. Alimenta los indicadores del año y se consulta en su propia pestaña.
//
// Cada fila queda en el período del EDP en que se cobró (el que dice la
// planilla), no en el de su fecha: una guía del 7 de enero cobrada en el EDP 1
// (21-01 al 20-02) es del período que cierra en febrero.
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { supa, q, ah, audit, hoy } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';

const r = Router();
const SIN_MIGRACION = 'El historial requiere aplicar db/0021_cierre_historial.sql en la base de datos';
const LECTORES = ['ito', 'coordinador'];

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Distancia de edición, para tolerar un error de tipeo en el nombre de la
// categoría («Excendete acero especial» en el maestro, «Excedente…» en la planilla).
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

function buscarCategoria(texto, cats) {
  const k = norm(texto);
  if (!k) return null;
  const exacta = cats.find((c) => norm(c.nombre) === k);
  if (exacta) return exacta.id;
  const cerca = cats.map((c) => [c.id, distancia(norm(c.nombre), k)]).filter(([, n]) => n <= 2).sort((a, b) => a[1] - b[1]);
  return cerca.length === 1 || (cerca.length > 1 && cerca[0][1] < cerca[1][1]) ? cerca[0][0] : null;
}

const celda = (c) => {
  const v = c?.value;
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map((t) => t.text).join('') : null);
  return v;
};
const fechaISO = (v) => {
  if (v == null || v === '') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
  const m = String(v).match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
const numero = (v) => { if (v == null || v === '') return null; const n = Number(typeof v === 'string' ? v.replace(/\./g, '').replace(',', '.') : v); return Number.isFinite(n) ? n : null; };
const texto = (v) => { const s = String(v ?? '').trim(); return s || null; };

// Encabezados de la planilla → campo. Se buscan por nombre, no por posición.
const COLUMNAS = {
  'mes edp': 'mes', 'edp n': 'edp', 'periodo del edp': 'periodo_texto', 'fecha evento': 'fecha',
  'gde de venta': 'gde', 'estado de emision gde': 'estado_emision', 'n gd anulada': 'gd_anulada',
  'tipo de guia': 'tipo_guia', 'descripcion': 'categoria', 'patio': 'patio', 't c': 'dolar', 'ton': 'ton',
  'valor contrato': 'usd_tm', 'precio unitario': 'precio_clp_tm', 'valor neto': 'valor',
};

// Lee la planilla y devuelve las filas listas para guardar, más los avisos.
export async function leerHistorial(buffer, cats = []) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { error: 'La planilla no tiene hojas' };
  const col = {};
  ws.getRow(1).eachCell((c, i) => { const campo = COLUMNAS[norm(celda(c))]; if (campo) col[campo] = i; });
  const faltan = ['edp', 'periodo_texto', 'fecha', 'gde', 'ton', 'valor'].filter((k) => !col[k]);
  if (faltan.length) return { error: `No se reconocen las columnas de la planilla (faltan: ${faltan.join(', ')}). Debe ser la planilla «HISTORIA CHATARRA» con sus encabezados en la primera fila.` };

  const filas = [], avisos = [];
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const v = (k) => (col[k] ? celda(row.getCell(col[k])) : null);
    if (Object.keys(col).every((k) => v(k) == null || v(k) === '')) continue;
    const fecha = fechaISO(v('fecha'));
    const gde = texto(v('gde'));
    if (!fecha || !gde) { avisos.push(`Fila ${n}: sin fecha o sin N° de guía, no se carga.`); continue; }
    // Período del EDP: el mes en que cierra («21-01 al 20-02» → febrero).
    const pt = texto(v('periodo_texto'));
    const fin = pt?.match(/al\s+\d{1,2}[-/](\d{1,2})/i);
    const mesBase = fechaISO(v('mes')) ?? fecha;
    let anio = Number(mesBase.slice(0, 4));
    let mes = fin ? Number(fin[1]) : Number(mesBase.slice(5, 7));
    if (!(mes >= 1 && mes <= 12)) mes = Number(fecha.slice(5, 7));
    if (fin && mes < Number(mesBase.slice(5, 7)) - 6) anio += 1;   // «21-12 al 20-01»: cierra el año siguiente
    const ton = numero(v('ton'));
    const categoria = texto(v('categoria'));
    filas.push({
      anio, periodo: `${anio}-${String(mes).padStart(2, '0')}`,
      edp_numero: numero(v('edp')) == null ? null : Math.round(numero(v('edp'))),
      periodo_texto: pt, fecha, gde,
      estado_emision: texto(v('estado_emision')), gd_anulada: texto(v('gd_anulada')), tipo_guia: texto(v('tipo_guia')),
      categoria, categoria_id: buscarCategoria(categoria, cats), patio: texto(v('patio')),
      dolar: numero(v('dolar')), kg: ton == null ? null : Math.round(ton * 10000) / 10,
      usd_tm: numero(v('usd_tm')) == null ? null : Math.round(numero(v('usd_tm')) * 10000) / 10000,
      precio_clp_tm: numero(v('precio_clp_tm')) == null ? null : Math.round(numero(v('precio_clp_tm'))),
      valor: numero(v('valor')) == null ? null : Math.round(numero(v('valor'))),
    });
  }
  if (!filas.length) return { error: 'La planilla no trae filas con fecha y N° de guía' };
  const sinKg = filas.filter((f) => !(f.kg > 0)).length;
  const sinValor = filas.filter((f) => !(f.valor > 0)).length;
  const sinCat = [...new Set(filas.filter((f) => f.categoria && !f.categoria_id).map((f) => f.categoria))];
  if (sinKg) avisos.push(`${sinKg} fila(s) sin toneladas: se cargan con kilos en blanco.`);
  if (sinValor) avisos.push(`${sinValor} fila(s) sin valor neto: se cargan tal cual.`);
  if (sinCat.length) avisos.push(`Descripciones que no son una categoría del contrato (se muestran con el nombre de la planilla): ${sinCat.join(', ')}.`);
  return { filas, avisos };
}

// N° de guía MEL de las guías vigentes de la plataforma: una fila del historial
// con ese mismo número ya está en GEA como guía real y no se cuenta dos veces.
async function guiasEnGea() {
  const d = await q(supa.from('despachos').select('guia_mel').not('guia_mel', 'is', null).neq('estado', 'anulado'));
  return new Set(d.map((x) => String(x.guia_mel).trim()));
}

// Filas del historial de un año, marcando las que ya están en la plataforma.
export async function historialDelAnio(anio) {
  if (!tiene.historial) return [];
  const [filas, enGea] = await Promise.all([
    q(supa.from('historial_guias').select('*').eq('anio', anio).order('fecha').order('id').limit(5000)),
    guiasEnGea(),
  ]);
  return filas.map((f) => ({
    ...f, kg: f.kg == null ? null : Number(f.kg), valor: f.valor == null ? null : Number(f.valor),
    dolar: f.dolar == null ? null : Number(f.dolar), usd_tm: f.usd_tm == null ? null : Number(f.usd_tm),
    precio_clp_tm: f.precio_clp_tm == null ? null : Number(f.precio_clp_tm),
    en_gea: enGea.has(String(f.gde).trim()),
  }));
}

const resumir = (filas) => {
  const m = new Map();
  for (const f of filas) {
    const x = m.get(f.periodo) ?? { periodo: f.periodo, edp_numero: f.edp_numero, periodo_texto: f.periodo_texto, guias: 0, kg: 0, valor: 0, en_gea: 0 };
    if (f.en_gea) x.en_gea++; else { x.guias++; x.kg += Number(f.kg ?? 0); x.valor += Number(f.valor ?? 0); }
    m.set(f.periodo, x);
  }
  return [...m.values()].sort((a, b) => a.periodo.localeCompare(b.periodo));
};

r.get('/historial', auth(...LECTORES), ah(async (req, res) => {
  const anio = Number(req.query.anio) || Number(hoy().slice(0, 4));
  if (!tiene.historial) return res.json({ disponible: false, anio, filas: [], periodos: [], total: { guias: 0, kg: 0, valor: 0, en_gea: 0 } });
  const filas = await historialDelAnio(anio);
  const periodos = resumir(filas);
  res.json({
    disponible: true, anio, filas, periodos,
    total: periodos.reduce((a, p) => ({ guias: a.guias + p.guias, kg: a.kg + p.kg, valor: a.valor + p.valor, en_gea: a.en_gea + p.en_gea }), { guias: 0, kg: 0, valor: 0, en_gea: 0 }),
    cargado: filas.length ? { el: filas.reduce((a, f) => (f.cargado_el > a ? f.cargado_el : a), '').slice(0, 10), por: filas[0].cargado_por, origen: filas[0].origen } : null,
  });
}));

const subir = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { files: 1, fileSize: 10 * 1024 * 1024 } });

// Carga la planilla. Reemplaza el historial de los años que trae: volver a
// subir una planilla corregida no duplica nada. Con `simular` solo informa.
r.post('/historial/importar', auth('coordinador'), subir.single('archivo'), ah(async (req, res) => {
  if (!tiene.historial) return res.status(503).json({ error: SIN_MIGRACION });
  if (!req.file) return res.status(400).json({ error: 'Adjunte la planilla en Excel (.xlsx)' });
  const cats = await q(supa.from('categorias').select('id, nombre'));
  let leido;
  try { leido = await leerHistorial(req.file.buffer, cats); }
  catch (e) { return res.status(400).json({ error: `No se pudo leer el Excel: ${e.message}. Guarde la planilla como .xlsx.` }); }
  if (leido.error) return res.status(400).json({ error: leido.error });
  const { filas, avisos } = leido;
  const anios = [...new Set(filas.map((f) => f.anio))].sort();
  const enGea = await guiasEnGea();
  const repetidas = filas.filter((f) => enGea.has(f.gde)).length;
  const periodos = resumir(filas.map((f) => ({ ...f, en_gea: enGea.has(f.gde) })));
  const informe = {
    filas: filas.length, anios, periodos, avisos, ya_en_gea: repetidas,
    kg: filas.reduce((a, f) => a + Number(f.kg ?? 0), 0), valor: filas.reduce((a, f) => a + Number(f.valor ?? 0), 0),
  };
  if (String(req.body?.simular ?? '') === '1') return res.json({ simulado: true, ...informe });

  await q(supa.from('historial_guias').delete().in('anio', anios).select('id'));
  const origen = req.file.originalname?.slice(0, 200) ?? null;
  for (let i = 0; i < filas.length; i += 200) {
    await q(supa.from('historial_guias')
      .insert(filas.slice(i, i + 200).map((f) => ({ ...f, origen, cargado_por: req.user.name }))).select('id'));
  }
  await audit(req.user.name, req.user.role, 'Cargó el historial de guías',
    `${filas.length} fila(s) · año(s) ${anios.join(', ')} · ${Math.round(informe.kg)} kg · $${informe.valor}${origen ? ` · ${origen}` : ''}`);
  res.json({ simulado: false, ...informe });
}));

r.get('/historial/excel', auth(...LECTORES), ah(async (req, res) => {
  if (!tiene.historial) return res.status(503).json({ error: SIN_MIGRACION });
  const anio = Number(req.query.anio) || Number(hoy().slice(0, 4));
  const filas = await historialDelAnio(anio);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GEA · Minera Escondida';
  const COLS = [['EDP N°', 8], ['Período del EDP', 16], ['Fecha', 12], ['N° guía', 12], ['Estado de emisión', 22], ['GD anulada / nota', 26],
    ['Tipo de guía', 14], ['Descripción', 36], ['Patio', 20], ['Dólar', 10, '#,##0.00'], ['Kg', 12, '#,##0.##'], ['USD/TM', 11, '#,##0.00'],
    ['Precio CLP/TM', 14, '"$"#,##0'], ['Valor neto', 16, '"$"#,##0'], ['En GEA', 9]];
  const ws = wb.addWorksheet(`Historial ${anio}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLS.map(([, width, numFmt]) => ({ width, ...(numFmt ? { style: { numFmt } } : {}) }));
  const cab = ws.addRow(COLS.map(([t]) => t));
  cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cab.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF232930' } }; });
  for (const f of filas) {
    ws.addRow([f.edp_numero, f.periodo_texto, f.fecha, f.gde, f.estado_emision ?? '', f.gd_anulada ?? '', f.tipo_guia ?? '',
      f.categoria ?? '', f.patio ?? '', f.dolar, f.kg, f.usd_tm, f.precio_clp_tm, f.valor, f.en_gea ? 'Sí' : '']);
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="historial-guias-${anio}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
