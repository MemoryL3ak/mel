// Maestros y valorización: patios, categorías con precio vigente, historial de precios.
import { Router } from 'express';
import { supa, q, ah, hoy, audit } from '../supa.js';
import { auth } from '../auth.js';
import { contrato, olvidarContrato, venceElPrecio } from '../contrato.js';
import { tiene } from '../esquema.js';
import { valorDolar, historialDolar, fijarDolar } from '../dolar.js';

const r = Router();

// Días que faltan (o que ya pasaron, en negativo) para que venza un precio.
const diasPara = (fecha) =>
  Math.round((new Date(fecha + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000);

r.get('/maestros', auth(), ah(async (_req, res) => {
  const [patios, categorias, precios, sitios] = await Promise.all([
    q(supa.from('patios').select('*').eq('activo', true).order('id')),
    q(supa.from('categorias').select('*').eq('activo', true).order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    q(supa.from('sitios').select('*').order('id')),
  ]);
  // precio vigente por categoría (el más reciente no futuro)
  const h = hoy();
  const vigente = {};
  for (const p of precios) {
    if (p.vigente_desde <= h && !(p.categoria_id in vigente)) vigente[p.categoria_id] = Number(p.precio_kg);
  }
  res.json({
    patios,
    sitios,
    categorias: categorias.map((c) => ({ ...c, precio_kg: vigente[c.id] ?? null })),
    // Qué funciones tienen respaldo en la base ahora mismo: la interfaz no
    // debe ofrecer campos que el servidor va a descartar en silencio.
    funciones: { ...tiene },
  });
}));

r.get('/valorizacion', auth('ito', 'coordinador'), ah(async (_req, res) => {
  const [categorias, precios, desp, cfg, dol, histDolar] = await Promise.all([
    q(supa.from('categorias').select('*').order('id')),
    q(supa.from('precios').select('*').order('vigente_desde', { ascending: false })),
    q(supa.from('despachos').select('categoria_id, categoria_final_id, kg_destino, valor, estado').not('kg_destino', 'is', null)),
    contrato(),
    valorDolar().catch(() => null),
    historialDolar(30).catch(() => []),
  ]);
  const h = hoy();
  const meses = cfg.meses_vigencia_precio;
  const vivos = desp.filter((d) => d.estado !== 'anulado');   // lo anulado no valoriza
  const porCat = categorias.map((c) => {
    const vig = precios.find((p) => p.categoria_id === c.id && p.vigente_desde <= h);
    const propios = vivos.filter((d) => (d.categoria_final_id ?? d.categoria_id) === c.id);
    // El contrato fija la vigencia de cada precio: pasado ese plazo hay que
    // renegociar, y la plataforma tiene que avisarlo antes de que ocurra.
    const vence = vig ? venceElPrecio(vig.vigente_desde, meses) : null;
    const dias = vence ? diasPara(vence) : null;
    const usd = vig?.precio_usd == null ? null : Number(vig.precio_usd);
    const tm = vig?.precio_usd_tm == null ? null : Number(vig.precio_usd_tm);
    const tmMad = vig?.precio_usd_tm_madera == null ? null : Number(vig.precio_usd_tm_madera);
    // USD por kilo equivalente, solo para comparar con vigencias antiguas.
    const usdKg = tm != null ? tm / 1000 : usd;
    return {
      ...c,
      precio_kg: vig?.precio_kg == null ? null : Number(vig.precio_kg),
      precio_usd: usd,
      precio_usd_tm: tm,
      precio_usd_tm_madera: tmMad,
      // Referencia en pesos de hoy, solo informativa: lo que se congela es el USD.
      precio_clp_hoy: usdKg != null && dol ? Math.round(usdKg * dol.valor) : null,
      vigente_desde: vig?.vigente_desde ?? null,
      vence_el: vence,
      dias_para_vencer: dias,
      estado_precio: vig == null ? 'sin_precio' : dias < 0 ? 'vencido' : dias <= 15 ? 'por_vencer' : 'vigente',
      kg_ytd: propios.reduce((a, d) => a + Number(d.kg_destino), 0),
      valor_ytd: propios.reduce((a, d) => a + Number(d.valor ?? 0), 0),
    };
  });
  res.json({
    categorias: porCat, historial: precios, meses_vigencia: meses,
    usd: tiene.usd, tm: tiene.tm, dolar: dol, historial_dolar: histDolar,
  });
}));

// Valida una fila de precio; devuelve el error o null.
function revisarPrecio({ precio_usd_tm, precio_usd, precio_kg, vigente_desde }) {
  if (!(Number(precio_usd_tm) > 0) && !(Number(precio_usd) > 0) && !(Number(precio_kg) > 0)) {
    return 'Precio válido obligatorio';
  }
  if (vigente_desde && !/^\d{4}-\d{2}-\d{2}$/.test(vigente_desde)) return 'Fecha de vigencia inválida';
  return null;
}

// Columnas de precio de una fila, según lo que la base admita hoy.
const columnasPrecio = (f) => ({
  precio_kg: Number(f.precio_kg) > 0 ? Number(f.precio_kg) : null,
  ...(tiene.usd && Number(f.precio_usd) > 0 ? { precio_usd: Number(f.precio_usd) } : {}),
  ...(tiene.tm ? {
    precio_usd_tm: Number(f.precio_usd_tm) > 0 ? Number(f.precio_usd_tm) : null,
    // Sin Alternativa B declarada, se entiende que rige la misma de A.
    precio_usd_tm_madera: Number(f.precio_usd_tm_madera) > 0 ? Number(f.precio_usd_tm_madera)
      : Number(f.precio_usd_tm) > 0 ? Number(f.precio_usd_tm) : null,
  } : {}),
});

// Nueva vigencia de precio (solo Coordinador): no edita, agrega historia.
r.post('/precios', auth('coordinador'), ah(async (req, res) => {
  const { categoria_id, precio_usd, precio_kg, vigente_desde } = req.body || {};
  if (!categoria_id) return res.status(400).json({ error: 'La categoría es obligatoria' });
  const mal = revisarPrecio(req.body || {});
  if (mal) return res.status(400).json({ error: mal });

  const row = await q(supa.from('precios').insert({
    categoria_id,
    ...columnasPrecio(req.body || {}),
    vigente_desde: vigente_desde || hoy(), creado_por: req.user.name,
  }).select().single());
  const { precio_usd_tm } = req.body || {};
  await audit(req.user.name, req.user.role, 'Actualizó precio de contrato',
    `categoría ${categoria_id} → ${Number(precio_usd_tm) > 0 ? `USD ${precio_usd_tm}/TM`
      : Number(precio_usd) > 0 ? `USD ${precio_usd}/kg` : `$${precio_kg}/kg`}`);
  res.json(row);
}));

// Carga masiva de vigencias: o entran todas, o no entra ninguna. Una carga a
// medias dejaría la tabla de precios en un estado que nadie pidió.
r.post('/precios/masivo', auth('coordinador'), ah(async (req, res) => {
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  if (!filas.length) return res.status(400).json({ error: 'No hay filas que cargar' });
  if (filas.length > 500) return res.status(400).json({ error: 'Máximo 500 filas por carga' });

  const cats = await q(supa.from('categorias').select('id,nombre'));
  const porNombre = new Map(cats.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
  const errores = [];
  const limpias = filas.map((f, i) => {
    const n = i + 1;
    const catId = Number(f.categoria_id) ||
      porNombre.get(String(f.categoria ?? '').trim().toLowerCase());
    if (!catId) errores.push(`Fila ${n}: categoría desconocida ("${f.categoria ?? ''}")`);
    const mal = revisarPrecio(f);
    if (mal) errores.push(`Fila ${n}: ${mal}`);
    return {
      categoria_id: catId,
      ...columnasPrecio(f),
      vigente_desde: f.vigente_desde || hoy(),
      creado_por: req.user.name,
    };
  });
  if (errores.length) return res.status(400).json({ error: 'La carga no entró', detalle: errores.slice(0, 12) });

  const rows = await q(supa.from('precios').insert(limpias).select());
  await audit(req.user.name, req.user.role, 'Carga masiva de precios', `${rows.length} vigencia(s)`);
  res.json({ cargadas: rows.length, filas: rows });
}));

/* ---------- valor del dólar ---------- */

r.get('/dolar', auth('ito', 'coordinador'), ah(async (_req, res) => {
  res.json({ activo: tiene.usd, actual: await valorDolar(), historial: await historialDolar(60) });
}));

// Registro manual: fines de semana, feriados o caída de la API.
r.post('/dolar', auth('ito', 'coordinador'), ah(async (req, res) => {
  if (!tiene.usd) return res.status(503).json({ error: 'Esta función requiere aplicar db/0004_operacion.sql en la base de datos' });
  const { fecha, valor } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return res.status(400).json({ error: 'Fecha inválida' });
  if (!(Number(valor) > 0)) return res.status(400).json({ error: 'El valor del dólar debe ser mayor que cero' });
  const row = await fijarDolar(fecha, Number(valor), req.user.name);
  await audit(req.user.name, req.user.role, 'Fijó el valor del dólar', `${fecha} · $${valor}`);
  res.json(row);
}));

// `editable` es false mientras no se aplique la migración que crea la tabla:
// así la pantalla no ofrece un botón que iba a fallar.
r.get('/contrato', auth(), ah(async (_req, res) =>
  res.json({ ...(await contrato()), editable: tiene.contrato })));

r.patch('/contrato', auth('coordinador'), ah(async (req, res) => {
  if (!tiene.contrato) {
    return res.status(503).json({ error: 'Esta función requiere aplicar db/0003_ep_contrato.sql en la base de datos' });
  }
  const permitidos =['numero', 'gerencia', 'glosa', 'mandante', 'contratista', 'firma_mandante',
    'firma_contratista', 'monto_original', 'modificaciones', 'iva_pct', 'dia_corte', 'meses_vigencia_precio'];
  const cambios = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => permitidos.includes(k)));
  if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios que guardar' });
  const row = await q(supa.from('contrato').update(cambios).eq('id', 1).select().single());
  olvidarContrato();
  await audit(req.user.name, req.user.role, 'Actualizó datos del contrato', Object.keys(cambios).join(', '));
  res.json(row);
}));

export default r;
