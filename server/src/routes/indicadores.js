import { Router } from 'express';
import { db, hoy, diasDesde } from '../db.js';
import { auth } from '../auth.js';

const r = Router();
const M = (n) => Math.round(n / 100000) / 10; // CLP → millones con 1 decimal

function mesVivo() {
  const mes = hoy().slice(0, 7);
  const ton = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(kg_destino,kg_origen)),0) AS kg FROM despachos WHERE substr(fecha,1,7)=?`).get(mes).kg / 1000;
  const ing = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(d.kg_destino,d.kg_origen)*c.precio_kg),0) AS v
    FROM despachos d JOIN categorias c ON c.id=d.categoria_id WHERE substr(d.fecha,1,7)=?`).get(mes).v;
  const obs = db.prepare(`
    SELECT COALESCE(SUM(o.monto),0) AS v FROM adjudicaciones a JOIN ofertas o ON o.id=a.oferta_id
    WHERE substr(a.fecha,1,7)=?`).get(mes).v;
  return { mes, tonelaje: Math.round(ton * 10) / 10, ing_chatarra: M(ing), ing_obsoletos: M(obs) };
}

function serie() {
  const hist = db.prepare('SELECT * FROM historico_mensual ORDER BY mes').all();
  const vivo = mesVivo();
  return hist.some((h) => h.mes === vivo.mes) ? hist : [...hist, vivo];
}

/* ---------- panel de control ---------- */
r.get('/panel', auth(), (_req, res) => {
  const vivo = mesVivo();
  const epPend = db.prepare("SELECT * FROM estados_pago WHERE estado='en_aprobacion' ORDER BY periodo DESC").get();
  const pubs = db.prepare("SELECT * FROM componentes WHERE estado='publicado'").all();
  const porVencer = pubs.filter((p) => diasDesde(p.publicado_el) >= 13);
  const ofertasMes = db.prepare('SELECT COUNT(*) AS n FROM ofertas WHERE substr(fecha,1,7)=?').get(vivo.mes).n;

  const pendientes = [];
  if (epPend) pendientes.push({ tipo: 'warn', tag: 'Aprobación', texto: `Estado de pago ${epPend.folio} espera aprobación del Coordinador`, destino: 'estados' });
  porVencer.forEach((p) => pendientes.push({ tipo: 'bad', tag: 'Por vencer', texto: `Publicación ${p.nombre} en día ${diasDesde(p.publicado_el)} de 15`, destino: 'publicaciones' }));
  db.prepare("SELECT e.*, c.nombre FROM entregas e JOIN componentes c ON c.id=e.componente_id WHERE e.estado='sin_coordinacion'").all()
    .forEach((e) => pendientes.push({ tipo: 'info', tag: 'Entrega', texto: `Retiro adjudicado ${e.nombre} sin coordinación (${diasDesde(e.adjudicado_el)} días)`, destino: 'inventario' }));
  db.prepare('SELECT * FROM documentos WHERE vencimiento IS NOT NULL').all()
    .filter((d) => { const t = -diasDesde(d.vencimiento); return t >= 0 && t <= 30; })
    .forEach((d) => pendientes.push({ tipo: 'warn', tag: 'Documento', texto: `${d.archivo} vence en ${-diasDesde(d.vencimiento)} días`, destino: 'documental' }));

  res.json({
    kpis: {
      tonelaje_mes: vivo.tonelaje,
      ep_pendiente: epPend ? { folio: epPend.folio, total: epPend.total } : null,
      publicaciones: { activas: pubs.length, por_vencer: porVencer.length },
      ofertas_mes: ofertasMes,
    },
    serie: serie(),
    pendientes: pendientes.slice(0, 6),
    actividad: db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 5').all(),
  });
});

/* ---------- indicadores ---------- */
r.get('/indicadores/chatarra', auth('ito', 'coordinador', 'adminventa'), (_req, res) => {
  const s = serie();
  const aprobados = db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM estados_pago WHERE estado='aprobado'").get().v;
  const pagado = db.prepare('SELECT COALESCE(SUM(monto),0) AS v FROM pagos_vendor').get().v;
  const enAprob = db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM estados_pago WHERE estado='en_aprobacion'").get().v;
  const rechazado = db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM estados_pago WHERE estado='rechazado'").get().v;
  res.json({
    kpis: {
      tonelaje_ytd: Math.round(s.reduce((a, x) => a + x.tonelaje, 0)),
      ingresos_ytd: Math.round(s.reduce((a, x) => a + x.ing_chatarra, 0)),
      dias_prom_aprobacion: 6.2,
      pct_conciliado: aprobados ? Math.round((Math.min(pagado, aprobados) / aprobados) * 100) : 0,
    },
    serie: s,
    cartera: [
      { k: 'Conciliado', v: M(Math.min(pagado, aprobados)), tono: 'ok' },
      { k: 'Aprobado por conciliar', v: M(Math.max(0, aprobados - pagado)), tono: 'info' },
      { k: 'En aprobación', v: M(enAprob), tono: 'warn' },
      { k: 'Rechazado / en ajuste', v: M(rechazado), tono: 'bad' },
    ],
  });
});

r.get('/indicadores/obsoletos', auth('ito', 'coordinador', 'adminventa'), (_req, res) => {
  const s = serie();
  const adjudicadas = db.prepare("SELECT COUNT(*) AS n FROM componentes WHERE estado='adjudicado'").get().n
    + db.prepare("SELECT COUNT(DISTINCT componente_id) AS n FROM adjudicaciones a JOIN componentes c ON c.id=a.componente_id WHERE c.estado NOT IN ('adjudicado')").get().n;
  const convertidas = db.prepare("SELECT COUNT(*) AS n FROM componentes WHERE estado='convertido'").get().n;
  const cerradas = adjudicadas + convertidas;
  const tiempos = db.prepare(`
    SELECT c.publicado_el, a.fecha FROM adjudicaciones a JOIN componentes c ON c.id=a.componente_id
    WHERE c.publicado_el IS NOT NULL`).all()
    .map((x) => Math.max(1, Math.round((new Date(x.fecha) - new Date(x.publicado_el)) / 86400000)));
  const tMedio = tiempos.length ? Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10 : null;
  const ingresosYtd = Math.round(s.reduce((a, x) => a + x.ing_obsoletos, 0));
  res.json({
    kpis: {
      tiempo_medio: tMedio ?? 9.4,
      tasa_adjudicacion: cerradas ? Math.round((adjudicadas / cerradas) * 100) : 0,
      pct_conversion: cerradas ? Math.round((convertidas / cerradas) * 100) : 0,
      ingresos_ytd: ingresosYtd,
    },
    resultado: [
      { k: 'Adjudicadas', v: adjudicadas, tono: 'ok' },
      { k: 'Convertidas a chatarra', v: convertidas, tono: 'bad' },
      { k: 'Publicadas activas', v: db.prepare("SELECT COUNT(*) AS n FROM componentes WHERE estado='publicado'").get().n, tono: 'info' },
    ],
    serie: s,
  });
});

/* ---------- seguridad ---------- */
r.get('/auditoria', auth('coordinador'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 100').all());
});

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
