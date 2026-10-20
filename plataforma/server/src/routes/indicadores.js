// Fase 4 · Indicadores y reportería.
// Paneles de los dos procesos y su exportación a Excel. Todo sale de los
// datos que ya existen; el corte de tiempo es el período del estado de pago
// (del día siguiente al corte del mes anterior al corte del mes), porque es la
// unidad en que MEL mide el proceso de chatarra. Obsoletos se mira por mes
// calendario, que es como se publica y se vende.
import { Router } from 'express';
import ExcelJS from 'exceljs';
import { supa, q, ah, hoy } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { contrato, periodoEP } from '../contrato.js';

const r = Router();
const ROLES = ['coordinador', 'ito', 'admin_venta'];
const veChatarra = (rol) => ['coordinador', 'ito'].includes(rol);
const veObsoletos = (rol) => ['coordinador', 'admin_venta'].includes(rol);

const num = (v) => (v == null ? 0 : Number(v));
const redondear = (v, d = 1) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const dias = (a, b) => (a && b ? (new Date(b) - new Date(a)) / 86400000 : null);
const promedio = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Los doce períodos del año, nombrados por el mes en que cierran.
function periodosDelAnio(anio, corte) {
  const iso = (d) => d.toISOString().slice(0, 10);
  return Array.from({ length: 12 }, (_, i) => ({
    periodo: `${anio}-${String(i + 1).padStart(2, '0')}`,
    etiqueta: MES_CORTO[i],
    nombre: `EP ${MESES[i]} ${anio}`,
    desde: iso(new Date(Date.UTC(anio, i - 1, corte + 1))),
    hasta: iso(new Date(Date.UTC(anio, i, corte))),
  }));
}

/* ============================ chatarra ============================ */

async function chatarra(anio, periodos, sel) {
  const desde = periodos[0].desde;
  const hasta = periodos[11].hasta;
  const [desp, tras, eps, prog, cats] = await Promise.all([
    q(supa.from('despachos').select('fecha, kg_origen, kg_destino, valor, estado, categoria_id, categoria_final_id')
      .not('estado', 'in', '(anulado,pendiente_guia)').gte('fecha', desde).lte('fecha', hasta)),
    q(supa.from('traslados').select('fecha, kg, kg_lampa, cert_folio, estado').gte('fecha', desde).lte('fecha', hasta)),
    q(supa.from('estados_pago').select('folio, numero, periodo, estado, total, generado_el, firmado_el, presentado_el, factura_fecha, pago_fecha, pago_monto')
      .like('periodo', `${anio}-%`).order('periodo')),
    q(supa.from('programa').select('estado, ton_estimadas, ton_reales').eq('anio', anio)),
    q(supa.from('categorias').select('id, nombre')),
  ]);
  const enPeriodo = (p) => (x) => x.fecha >= p.desde && x.fecha <= p.hasta;

  const serie = periodos.map((p) => {
    const d = desp.filter(enPeriodo(p));
    const t = tras.filter(enPeriodo(p));
    return {
      periodo: p.periodo, etiqueta: p.etiqueta, nombre: p.nombre, desde: p.desde, hasta: p.hasta,
      guias: d.length,
      kg_patios: d.reduce((a, x) => a + num(x.kg_origen), 0),
      kg_lanegra: d.reduce((a, x) => a + num(x.kg_destino), 0),
      valor: d.reduce((a, x) => a + num(x.valor), 0),
      kg_lampa: t.reduce((a, x) => a + num(x.kg_lampa), 0),
      certificados: t.filter((x) => x.cert_folio).length,
    };
  });
  const i = periodos.findIndex((p) => p.periodo === sel.periodo);
  const actual = serie[i];
  const anterior = i > 0 ? serie[i - 1] : null;
  const delta = (k) => (anterior && anterior[k] ? redondear(((actual[k] - anterior[k]) / anterior[k]) * 100) : null);
  // Acumulado del año: hasta el período elegido inclusive.
  const ytd = serie.slice(0, i + 1).reduce((a, s) => ({
    guias: a.guias + s.guias, kg_patios: a.kg_patios + s.kg_patios, kg_lanegra: a.kg_lanegra + s.kg_lanegra,
    valor: a.valor + s.valor, kg_lampa: a.kg_lampa + s.kg_lampa, certificados: a.certificados + s.certificados,
  }), { guias: 0, kg_patios: 0, kg_lanegra: 0, valor: 0, kg_lampa: 0, certificados: 0 });

  // Cartera de estados de pago del año, por estado del ciclo.
  const ORDEN_EP = ['generado', 'en_revision', 'con_ajustes', 'firmado', 'facturado', 'pagado', 'conciliado'];
  const NOMBRE_EP = { generado: 'Generado', en_revision: 'En revisión', con_ajustes: 'Con ajustes', firmado: 'Firmado', facturado: 'Facturado', pagado: 'Pagado', conciliado: 'Conciliado' };
  const cartera = ORDEN_EP.map((e) => {
    const x = eps.filter((ep) => ep.estado === e);
    return { estado: e, nombre: NOMBRE_EP[e], n: x.length, monto: x.reduce((a, ep) => a + num(ep.total), 0) };
  });
  const firmados = eps.filter((ep) => ep.firmado_el);
  const pagados = eps.filter((ep) => ep.pago_fecha && ep.factura_fecha);
  const diasPago = pagados.map((ep) => dias(ep.factura_fecha, ep.pago_fecha));
  const ciclo = {
    eps: eps.length,
    dias_generacion_firma: redondear(promedio(firmados.map((ep) => dias(ep.generado_el, ep.firmado_el)))),
    dias_firma_factura: redondear(promedio(eps.filter((ep) => ep.firmado_el && ep.factura_fecha).map((ep) => dias(ep.firmado_el, ep.factura_fecha)))),
    dias_factura_pago: redondear(promedio(diasPago)),
    pagos: pagados.length,
    pagos_en_plazo: diasPago.filter((d) => d <= 15).length,
    monto_firmado: firmados.reduce((a, ep) => a + num(ep.total), 0),
    monto_conciliado: eps.filter((ep) => ep.estado === 'conciliado').reduce((a, ep) => a + num(ep.total), 0),
  };

  // Calidad de la operación en el período elegido.
  const dSel = desp.filter(enPeriodo(sel));
  const recibidas = dSel.filter((x) => x.kg_destino != null && num(x.kg_origen) > 0);
  const progVivo = prog.filter((p) => p.estado !== 'cancelado');
  const calidad = {
    recepcionadas: recibidas.length,
    dif_promedio_pct: redondear(promedio(recibidas.map((x) => Math.abs((num(x.kg_destino) - num(x.kg_origen)) / num(x.kg_origen)) * 100)), 2),
    observadas: dSel.filter((x) => x.estado === 'observado').length,
    en_transito: dSel.filter((x) => x.estado === 'en_transito').length,
    programa_planificadas: progVivo.length,
    programa_ejecutadas: progVivo.filter((p) => p.estado === 'ejecutado').length,
  };

  // Kilos y valor por categoría en el período elegido (categoría final si se reclasificó).
  const nombreCat = new Map(cats.map((c) => [c.id, c.nombre]));
  const porCat = new Map();
  for (const x of dSel) {
    const id = x.categoria_final_id ?? x.categoria_id;
    const c = porCat.get(id) ?? { categoria: nombreCat.get(id) ?? '—', guias: 0, kg_patios: 0, kg_lanegra: 0, valor: 0 };
    c.guias++; c.kg_patios += num(x.kg_origen); c.kg_lanegra += num(x.kg_destino); c.valor += num(x.valor);
    porCat.set(id, c);
  }
  const categorias = [...porCat.values()].sort((a, b) => b.kg_lanegra - a.kg_lanegra);

  return {
    actual: { ...actual, delta_kg_patios: delta('kg_patios'), delta_kg_lanegra: delta('kg_lanegra'), delta_valor: delta('valor') },
    anterior, ytd, serie, cartera, ciclo, calidad, categorias,
    eps: eps.map((ep) => ({ folio: ep.folio, numero: ep.numero, periodo: ep.periodo, estado: NOMBRE_EP[ep.estado] ?? ep.estado, total: num(ep.total),
      generado_el: ep.generado_el?.slice(0, 10) ?? null, firmado_el: ep.firmado_el?.slice(0, 10) ?? null,
      factura_fecha: ep.factura_fecha, pago_fecha: ep.pago_fecha, pago_monto: ep.pago_monto == null ? null : num(ep.pago_monto) })),
  };
}

/* ============================ obsoletos ============================ */

async function obsoletos(anio) {
  if (!tiene.obsoletos) return null;
  const desde = `${anio}-01-01`, hasta = `${anio}-12-31`;
  const [comps, pubs, ofertas, adjs, compradores] = await Promise.all([
    q(supa.from('componentes').select('estado, cant_comprometida')),
    q(supa.from('publicaciones').select('id, componente_id, publicado_el, cerrada_el, estado, plazo_dias, plazo_ampliado_dias')
      .gte('publicado_el', desde).lte('publicado_el', hasta)),
    q(supa.from('ofertas').select('id, publicacion_id, comprador_id, moneda, monto, monto_usd, creado_el')),
    q(supa.from('adjudicaciones').select('id, oferta_id, comprador_id, monto, comision_monto, estado, creado_el, pago_el, entregado_el, cert_folio')
      .gte('creado_el', `${desde}T00:00:00Z`).lte('creado_el', `${hasta}T23:59:59Z`)),
    q(supa.from('compradores').select('id, dd_estado')),
  ]);

  const ORDEN_INV = ['por_identificar', 'planificado', 'publicado', 'adjudicado', 'entregado'];
  const NOMBRE_INV = { por_identificar: 'Por identificar', planificado: 'Confirmado en terreno', publicado: 'Publicado', adjudicado: 'Adjudicado', entregado: 'Entregado', no_encontrado: 'No encontrado', chatarra: 'Convertido a chatarra' };
  const cuenta = (e) => { const x = comps.filter((c) => c.estado === e); return { estado: e, nombre: NOMBRE_INV[e], materiales: x.length, unidades: x.reduce((a, c) => a + (num(c.cant_comprometida) || 1), 0) }; };
  const inventario = { etapas: ORDEN_INV.map(cuenta), no_encontrado: cuenta('no_encontrado'), chatarra: cuenta('chatarra'),
    materiales: comps.length, unidades: comps.reduce((a, c) => a + (num(c.cant_comprometida) || 1), 0) };

  const cerradas = pubs.filter((p) => ['adjudicada', 'convertida', 'cancelada'].includes(p.estado));
  const adjudicadas = pubs.filter((p) => p.estado === 'adjudicada');
  const diasAdj = adjudicadas.map((p) => dias(p.publicado_el, p.cerrada_el?.slice(0, 10)));
  const publicaciones = {
    total: pubs.length, activas: pubs.filter((p) => p.estado === 'activa').length, cerradas: cerradas.length,
    adjudicadas: adjudicadas.length, convertidas: pubs.filter((p) => p.estado === 'convertida').length, canceladas: pubs.filter((p) => p.estado === 'cancelada').length,
    tasa_adjudicacion: cerradas.length ? redondear((adjudicadas.length / cerradas.length) * 100) : null,
    tasa_conversion: cerradas.length ? redondear((pubs.filter((p) => p.estado === 'convertida').length / cerradas.length) * 100) : null,
    dias_promedio_adjudicacion: redondear(promedio(diasAdj)),
    adjudicadas_en_plazo: diasAdj.filter((d) => d != null && d <= 15).length,
  };

  // Ingresos en USD: la oferta ganadora guarda su moneda; en pesos se usa el
  // equivalente en dólares congelado al ofertar.
  const ofertaDe = new Map(ofertas.map((o) => [o.id, o]));
  const usdDe = (a) => { const o = ofertaDe.get(a.oferta_id); return o?.moneda === 'CLP' ? num(o.monto_usd) : num(a.monto); };
  const ingresos = {
    adjudicaciones: adjs.length,
    usd: adjs.reduce((a, x) => a + usdDe(x), 0),
    comision_usd: adjs.reduce((a, x) => a + num(x.comision_monto), 0),
    pagadas: adjs.filter((x) => x.pago_el).length, entregadas: adjs.filter((x) => x.entregado_el).length,
    dias_promedio_pago: redondear(promedio(adjs.map((x) => dias(x.creado_el, x.pago_el)))),
    dias_promedio_retiro: redondear(promedio(adjs.map((x) => dias(x.pago_el, x.entregado_el)))),
  };

  const pubsAnio = new Set(pubs.map((p) => p.id));
  const ofertasAnio = ofertas.filter((o) => pubsAnio.has(o.publicacion_id));
  const conOfertas = new Set(ofertas.map((o) => o.comprador_id));
  const compradoresR = {
    total: compradores.length, dd_aprobada: compradores.filter((c) => c.dd_estado === 'aprobada').length,
    dd_pendiente: compradores.filter((c) => c.dd_estado === 'pendiente').length,
    con_ofertas: compradores.filter((c) => conOfertas.has(c.id)).length,
    ofertas: ofertasAnio.length,
    ofertas_por_publicacion: pubs.length ? redondear(ofertasAnio.length / pubs.length) : null,
  };

  const mes = (iso) => (iso ? Number(String(iso).slice(5, 7)) - 1 : null);
  const serie = MES_CORTO.map((etiqueta, m) => {
    const c = cerradas.filter((p) => mes(p.cerrada_el) === m);
    const a = adjs.filter((x) => mes(x.creado_el) === m);
    return {
      mes: `${anio}-${String(m + 1).padStart(2, '0')}`, etiqueta, nombre: `${MESES[m]} ${anio}`,
      adjudicadas: c.filter((p) => p.estado === 'adjudicada').length, convertidas: c.filter((p) => p.estado === 'convertida').length,
      canceladas: c.filter((p) => p.estado === 'cancelada').length, publicadas: pubs.filter((p) => mes(p.publicado_el) === m).length,
      usd: a.reduce((s, x) => s + usdDe(x), 0), comision_usd: a.reduce((s, x) => s + num(x.comision_monto), 0),
    };
  });

  return {
    inventario, publicaciones, ingresos, compradores: compradoresR, serie,
    adjudicaciones: adjs.map((a) => ({ cert_folio: a.cert_folio, fecha: a.creado_el?.slice(0, 10), estado: a.estado, usd: usdDe(a), comision_usd: num(a.comision_monto),
      pago_el: a.pago_el?.slice(0, 10) ?? null, entregado_el: a.entregado_el?.slice(0, 10) ?? null })),
    lista_publicaciones: pubs.map((p) => ({ publicado_el: p.publicado_el, cerrada_el: p.cerrada_el?.slice(0, 10) ?? null, estado: p.estado,
      plazo: num(p.plazo_dias) + num(p.plazo_ampliado_dias), dias: dias(p.publicado_el, p.cerrada_el?.slice(0, 10) ?? hoy()) == null ? null : Math.round(dias(p.publicado_el, p.cerrada_el?.slice(0, 10) ?? hoy())) })),
  };
}

/* ============================ cálculo común ============================ */

async function calcular(rol, query) {
  const cfg = await contrato();
  const corte = Number(cfg.dia_corte) || 20;
  const vigente = periodoEP(corte);
  const anioPedido = Number(query.anio);
  const anio = anioPedido >= 2020 && anioPedido <= 2100 ? anioPedido : Number(vigente.periodo.slice(0, 4));
  const periodos = periodosDelAnio(anio, corte);
  const sel = periodos.find((p) => p.periodo === String(query.periodo || ''))
    ?? periodos.find((p) => p.periodo === vigente.periodo)
    ?? periodos[anio < Number(vigente.periodo.slice(0, 4)) ? 11 : 0];
  return {
    anio, corte, periodo: sel, periodos, vigente: vigente.periodo,
    chatarra: veChatarra(rol) ? await chatarra(anio, periodos, sel) : null,
    obsoletos: veObsoletos(rol) ? await obsoletos(anio) : null,
  };
}

r.get('/indicadores', auth(...ROLES), ah(async (req, res) => {
  res.json(await calcular(req.user.role, req.query));
}));

/* ============================ Excel ============================ */

const fila = (hoja, valores, negrita = false) => { const row = hoja.addRow(valores); if (negrita) row.font = { bold: true }; return row; };
const encabezado = (hoja, titulos) => {
  const row = hoja.addRow(titulos);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF232930' } }; });
  hoja.columns.forEach((col) => { col.width = Math.max(col.width ?? 0, 16); });
};
const CLP = '"$"#,##0';
const KG = '#,##0';
const USD = '"US$"#,##0.00';

function libroChatarra(d, info) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GEA · Minera Escondida';
  const res = wb.addWorksheet('Resumen');
  res.columns = [{ width: 44 }, { width: 22 }, { width: 22 }];
  fila(res, [`Indicadores del proceso de chatarra · ${info.periodo.nombre}`], true);
  fila(res, [`Período ${info.periodo.desde} → ${info.periodo.hasta} · corte el día ${info.corte} · generado el ${hoy()}`]);
  fila(res, []);
  encabezado(res, ['Indicador', 'Período', 'Acumulado del año']);
  const a = d.actual, y = d.ytd;
  for (const [k, p, yv, f] of [
    ['Guías despachadas', a.guias, y.guias, '#,##0'], ['Kg despachados desde patios MEL', a.kg_patios, y.kg_patios, KG],
    ['Kg recepcionados en La Negra', a.kg_lanegra, y.kg_lanegra, KG], ['Valorizado (CLP)', a.valor, y.valor, CLP],
    ['Kg recibidos en Lampa', a.kg_lampa, y.kg_lampa, KG], ['Certificados de disposición final', a.certificados, y.certificados, '#,##0'],
  ]) { const row = fila(res, [k, p, yv]); row.getCell(2).numFmt = f; row.getCell(3).numFmt = f; }
  fila(res, []);
  encabezado(res, ['Ciclo del estado de pago (año)', 'Valor', '']);
  const c = d.ciclo;
  fila(res, ['Estados de pago del año', c.eps]);
  fila(res, ['Días promedio generación → firma', c.dias_generacion_firma ?? '—']);
  fila(res, ['Días promedio firma → factura', c.dias_firma_factura ?? '—']);
  fila(res, ['Días promedio factura → pago', c.dias_factura_pago ?? '—']);
  fila(res, ['Pagos dentro de 15 días', c.pagos ? `${c.pagos_en_plazo} de ${c.pagos}` : '—']);
  fila(res, ['Monto firmado (CLP)', c.monto_firmado]).getCell(2).numFmt = CLP;
  fila(res, ['Monto conciliado (CLP)', c.monto_conciliado]).getCell(2).numFmt = CLP;
  fila(res, []);
  encabezado(res, ['Calidad de la operación (período)', 'Valor', '']);
  const q2 = d.calidad;
  fila(res, ['Recepciones en La Negra', q2.recepcionadas]);
  fila(res, ['Diferencia promedio de peso MEL vs La Negra (%)', q2.dif_promedio_pct ?? '—']);
  fila(res, ['Guías observadas', q2.observadas]);
  fila(res, ['Guías en tránsito', q2.en_transito]);
  fila(res, ['Programa de limpieza ejecutado (año)', q2.programa_planificadas ? `${q2.programa_ejecutadas} de ${q2.programa_planificadas}` : '—']);

  const s = wb.addWorksheet('Por período');
  encabezado(s, ['Período', 'Desde', 'Hasta', 'Guías', 'Kg patios MEL', 'Kg La Negra', 'Valorizado (CLP)', 'Kg Lampa', 'Certificados']);
  for (const x of d.serie) {
    const row = fila(s, [x.nombre, x.desde, x.hasta, x.guias, x.kg_patios, x.kg_lanegra, x.valor, x.kg_lampa, x.certificados]);
    [5, 6, 8].forEach((i) => { row.getCell(i).numFmt = KG; }); row.getCell(7).numFmt = CLP;
  }
  const cat = wb.addWorksheet('Categorías del período');
  encabezado(cat, ['Categoría', 'Guías', 'Kg patios MEL', 'Kg La Negra', 'Valorizado (CLP)']);
  for (const x of d.categorias) { const row = fila(cat, [x.categoria, x.guias, x.kg_patios, x.kg_lanegra, x.valor]); row.getCell(3).numFmt = KG; row.getCell(4).numFmt = KG; row.getCell(5).numFmt = CLP; }
  const ep = wb.addWorksheet('Estados de pago');
  encabezado(ep, ['Folio', 'N°', 'Período', 'Estado', 'Total (CLP)', 'Generado', 'Firmado', 'Factura', 'Pago', 'Monto pagado (CLP)']);
  for (const x of d.eps) { const row = fila(ep, [x.folio, x.numero, x.periodo, x.estado, x.total, x.generado_el, x.firmado_el, x.factura_fecha, x.pago_fecha, x.pago_monto]); row.getCell(5).numFmt = CLP; row.getCell(10).numFmt = CLP; }
  const car = wb.addWorksheet('Cartera EP');
  encabezado(car, ['Estado', 'Estados de pago', 'Monto (CLP)']);
  for (const x of d.cartera) fila(car, [x.nombre, x.n, x.monto]).getCell(3).numFmt = CLP;
  return wb;
}

function libroObsoletos(d, info) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'GEA · Minera Escondida';
  const res = wb.addWorksheet('Resumen');
  res.columns = [{ width: 44 }, { width: 22 }];
  fila(res, [`Indicadores de venta de obsoletos · ${info.anio}`], true);
  fila(res, [`Generado el ${hoy()}`]);
  fila(res, []);
  encabezado(res, ['Inventario', 'Materiales', 'Unidades']);
  for (const e of d.inventario.etapas) fila(res, [e.nombre, e.materiales, e.unidades]);
  fila(res, [d.inventario.no_encontrado.nombre, d.inventario.no_encontrado.materiales, d.inventario.no_encontrado.unidades]);
  fila(res, [d.inventario.chatarra.nombre, d.inventario.chatarra.materiales, d.inventario.chatarra.unidades]);
  fila(res, ['Total', d.inventario.materiales, d.inventario.unidades], true);
  fila(res, []);
  encabezado(res, [`Publicaciones ${info.anio}`, 'Valor', '']);
  const p = d.publicaciones;
  fila(res, ['Publicadas', p.total]); fila(res, ['Activas', p.activas]); fila(res, ['Cerradas', p.cerradas]);
  fila(res, ['Adjudicadas', p.adjudicadas]); fila(res, ['Convertidas a chatarra', p.convertidas]); fila(res, ['Canceladas', p.canceladas]);
  fila(res, ['Tasa de adjudicación (%)', p.tasa_adjudicacion ?? '—']); fila(res, ['Tasa de conversión a chatarra (%)', p.tasa_conversion ?? '—']);
  fila(res, ['Días promedio hasta adjudicar', p.dias_promedio_adjudicacion ?? '—']); fila(res, ['Adjudicadas dentro de 15 días', p.adjudicadas ? `${p.adjudicadas_en_plazo} de ${p.adjudicadas}` : '—']);
  fila(res, []);
  encabezado(res, [`Ingresos ${info.anio}`, 'Valor', '']);
  const g = d.ingresos;
  fila(res, ['Adjudicaciones', g.adjudicaciones]);
  fila(res, ['Ingresos por venta (USD)', g.usd]).getCell(2).numFmt = USD;
  fila(res, ['Comisión al vendor (USD)', g.comision_usd]).getCell(2).numFmt = USD;
  fila(res, ['Pagadas', g.pagadas]); fila(res, ['Entregadas', g.entregadas]);
  fila(res, ['Días promedio adjudicación → pago', g.dias_promedio_pago ?? '—']); fila(res, ['Días promedio pago → retiro', g.dias_promedio_retiro ?? '—']);
  fila(res, []);
  encabezado(res, ['Compradores', 'Valor', '']);
  const c = d.compradores;
  fila(res, ['Registrados', c.total]); fila(res, ['Con due diligence aprobada', c.dd_aprobada]); fila(res, ['Con due diligence pendiente', c.dd_pendiente]);
  fila(res, ['Con ofertas presentadas', c.con_ofertas]); fila(res, [`Ofertas recibidas ${info.anio}`, c.ofertas]); fila(res, ['Ofertas por publicación', c.ofertas_por_publicacion ?? '—']);

  const s = wb.addWorksheet('Por mes');
  encabezado(s, ['Mes', 'Publicadas', 'Adjudicadas', 'Convertidas', 'Canceladas', 'Ingresos (USD)', 'Comisión (USD)']);
  for (const x of d.serie) { const row = fila(s, [x.nombre, x.publicadas, x.adjudicadas, x.convertidas, x.canceladas, x.usd, x.comision_usd]); row.getCell(6).numFmt = USD; row.getCell(7).numFmt = USD; }
  const pu = wb.addWorksheet('Publicaciones');
  encabezado(pu, ['Publicada', 'Cerrada', 'Estado', 'Plazo (días)', 'Días transcurridos']);
  for (const x of d.lista_publicaciones) fila(pu, [x.publicado_el, x.cerrada_el, x.estado, x.plazo, x.dias]);
  const ad = wb.addWorksheet('Adjudicaciones');
  encabezado(ad, ['Certificado', 'Fecha', 'Estado', 'Monto (USD)', 'Comisión (USD)', 'Pago', 'Entrega']);
  for (const x of d.adjudicaciones) { const row = fila(ad, [x.cert_folio, x.fecha, x.estado, x.usd, x.comision_usd, x.pago_el, x.entregado_el]); row.getCell(4).numFmt = USD; row.getCell(5).numFmt = USD; }
  return wb;
}

r.get('/indicadores/excel', auth(...ROLES), ah(async (req, res) => {
  const pestana = req.query.pestana === 'obsoletos' ? 'obsoletos' : 'chatarra';
  if (pestana === 'chatarra' && !veChatarra(req.user.role)) return res.status(403).json({ error: 'Su perfil no ve los indicadores de chatarra' });
  if (pestana === 'obsoletos' && !veObsoletos(req.user.role)) return res.status(403).json({ error: 'Su perfil no ve los indicadores de obsoletos' });
  const info = await calcular(req.user.role, req.query);
  const datos = pestana === 'chatarra' ? info.chatarra : info.obsoletos;
  if (!datos) return res.status(503).json({ error: 'No hay datos para este reporte' });
  const wb = pestana === 'chatarra' ? libroChatarra(datos, info) : libroObsoletos(datos, info);
  const nombre = pestana === 'chatarra' ? `indicadores-chatarra-${info.periodo.periodo}.xlsx` : `indicadores-obsoletos-${info.anio}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

export default r;
