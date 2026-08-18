import { Router } from 'express';
import { supa, q, ah, hoy, diasDesde, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();
const M = (n) => Math.round(n / 100000) / 10; // CLP → millones con 1 decimal

async function mesVivo() {
  const mes = hoy().slice(0, 7);
  const [desp, adj] = await Promise.all([
    q(supa.from('despachos').select('kg_origen, kg_destino, categorias(precio_kg)')
      .gte('fecha', mes + '-01').lte('fecha', mes + '-31')),
    q(supa.from('adjudicaciones').select('fecha, ofertas(monto)')
      .gte('fecha', mes + '-01').lte('fecha', mes + '-31')),
  ]);
  const ton = desp.reduce((s, d) => s + (d.kg_destino ?? d.kg_origen), 0) / 1000;
  const ing = desp.reduce((s, d) => s + (d.kg_destino ?? d.kg_origen) * (d.categorias?.precio_kg ?? 0), 0);
  const obs = adj.reduce((s, a) => s + (a.ofertas?.monto ?? 0), 0);
  return { mes, tonelaje: Math.round(ton * 10) / 10, ing_chatarra: M(ing), ing_obsoletos: M(obs) };
}

async function serie() {
  const [hist, vivo] = await Promise.all([
    q(supa.from('historico_mensual').select('*').order('mes')),
    mesVivo(),
  ]);
  return hist.some((h) => h.mes === vivo.mes) ? hist : [...hist, vivo];
}

/* ---------- panel de control ---------- */
r.get('/panel', auth(), ah(async (_req, res) => {
  const vivo = await mesVivo();
  const [epPendArr, pubs, entregas, docs, ofertasMes, actividad, s] = await Promise.all([
    q(supa.from('estados_pago').select('*').eq('estado', 'en_aprobacion').order('periodo', { ascending: false }).limit(1)),
    q(supa.from('componentes').select('*').eq('estado', 'publicado')),
    q(supa.from('entregas').select('*, componentes(nombre)').eq('estado', 'sin_coordinacion')),
    q(supa.from('documentos').select('*').not('vencimiento', 'is', null)),
    q(supa.from('ofertas').select('id').gte('fecha', vivo.mes + '-01')),
    q(supa.from('auditoria').select('*').order('id', { ascending: false }).limit(5)),
    serie(),
  ]);
  const epPend = epPendArr[0];
  const porVencer = pubs.filter((p) => diasDesde(p.publicado_el) >= 13);

  const pendientes = [];
  if (epPend) pendientes.push({ tipo: 'warn', tag: 'Aprobación', texto: `Estado de pago ${epPend.folio} espera aprobación del Coordinador`, destino: 'estados' });
  porVencer.forEach((p) => pendientes.push({ tipo: 'bad', tag: 'Por vencer', texto: `Publicación ${p.nombre} en día ${diasDesde(p.publicado_el)} de 15`, destino: 'publicaciones' }));
  entregas.forEach((e) => pendientes.push({ tipo: 'info', tag: 'Entrega', texto: `Retiro adjudicado ${e.componentes?.nombre} sin coordinación (${diasDesde(e.adjudicado_el)} días)`, destino: 'inventario' }));
  docs.filter((d) => { const t = -diasDesde(d.vencimiento); return t >= 0 && t <= 30; })
    .forEach((d) => pendientes.push({ tipo: 'warn', tag: 'Documento', texto: `${d.archivo} vence en ${-diasDesde(d.vencimiento)} días`, destino: 'documental' }));

  res.json({
    kpis: {
      tonelaje_mes: vivo.tonelaje,
      ep_pendiente: epPend ? { folio: epPend.folio, total: epPend.total } : null,
      publicaciones: { activas: pubs.length, por_vencer: porVencer.length },
      ofertas_mes: ofertasMes.length,
    },
    serie: s,
    pendientes: pendientes.slice(0, 6),
    actividad: actividad.map((a) => ({ ...a, fecha: fmtFecha(a.fecha) })),
  });
}));

/* ---------- indicadores ---------- */
r.get('/indicadores/chatarra', auth('ito', 'coordinador', 'adminventa'), ah(async (_req, res) => {
  const [s, eps, pagos] = await Promise.all([
    serie(),
    q(supa.from('estados_pago').select('total, estado')),
    q(supa.from('pagos_vendor').select('monto')),
  ]);
  const suma = (estado) => eps.filter((e) => e.estado === estado).reduce((a, e) => a + e.total, 0);
  const aprobados = suma('aprobado');
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
  res.json({
    kpis: {
      tonelaje_ytd: Math.round(s.reduce((a, x) => a + Number(x.tonelaje), 0)),
      ingresos_ytd: Math.round(s.reduce((a, x) => a + Number(x.ing_chatarra), 0)),
      dias_prom_aprobacion: 6.2,
      pct_conciliado: aprobados ? Math.round((Math.min(pagado, aprobados) / aprobados) * 100) : 0,
    },
    serie: s,
    cartera: [
      { k: 'Conciliado', v: M(Math.min(pagado, aprobados)), tono: 'ok' },
      { k: 'Aprobado por conciliar', v: M(Math.max(0, aprobados - pagado)), tono: 'info' },
      { k: 'En aprobación', v: M(suma('en_aprobacion')), tono: 'warn' },
      { k: 'Rechazado / en ajuste', v: M(suma('rechazado')), tono: 'bad' },
    ],
  });
}));

r.get('/indicadores/obsoletos', auth('ito', 'coordinador', 'adminventa'), ah(async (_req, res) => {
  const [s, comps, adj] = await Promise.all([
    serie(),
    q(supa.from('componentes').select('estado')),
    q(supa.from('adjudicaciones').select('fecha, componentes(publicado_el)')),
  ]);
  const adjudicadas = adj.length;
  const convertidas = comps.filter((c) => c.estado === 'convertido').length;
  const cerradas = adjudicadas + convertidas;
  const tiempos = adj.filter((x) => x.componentes?.publicado_el)
    .map((x) => Math.max(1, Math.round((new Date(x.fecha) - new Date(x.componentes.publicado_el)) / 86400000)));
  const tMedio = tiempos.length ? Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10 : 9.4;
  res.json({
    kpis: {
      tiempo_medio: tMedio,
      tasa_adjudicacion: cerradas ? Math.round((adjudicadas / cerradas) * 100) : 0,
      pct_conversion: cerradas ? Math.round((convertidas / cerradas) * 100) : 0,
      ingresos_ytd: Math.round(s.reduce((a, x) => a + Number(x.ing_obsoletos), 0)),
    },
    resultado: [
      { k: 'Adjudicadas', v: adjudicadas, tono: 'ok' },
      { k: 'Convertidas a chatarra', v: convertidas, tono: 'bad' },
      { k: 'Publicadas activas', v: comps.filter((c) => c.estado === 'publicado').length, tono: 'info' },
    ],
    serie: s,
  });
}));

/* ---------- seguridad ---------- */
r.get('/auditoria', auth('coordinador'), ah(async (_req, res) => {
  const rows = await q(supa.from('auditoria').select('*').order('id', { ascending: false }).limit(100));
  res.json(rows.map((a) => ({ ...a, fecha: fmtFecha(a.fecha) })));
}));

const PERM = [
  ['Programa de limpieza', ['part', 'none', 'full', 'full', 'none', 'none']],
  ['Despachos y recepciones', ['part', 'part', 'full', 'full', 'none', 'none']],
  ['Estados de pago', ['none', 'part', 'full', 'full', 'none', 'none']],
  ['Repositorio documental', ['part', 'part', 'full', 'full', 'part', 'none']],
  ['Obsoletos y publicaciones', ['none', 'none', 'none', 'full', 'full', 'none']],
  ['Portal público / ofertas', ['none', 'none', 'none', 'full', 'full', 'part']],
  ['Indicadores', ['none', 'none', 'part', 'full', 'part', 'none']],
];
r.get('/seguridad/matriz', auth('coordinador'), (_req, res) => {
  res.json({ roles: ['Limpieza patios', 'Vendor', 'ITO', 'Coordinador', 'Adm. Venta Web', 'Comprador'], modulos: PERM });
});

export default r;
