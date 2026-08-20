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
  const [s, eps, pagos, desp, prog] = await Promise.all([
    serie(),
    q(supa.from('estados_pago').select('total, estado')),
    q(supa.from('pagos_vendor').select('monto')),
    q(supa.from('despachos').select('kg_origen, kg_destino, estado, categorias(nombre)')),
    q(supa.from('programa').select('est_ton, real_ton, estado')),
  ]);
  const suma = (estado) => eps.filter((e) => e.estado === estado).reduce((a, e) => a + e.total, 0);
  const aprobados = suma('aprobado');
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
  const tonYtd = Math.round(s.reduce((a, x) => a + Number(x.tonelaje), 0));
  const ingYtd = Math.round(s.reduce((a, x) => a + Number(x.ing_chatarra), 0));

  // Recepciones sin observación (diferencia de peso ≤ 2%)
  const recepcionadas = desp.filter((d) => d.kg_destino != null);
  const observadas = desp.filter((d) => d.estado === 'observado').length;
  const pctValidadas = recepcionadas.length
    ? Math.round(((recepcionadas.length - observadas) / recepcionadas.length) * 100) : 100;

  // Cumplimiento del programa de limpieza: tonelaje real vs. estimado en lo ejecutado
  const ejec = prog.filter((p) => p.estado === 'ejecutado');
  const estTon = ejec.reduce((a, p) => a + Number(p.est_ton), 0);
  const realTon = ejec.reduce((a, p) => a + Number(p.real_ton ?? 0), 0);
  const pctPrograma = estTon ? Math.round((realTon / estTon) * 100) : 0;

  // Mezcla de material despachado por categoría (toneladas)
  const mix = {};
  desp.forEach((d) => {
    const k = d.categorias?.nombre ?? 'Otros';
    mix[k] = (mix[k] || 0) + (d.kg_destino ?? d.kg_origen);
  });
  const TONOS = ['copper', 'info', 'ok', 'warn', 'neutral'];
  const porCategoria = Object.entries(mix).sort((a, b) => b[1] - a[1])
    .map(([k, v], i) => ({ k, v: Math.round(v / 100) / 10, tono: TONOS[i % TONOS.length] }));

  res.json({
    hero: {
      ingresos_ytd: ingYtd,
      tonelaje_ytd: tonYtd,
      por_conciliar: M(Math.max(0, aprobados - pagado) + suma('en_aprobacion')),
      pct_conciliado: aprobados ? Math.round((Math.min(pagado, aprobados) / aprobados) * 100) : 0,
    },
    kpis: {
      dias_prom_aprobacion: 6.2,
      precio_medio: tonYtd ? Math.round((ingYtd * 1e6) / (tonYtd * 1000)) : 0,
      pct_validadas: pctValidadas,
      pct_programa: pctPrograma,
      actividades: { ejecutadas: ejec.length, total: prog.length },
    },
    serie: s,
    por_categoria: porCategoria,
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
    q(supa.from('componentes').select('estado, valor_ref')),
    q(supa.from('adjudicaciones').select('fecha, ofertas(monto), componentes(publicado_el)')),
  ]);
  const adjudicadas = adj.length;
  const convertidas = comps.filter((c) => c.estado === 'convertido').length;
  const cerradas = adjudicadas + convertidas;
  const tiempos = adj.filter((x) => x.componentes?.publicado_el)
    .map((x) => Math.max(1, Math.round((new Date(x.fecha) - new Date(x.componentes.publicado_el)) / 86400000)));
  const tMedio = tiempos.length ? Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10 : 9.4;

  // Meta de enajenación: todo lo ingresado al programa 2026 debe salir (la cartera pendiente tiende a $0).
  // Vendido = ingresos por venta del año (serie histórica + mes vivo, coherente con el KPI YTD).
  // Convertido = valor referencial derivado a chatarra. Pendiente = componentes vivos aún sin gestionar.
  const vendido = Math.round(s.reduce((a, x) => a + Number(x.ing_obsoletos), 0) * 1e6);
  const vendidoVivo = adj.reduce((a, x) => a + (x.ofertas?.monto ?? 0), 0);
  const convertido = comps.filter((c) => c.estado === 'convertido').reduce((a, c) => a + c.valor_ref, 0);
  const pendiente = Math.max(0, comps.reduce((a, c) => a + c.valor_ref, 0) - vendidoVivo - convertido);
  const gestionado = vendido + convertido;
  const cartera = gestionado + pendiente;

  // Avance acumulado de ingresos por enajenación (M CLP)
  let acum = 0;
  const serieAcum = s.map((x) => ({ mes: x.mes, v: Math.round((acum += Number(x.ing_obsoletos)) * 10) / 10 }));

  res.json({
    kpis: {
      tiempo_medio: tMedio,
      tasa_adjudicacion: cerradas ? Math.round((adjudicadas / cerradas) * 100) : 0,
      pct_conversion: cerradas ? Math.round((convertidas / cerradas) * 100) : 0,
      ingresos_ytd: Math.round(s.reduce((a, x) => a + Number(x.ing_obsoletos), 0)),
    },
    meta: {
      cartera, vendido, convertido, gestionado, pendiente,
      pct_avance: cartera ? Math.round((gestionado / cartera) * 1000) / 10 : 0,
      unidades: {
        total: comps.length,
        gestionadas: adjudicadas + convertidas,
        pendientes: Math.max(0, comps.length - adjudicadas - convertidas),
      },
    },
    serie_acumulada: serieAcum,
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
