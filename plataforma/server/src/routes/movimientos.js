// Respaldo de los movimientos en Excel: todas las guías de despacho de un rango
// de fechas (estén o no en un estado de pago, incluidas las anuladas, que se
// listan pero no suman) y los traslados de La Negra a Lampa del mismo rango.
// Es de solo lectura: no cambia nada en la plataforma.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { supa, q, ah, hoy } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { contarGuias } from '../guias.js';

const r = Router();

const ESTADO = { pendiente_guia: 'Pendiente guía', en_transito: 'En tránsito', recepcionado: 'Recepcionado', observado: 'Diferencia de peso', anulado: 'Anulada' };
const REGLA = { mel: 'MEL', lampa: 'La Negra', pendiente: 'Por acordar', acuerdo: 'Acordado' };
const TIPO_DESC = { kg: 'kg', pct: '%', usd: 'USD', clp: '$' };
const CLP = '"$"#,##0', KG = '#,##0.##', USD = '#,##0.00';
const esFecha = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''));
const n = (v) => (v == null ? null : Number(v));

// La API entrega hasta 1000 filas por consulta: se recorre por páginas.
async function todas(consulta) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const filas = await q(consulta().range(i, i + 999));
    out.push(...filas);
    if (filas.length < 1000) return out;
  }
}

const cabecera = (hoja, titulos) => {
  const row = hoja.addRow(titulos);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF232930' } }; });
  return row;
};

r.get('/movimientos/excel', auth(), ah(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) {
    return res.status(400).json({ error: 'Indique un rango de fechas válido (desde y hasta)' });
  }
  const sel = `*, patios(codigo), cat:categorias!despachos_categoria_id_fkey(nombre), catf:categorias!despachos_categoria_final_id_fkey(nombre), estados_pago(folio, numero)${
    tiene.desp_componente ? ', comp:componentes!despachos_componente_id_fkey(codigo, nombre)' : ''}`;
  const [desp, tras] = await Promise.all([
    todas(() => supa.from('despachos').select(sel).gte('fecha', desde).lte('fecha', hasta).order('fecha').order('id')),
    todas(() => supa.from('traslados').select('*, categorias(nombre)').gte('fecha', desde).lte('fecha', hasta).order('fecha').order('id')),
  ]);
  const descs = [];
  if (tiene.desc_item) {
    const ids = desp.map((d) => d.id);
    for (let i = 0; i < ids.length; i += 300) {
      descs.push(...await q(supa.from('despacho_descuentos').select('*').in('despacho_id', ids.slice(i, i + 300)).order('id')));
    }
  }
  const descDe = new Map();
  for (const x of descs) descDe.set(x.despacho_id, [...(descDe.get(x.despacho_id) ?? []), x]);
  // Una guía anulada o todavía sin guía queda en el respaldo, pero no suma.
  const vigente = (d) => !['anulado', 'pendiente_guia'].includes(d.estado);
  const kgDesc = (d) => (descDe.get(d.id) ?? []).filter((x) => x.tipo === 'kg').reduce((a, x) => a + Number(x.valor), 0);
  const kgVal = (d) => (d.kg_destino == null ? 0 : Number(d.kg_contrato ?? d.kg_destino ?? 0));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'GEA · Minera Escondida';

  // --- Guías de despacho ---
  const COLS = [
    ['Código interno', 12], ['N° guía MEL', 13], ['Estado', 16], ['Estado de pago', 15], ['Fecha guía', 12], ['Fecha recepción', 14], ['Patio', 9],
    ['Categoría despachada', 30], ['Categoría recibida', 30], ['Alternativa', 12], ['SKU obsoleto', 13], ['Componente', 34],
    ['Kg MEL', 11, KG], ['Kg La Negra', 12, KG], ['Kg descontados', 14, KG], ['Dif. %', 8, '0.00'], ['Peso que rige', 13],
    ['Kg valorizados', 14, KG], ['USD/TM', 10, USD], ['Dólar', 10, USD], ['Valor USD', 13, USD], ['Valor CLP', 15, CLP],
    ['Descuentos de la guía', 36], ['N° ticket', 12], ['N° vale', 12], ['Transportista', 22], ['Patente', 10],
    ['Recepcionó', 20], ['Registró', 20], ['Observación', 40], ['Motivo de anulación', 36],
  ];
  const g = wb.addWorksheet('Guías de despacho', { views: [{ state: 'frozen', ySplit: 1 }] });
  g.columns = COLS.map(([, width, numFmt]) => ({ width, ...(numFmt ? { style: { numFmt } } : {}) }));
  cabecera(g, COLS.map(([t]) => t));
  for (const d of desp) {
    const dd = descDe.get(d.id) ?? [];
    const o = Number(d.kg_origen), ln = n(d.kg_destino), kgD = kgDesc(d);
    // Misma comparación que la regla: sin los kilos descontados si así se acercan.
    const ref = ln == null ? null : (Math.abs(ln - kgD - o) <= Math.abs(ln - o) ? ln - kgD : ln);
    const row = g.addRow([
      d.guia, d.guia_mel ?? '', ESTADO[d.estado] ?? d.estado,
      d.estados_pago ? `N° ${d.estados_pago.numero ?? '—'} · ${d.estados_pago.folio}` : '',
      d.fecha, d.fecha_recepcion ?? (d.recepcionado_el ? String(d.recepcionado_el).slice(0, 10) : ''), d.patios?.codigo ?? '',
      d.cat?.nombre ?? '', ln == null ? '' : (d.catf?.nombre ?? d.cat?.nombre ?? ''), d.con_madera == null ? '' : d.con_madera ? 'Con madera' : 'Sin madera',
      d.comp?.codigo ?? '', d.comp?.nombre ?? '',
      o, ln, kgD || null, ref == null || !o ? null : Math.round(((ref - o) / o) * 10000) / 100,
      ln == null ? '' : (d.regla_peso ? REGLA[d.regla_peso] ?? d.regla_peso : 'La Negra'),
      ln == null ? null : kgVal(d), n(d.precio_usd_tm), n(d.dolar), n(d.valor_usd), n(d.valor),
      dd.map((x) => `${Number(x.valor)} ${TIPO_DESC[x.tipo] ?? x.tipo} · ${x.glosa}`).join(' | '),
      d.ticket_numero ?? '', d.vale_numero ?? '', d.transportista ?? '', d.patente_tracto ?? '',
      d.recepcionado_por ?? '', d.creado_por ?? '', d.obs_recepcion ?? d.observacion ?? '', d.motivo_anulacion ?? '',
    ]);
    if (!vigente(d)) row.font = { color: { argb: 'FF8A8A8A' }, italic: true };
  }
  const viv = desp.filter(vigente);
  const suma = (filas, f) => filas.reduce((a, d) => a + f(d), 0);
  const nViv = contarGuias(viv);
  const tot = g.addRow(['Total', nViv === viv.length ? `${nViv} guías vigentes` : `${nViv} guías vigentes · ${viv.length} filas`, '', '', '', '', '', '', '', '', '', '',
    suma(viv, (d) => Number(d.kg_origen ?? 0)), suma(viv, (d) => Number(d.kg_destino ?? 0)), suma(viv, kgDesc) || null, null, '',
    suma(viv, kgVal), null, null, Math.round(suma(viv, (d) => Number(d.valor_usd ?? 0)) * 100) / 100, suma(viv, (d) => Number(d.valor ?? 0))]);
  tot.font = { bold: true };
  g.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  // --- Traslados a Lampa ---
  const TC = [['Guía de traslado', 16], ['Fecha', 12], ['Categoría', 34], ['Kg despachados', 15, KG], ['Kg recibidos en Lampa', 20, KG],
    ['Diferencia kg', 13, KG], ['Estado', 14], ['Fecha recepción', 14], ['Certificado', 14], ['Registró', 20]];
  const t = wb.addWorksheet('Traslados a Lampa', { views: [{ state: 'frozen', ySplit: 1 }] });
  t.columns = TC.map(([, width, numFmt]) => ({ width, ...(numFmt ? { style: { numFmt } } : {}) }));
  cabecera(t, TC.map(([x]) => x));
  for (const x of tras) {
    t.addRow([x.guia, x.fecha, x.categorias?.nombre ?? '', Number(x.kg), n(x.kg_lampa), x.kg_lampa == null ? null : Number(x.kg_lampa) - Number(x.kg),
      x.estado === 'recepcionado' ? 'Recepcionado' : 'En tránsito',
      x.fecha_recepcion ?? (x.recepcionado_el ? String(x.recepcionado_el).slice(0, 10) : ''), x.cert_folio ?? '', x.creado_por ?? '']);
  }
  if (tras.length) {
    t.addRow(['Total', `${tras.length} traslados`, '', suma(tras, (x) => Number(x.kg)), suma(tras, (x) => Number(x.kg_lampa ?? 0))]).font = { bold: true };
  }

  // --- Resumen ---
  const s = wb.addWorksheet('Resumen');
  s.columns = [{ width: 46 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 20 }];
  const linea = (v, negrita = false) => { const row = s.addRow(v); if (negrita) row.font = { bold: true }; return row; };
  linea([`Movimientos del ${desde} al ${hasta}`], true);
  linea([`Descargado el ${hoy()} por ${req.user.name} · las guías anuladas y las pendientes de guía se listan, pero no suman`]);
  linea([]);
  cabecera(s, ['Guías por estado', 'Guías', '', '', '']);
  for (const [k, nombre] of Object.entries(ESTADO)) { const c = contarGuias(desp.filter((d) => d.estado === k)); if (c) linea([nombre, c]); }
  linea(['Total registradas', contarGuias(desp)], true);
  linea([]);
  cabecera(s, ['Categoría (vigentes)', 'Guías', 'Kg MEL', 'Kg valorizados', 'Valor CLP']);
  const porCat = new Map();
  for (const d of viv) {
    const k = (d.kg_destino != null ? d.catf?.nombre : null) ?? d.cat?.nombre ?? '—';
    const c = porCat.get(k) ?? { filas: [], kgMel: 0, kg: 0, valor: 0 };
    c.filas.push(d); c.kgMel += Number(d.kg_origen ?? 0); c.kg += kgVal(d); c.valor += Number(d.valor ?? 0);
    porCat.set(k, c);
  }
  const fmt = (row) => { row.getCell(3).numFmt = KG; row.getCell(4).numFmt = KG; row.getCell(5).numFmt = CLP; return row; };
  for (const [k, c] of [...porCat].sort((a, b) => b[1].valor - a[1].valor)) fmt(linea([k, contarGuias(c.filas), c.kgMel, c.kg, c.valor]));
  fmt(linea(['Total vigentes', nViv, suma(viv, (d) => Number(d.kg_origen ?? 0)), suma(viv, kgVal), suma(viv, (d) => Number(d.valor ?? 0))], true));
  if (contarGuias(desp) !== desp.length) linea([`Las ${desp.length} filas de la hoja «Guías de despacho» son ${contarGuias(desp)} guías de MEL: los componentes obsoletos de una misma guía se cuentan una vez.`]);
  linea([]);
  cabecera(s, ['Kilos (vigentes)', '', 'Kg', '', '']);
  for (const [k, v] of [['Declarados por MEL', suma(viv, (d) => Number(d.kg_origen ?? 0))], ['Pesados en La Negra', suma(viv, (d) => Number(d.kg_destino ?? 0))],
    ['Descontados en La Negra (madera u otros)', suma(viv, kgDesc)], ['Valorizados (peso que rige)', suma(viv, kgVal)],
    ['Sin recepcionar todavía (kg MEL)', suma(viv.filter((d) => d.kg_destino == null), (d) => Number(d.kg_origen ?? 0))],
    ['Trasladados a Lampa', suma(tras, (x) => Number(x.kg))], ['Recibidos en Lampa', suma(tras, (x) => Number(x.kg_lampa ?? 0))]]) {
    linea([k, '', v]).getCell(3).numFmt = KG;
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="movimientos-${desde}-a-${hasta}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
