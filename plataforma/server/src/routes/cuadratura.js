// Cuadratura semanal del ITO: cruza los movimientos de la semana entre
// MEL (guías de despacho), La Negra (recepciones) y Lampa (traslados
// recepcionados), por categoría. El cierre guarda un snapshot inmutable.
import { Router } from 'express';
import { supa, q, ah, audit, semanaISO } from '../supa.js';
import { auth } from '../auth.js';

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

async function calcular(anio, semana) {
  const { desde, hasta } = rangoSemana(anio, semana);
  const [cats, desp, tras] = await Promise.all([
    q(supa.from('categorias').select('*').order('id')),
    q(supa.from('despachos').select('categoria_id, categoria_final_id, kg_origen, kg_destino, estado')
      .gte('fecha', desde).lte('fecha', hasta)),
    q(supa.from('traslados').select('categoria_id, kg, kg_lampa, estado')
      .gte('fecha', desde).lte('fecha', hasta)),
  ]);
  const detalle = cats.map((c) => {
    const dMel = desp.filter((d) => d.categoria_id === c.id);
    const dLN = desp.filter((d) => (d.categoria_final_id ?? d.categoria_id) === c.id && d.kg_destino != null);
    const tLP = tras.filter((t) => t.categoria_id === c.id);
    const kgMel = dMel.reduce((a, d) => a + Number(d.kg_origen), 0);
    const kgLN = dLN.reduce((a, d) => a + Number(d.kg_destino), 0);
    const kgLPd = tLP.reduce((a, t) => a + Number(t.kg), 0);
    const kgLPr = tLP.reduce((a, t) => a + Number(t.kg_lampa ?? 0), 0);
    return {
      categoria: c.nombre,
      kg_mel: kgMel, kg_lanegra: kgLN, kg_lampa_desp: kgLPd, kg_lampa_rec: kgLPr,
      dif_pct: kgMel ? Math.round(((kgLN - kgMel) / kgMel) * 10000) / 100 : null,
      pendientes_transito: dMel.filter((d) => d.estado === 'en_transito').length,
      observados: dMel.filter((d) => d.estado === 'observado').length,
    };
  }).filter((x) => x.kg_mel || x.kg_lanegra || x.kg_lampa_desp);
  return { desde, hasta, detalle };
}

r.get('/cuadratura', auth('ito', 'coordinador'), ah(async (req, res) => {
  const actual = semanaISO();
  const anio = Number(req.query.anio || actual.anio);
  const semana = Number(req.query.semana || actual.semana);
  const [{ desde, hasta, detalle }, cerradas] = await Promise.all([
    calcular(anio, semana),
    q(supa.from('cuadraturas').select('*').order('anio', { ascending: false }).order('semana', { ascending: false }).limit(12)),
  ]);
  const cerrada = cerradas.find((c) => c.anio === anio && c.semana === semana) ?? null;
  res.json({ anio, semana, actual, desde, hasta, detalle, cerrada, historico: cerradas });
}));

// Cierra la cuadratura de la semana con el snapshot calculado en ese momento.
r.post('/cuadratura/cerrar', auth('ito', 'coordinador'), ah(async (req, res) => {
  const { anio, semana, observacion } = req.body || {};
  if (!anio || !semana) return res.status(400).json({ error: 'Año y semana son obligatorios' });
  const { detalle } = await calcular(Number(anio), Number(semana));
  if (!detalle.length) return res.status(400).json({ error: 'La semana no registra movimientos que cuadrar' });

  const conDif = detalle.some((x) => x.observados > 0 || (x.dif_pct != null && Math.abs(x.dif_pct) > 2));
  if (conDif && !(observacion || '').trim()) {
    return res.status(400).json({ error: 'Hay diferencias sobre el 2% u observados: la observación es obligatoria' });
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
