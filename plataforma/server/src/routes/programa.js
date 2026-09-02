// Programa semanal de limpieza de patios: la empresa contratista planifica
// los despachos por tipo de material y registra el cumplimiento.
import { Router } from 'express';
import { supa, q, ah, audit, semanaISO } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();
const SEL = '*, patios(codigo, nombre), categorias(nombre)';

r.get('/programa', auth(), ah(async (req, res) => {
  const actual = semanaISO();
  const anio = Number(req.query.anio || actual.anio);
  const semana = Number(req.query.semana || actual.semana);
  const rows = await q(
    supa.from('programa').select(SEL).eq('anio', anio).eq('semana', semana)
      .order('fecha', { ascending: true, nullsFirst: false }).order('id')
  );
  const ejec = rows.filter((x) => x.estado === 'ejecutado');
  const estTon = ejec.reduce((a, x) => a + Number(x.ton_estimadas), 0);
  const realTon = ejec.reduce((a, x) => a + Number(x.ton_reales ?? 0), 0);
  res.json({
    anio, semana, actual,
    rows,
    cumplimiento: {
      actividades: { ejecutadas: ejec.length, total: rows.length },
      pct_tonelaje: estTon ? Math.round((realTon / estTon) * 100) : null,
    },
  });
}));

r.post('/programa', auth('limpieza', 'coordinador'), ah(async (req, res) => {
  const { anio, semana, dia, fecha, patio_id, categoria_id, ton_estimadas } = req.body || {};
  if (!anio || !semana || !dia || !patio_id || !categoria_id || !(Number(ton_estimadas) > 0)) {
    return res.status(400).json({ error: 'Faltan datos de la planificación' });
  }
  const row = await q(supa.from('programa').insert({
    anio, semana, dia, fecha: fecha || null, patio_id, categoria_id,
    ton_estimadas: Number(ton_estimadas), creado_por: req.user.name,
  }).select(SEL).single());
  await audit(req.user.name, req.user.role, 'Planificó actividad de limpieza', `S${semana} ${dia} · ${row.patios?.codigo}`);
  res.json(row);
}));

r.post('/programa/:id/ejecutar', auth('limpieza', 'ito', 'coordinador'), ah(async (req, res) => {
  const ton = Number(req.body?.ton_reales);
  if (!(ton > 0)) return res.status(400).json({ error: 'Ingrese el tonelaje real retirado' });
  const row = await q(supa.from('programa')
    .update({ estado: 'ejecutado', ton_reales: ton, observacion: req.body?.observacion || null })
    .eq('id', req.params.id).select(SEL).single());
  await audit(req.user.name, req.user.role, 'Registró ejecución del programa', `S${row.semana} ${row.dia} · ${ton} t`);
  res.json(row);
}));

r.post('/programa/:id/reprogramar', auth('limpieza', 'coordinador'), ah(async (req, res) => {
  const obs = (req.body?.observacion || '').trim();
  if (!obs) return res.status(400).json({ error: 'La reprogramación requiere una observación' });
  const row = await q(supa.from('programa')
    .update({ estado: 'reprogramado', observacion: obs })
    .eq('id', req.params.id).select(SEL).single());
  await audit(req.user.name, req.user.role, 'Reprogramó actividad', `S${row.semana} ${row.dia} · ${obs}`);
  res.json(row);
}));

export default r;
