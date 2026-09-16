// Cuadratura semanal del ITO: cruza los movimientos de la semana entre
// MEL (guías de despacho), La Negra (recepciones) y Lampa (traslados
// recepcionados), por categoría. El cierre guarda un snapshot inmutable.
import { Router } from 'express';
import { supa, q, ah, audit, semanaISO } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { valorDolar } from '../dolar.js';

// Sobre este porcentaje, los descuentos de una categoría dejan de ser ruido
// y pasan a ser algo que la semana tiene que explicar antes de cerrarse.
const UMBRAL_DESCUENTO_PCT = 5;

const r = Router();

// Lunes y domingo de una semana ISO.
function rangoSemana(anio, semana) {
  const simple = new Date(Date.UTC(anio, 0, 4)); // 4-ene siempre cae en la semana 1
  const day = simple.getUTCDay() || 7;
  const lunes1 = new Date(simple);
  lunes1.setUTCDate(simple.getUTCDate() - day + 1);
  const ini = new Date(lunes1);
  ini.setUTCDate(lunes1.getUTCDate() + (semana - 1) * 7);
  const fin = new Date(ini);
  fin.setUTCDate(ini.getUTCDate() + 6);
  const f = (d) => d.toISOString().slice(0, 10);
  return { desde: f(ini), hasta: f(fin) };
}

// Descuentos por ítem de las guías de la semana, agrupados por guía.
async function descuentosDeSemana(ids) {
  if (!tiene.desc_item || !ids.length) return new Map();
  const rows = await q(supa.from('despacho_descuentos').select('*').in('despacho_id', ids));
  const m = new Map();
  for (const x of rows) {
    if (!m.has(x.despacho_id)) m.set(x.despacho_id, []);
    m.get(x.despacho_id).push(x);
  }
  return m;
}

async function calcular(anio, semana) {
  const { desde, hasta } = rangoSemana(anio, semana);
  const [cats, precios, despTodos, tras, dolHoy] = await Promise.all([
    q(supa.from('categorias').select('*').order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    // `*` y no una lista: así el folio de MEL entra cuando la columna existe,
    // sin romper la consulta mientras la migración esté pendiente.
    q(supa.from('despachos').select('*').gte('fecha', desde).lte('fecha', hasta)),
    q(supa.from('traslados').select('categoria_id, kg, kg_lampa, estado')
      .gte('fecha', desde).lte('fecha', hasta)),
    valorDolar().catch(() => null),
  ]);
  let desp = despTodos;
  const dolarRef = dolHoy?.valor ?? null;
  // Una guía anulada no existe para la cuadratura: queda en el libro con su
  // motivo, pero no suma kilos, ni guías, ni montos.
  const anuladas = desp.filter((d) => d.estado === 'anulado');
  desp = desp.filter((d) => d.estado !== 'anulado');

  const descuentos = await descuentosDeSemana(desp.map((d) => d.id));

  // Lo que MEL despachó y La Negra aún no recepciona no tiene precio congelado.
  // Para poder cuadrar montos igual que kilos, esas guías se valorizan con el
  // precio que regía a su fecha; la fila avisa cuántas van estimadas así.
  // Siempre expresado en pesos por KILO, que es la unidad con la que la
  // cuadratura multiplica los kilos de cada fila.
  const precioRef = (catId, fecha) => {
    const p = precios.find((x) => x.categoria_id === catId && x.vigente_desde <= fecha);
    if (!p) return 0;
    // El contrato va en USD por tonelada: a pesos por kilo con el último dólar.
    if (p.precio_usd_tm != null) return (Number(p.precio_usd_tm) / 1000) * (dolarRef ?? 0);
    if (p.precio_usd != null) return Number(p.precio_usd) * (dolarRef ?? 0);
    return Number(p.precio_kg ?? 0);
  };
  // Precio de una guía en pesos por kilo. Manda el que quedó congelado con
  // ella; si todavía no tiene ninguno, el de referencia de su fecha.
  const precioPesosKg = (d) =>
    d.precio_usd_tm != null && d.dolar != null ? (Number(d.precio_usd_tm) / 1000) * Number(d.dolar)
    : d.precio_usd != null && d.dolar != null ? Number(d.precio_usd) * Number(d.dolar)
    : d.precio_kg != null ? Number(d.precio_kg)
    : precioRef(d.categoria_id, d.fecha);

  // Valor que habría tenido la recepción sin descuentos: la diferencia contra
  // lo efectivamente valorizado es, exactamente, lo que costaron los descuentos.
  const brutoDe = (d) => {
    if (d.kg_destino == null) return 0;
    if (d.precio_usd_tm != null && d.dolar != null) {
      return Math.round((Number(d.kg_destino) / 1000) * Number(d.precio_usd_tm) * Number(d.dolar));
    }
    if (d.precio_usd != null && d.dolar != null) return Math.round(Number(d.kg_destino) * Number(d.precio_usd) * Number(d.dolar));
    return Math.round(Number(d.kg_destino) * Number(d.precio_kg ?? 0));
  };

  const detalle = cats.map((c) => {
    // Las guías despachadas se cuentan por la categoría declarada en origen y
    // las recepcionadas por la categoría final: si hubo reclasificación, la
    // diferencia entre ambas columnas es justamente lo que hay que explicar.
    const dMel = desp.filter((d) => d.categoria_id === c.id);
    const dLN = desp.filter((d) => (d.categoria_final_id ?? d.categoria_id) === c.id && d.kg_destino != null);
    const tLP = tras.filter((t) => t.categoria_id === c.id);
    const kgMel = dMel.reduce((a, d) => a + Number(d.kg_origen), 0);
    const kgLN = dLN.reduce((a, d) => a + Number(d.kg_destino), 0);
    const kgLPd = tLP.reduce((a, t) => a + Number(t.kg), 0);
    const kgLPr = tLP.reduce((a, t) => a + Number(t.kg_lampa ?? 0), 0);
    const montoMel = dMel.reduce((a, d) => a + Number(d.kg_origen) * precioPesosKg(d), 0);
    const montoLN = dLN.reduce((a, d) => a + Number(d.valor ?? 0), 0);

    // Guía por guía: de dónde nace cada diferencia de la fila. Una guía
    // reclasificada aparece en dos categorías —en una aporta al lado MEL y en
    // la otra al lado La Negra—, y `lado` es lo que lo explica.
    const nombreCat = (id) => cats.find((x) => x.id === id)?.nombre ?? '—';
    const guias = [...new Set([...dMel, ...dLN])].map((d) => {
      const enMel = d.categoria_id === c.id;
      const enLN = (d.categoria_final_id ?? d.categoria_id) === c.id && d.kg_destino != null;
      // El precio congelado manda; si la guía viene en dólares se lleva a pesos
      // con el tipo de cambio que se congeló con ella.
      const precio = precioPesosKg(d);
      const kgO = Number(d.kg_origen);
      const kgD = d.kg_destino == null ? null : Number(d.kg_destino);
      const desc = descuentos.get(d.id) ?? [];
      return {
        guia: d.guia, guia_mel: d.guia_mel ?? null, fecha: d.fecha, estado: d.estado,
        descuentos: desc.map((x) => ({ tipo: x.tipo, valor: Number(x.valor), glosa: x.glosa })),
        desc_monto: enLN && desc.length ? Math.round(brutoDe(d) - Number(d.valor ?? 0)) : null,
        precio_usd: d.precio_usd == null ? null : Number(d.precio_usd),
        precio_usd_tm: d.precio_usd_tm == null ? null : Number(d.precio_usd_tm),
        con_madera: d.con_madera ?? null,
        dolar: d.dolar == null ? null : Number(d.dolar),
        categoria_origen: nombreCat(d.categoria_id),
        categoria_final: d.categoria_final_id ? nombreCat(d.categoria_final_id) : null,
        kg_origen: enMel ? kgO : null,
        kg_destino: enLN ? kgD : null,
        dif_kg: kgD == null ? null : Math.round((kgD - kgO) * 10) / 10,
        dif_pct: kgD == null ? null : Math.round(((kgD - kgO) / kgO) * 10000) / 100,
        precio_kg: precio || null,
        precio_estimado: d.precio_kg == null && d.precio_usd == null && d.precio_usd_tm == null,
        monto_mel: enMel ? Math.round(kgO * precio) : null,
        monto_lanegra: enLN ? Math.round(Number(d.valor ?? 0)) : null,
        lado: enMel && enLN ? 'ambos' : enMel ? 'mel' : 'lanegra',
      };
    }).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || (a.guia || '').localeCompare(b.guia || ''));

    return {
      categoria: c.nombre,
      guias,
      guias_mel: dMel.length,
      guias_recepcionadas: dLN.length,
      dif_guias: dLN.length - dMel.length,
      kg_mel: kgMel, kg_lanegra: kgLN, kg_lampa_desp: kgLPd, kg_lampa_rec: kgLPr,
      dif_kg: Math.round((kgLN - kgMel) * 10) / 10,
      dif_pct: kgMel ? Math.round(((kgLN - kgMel) / kgMel) * 10000) / 100 : null,
      monto_mel: Math.round(montoMel),
      monto_lanegra: Math.round(montoLN),
      dif_monto: Math.round(montoLN - montoMel),
      // Guías del lado MEL valorizadas con precio de referencia, no congelado.
      montos_estimados: dMel.filter((d) => d.precio_kg == null && d.precio_usd == null && d.precio_usd_tm == null).length,
      monto: Math.round(montoLN),   // compatibilidad con cierres anteriores
      pendientes_transito: dMel.filter((d) => d.estado === 'en_transito').length,
      observados: dMel.filter((d) => d.estado === 'observado').length,
      // descuentos por ítem aplicados en la recepción
      ...(() => {
        const conDesc = dLN.filter((d) => (descuentos.get(d.id) ?? []).length);
        const todos = conDesc.flatMap((d) => descuentos.get(d.id));
        const bruto = dLN.reduce((a, d) => a + brutoDe(d), 0);
        const monto = bruto - montoLN;
        return {
          desc_guias: conDesc.length,
          desc_kg: todos.filter((x) => x.tipo === 'kg').reduce((a, x) => a + Number(x.valor), 0),
          desc_usd: todos.filter((x) => x.tipo === 'usd').reduce((a, x) => a + Number(x.valor), 0),
          desc_clp: todos.filter((x) => x.tipo === 'clp').reduce((a, x) => a + Number(x.valor), 0),
          desc_monto: Math.round(monto),
          // cuánto pesan los descuentos sobre lo que se habría facturado
          desc_pct: bruto > 0 ? Math.round((monto / bruto) * 10000) / 100 : null,
          bruto_lanegra: Math.round(bruto),
        };
      })(),
    };
  }).filter((x) => x.kg_mel || x.kg_lanegra || x.kg_lampa_desp);

  // Lo que la semana tiene que explicar, dicho una vez y en un solo lugar.
  const alertas = [];
  for (const x of detalle) {
    if (x.dif_pct != null && Math.abs(x.dif_pct) > 2) {
      alertas.push({ tono: 'bad', categoria: x.categoria, texto: `Diferencia de peso de ${x.dif_pct.toFixed(2)}% entre MEL y La Negra.` });
    }
    if (x.observados) {
      alertas.push({ tono: 'warn', categoria: x.categoria, texto: `${x.observados} recepción(es) observada(s) sin resolver.` });
    }
    if (x.desc_pct != null && x.desc_pct >= UMBRAL_DESCUENTO_PCT) {
      alertas.push({
        tono: 'bad', categoria: x.categoria,
        texto: `Los descuentos alcanzan el ${x.desc_pct.toFixed(2)}% de lo valorizado (${x.desc_guias} guía(s)).`,
      });
    } else if (x.desc_guias) {
      alertas.push({
        tono: 'warn', categoria: x.categoria,
        texto: `${x.desc_guias} guía(s) con descuentos aplicados en la recepción.`,
      });
    }
    if (x.dif_guias) {
      alertas.push({ tono: 'warn', categoria: x.categoria, texto: `Faltan ${Math.abs(x.dif_guias)} guía(s) por recepcionar.` });
    }
  }
  if (anuladas.length) {
    alertas.push({
      tono: 'info', categoria: null,
      texto: `${anuladas.length} guía(s) anulada(s) en la semana: ${anuladas.map((d) => d.guia).join(', ')}. No suman a la cuadratura.`,
    });
  }

  return {
    desde, hasta, detalle, alertas,
    anuladas: anuladas.map((d) => ({
      guia: d.guia, fecha: d.fecha, motivo: d.motivo_anulacion ?? null, anulada_por: d.anulada_por ?? null,
    })),
  };
}

r.get('/cuadratura', auth('ito', 'coordinador'), ah(async (req, res) => {
  const actual = semanaISO();
  const anio = Number(req.query.anio || actual.anio);
  const semana = Number(req.query.semana || actual.semana);
  const [{ desde, hasta, detalle, alertas, anuladas }, cerradas] = await Promise.all([
    calcular(anio, semana),
    q(supa.from('cuadraturas').select('*').order('anio', { ascending: false }).order('semana', { ascending: false }).limit(12)),
  ]);
  const cerrada = cerradas.find((c) => c.anio === anio && c.semana === semana) ?? null;
  res.json({ anio, semana, actual, desde, hasta, detalle, alertas, anuladas, cerrada, historico: cerradas });
}));

// Cierra la cuadratura de la semana con el snapshot calculado en ese momento.
r.post('/cuadratura/cerrar', auth('ito', 'coordinador'), ah(async (req, res) => {
  const { anio, semana, observacion } = req.body || {};
  if (!anio || !semana) return res.status(400).json({ error: 'Año y semana son obligatorios' });
  const { detalle } = await calcular(Number(anio), Number(semana));
  if (!detalle.length) return res.status(400).json({ error: 'La semana no registra movimientos que cuadrar' });

  // Un descuento fuerte es una diferencia como cualquier otra: si se llevó más
  // del umbral de lo valorizado, la semana no se cierra sin explicarlo.
  const descFuerte = detalle.some((x) => x.desc_pct != null && x.desc_pct >= UMBRAL_DESCUENTO_PCT);
  const conDif = descFuerte || detalle.some((x) => x.observados > 0 || (x.dif_pct != null && Math.abs(x.dif_pct) > 2));
  if (conDif && !(observacion || '').trim()) {
    return res.status(400).json({
      error: descFuerte
        ? `Hay categorías con descuentos sobre el ${UMBRAL_DESCUENTO_PCT}% de lo valorizado: la observación es obligatoria`
        : 'Hay diferencias sobre el 2% u observados: la observación es obligatoria',
    });
  }
  const row = await q(supa.from('cuadraturas').upsert({
    anio: Number(anio), semana: Number(semana),
    estado: conDif ? 'con_diferencias' : 'cuadrada',
    detalle, observacion: (observacion || '').trim() || null, generada_por: req.user.name,
  }, { onConflict: 'anio,semana' }).select().single());
  await audit(req.user.name, req.user.role, `Cerró cuadratura semanal (${row.estado})`, `S${semana}/${anio}`);
  res.json(row);
}));

export default r;
