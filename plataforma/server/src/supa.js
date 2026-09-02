// Capa de datos: cliente Supabase (service role, solo servidor) y utilitarios.
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supa = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

// Ejecuta un builder de PostgREST y convierte su error en excepción.
export async function q(builder) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return data;
}

// Folio correlativo race-safe (función SQL next_folio).
export async function folio(tipo) {
  const { data, error } = await supa.rpc('next_folio', { p_tipo: tipo });
  if (error) throw new Error(error.message);
  return data;
}

// Wrapper de handlers async: los errores llegan al middleware de errores.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Fecha local (Chile es UTC-4: jamás usar toISOString para "hoy").
export function hoy() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

// Semana ISO-8601 y su año.
export function semanaISO(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return { anio: x.getUTCFullYear(), semana: Math.ceil(((x - y0) / 86400000 + 1) / 7) };
}

export const fmtFecha = (ts) =>
  new Date(ts).toLocaleString('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

// Bitácora inmutable. Nunca interrumpe la operación principal.
export async function audit(usuario, rol, accion, objeto = null) {
  try {
    await supa.from('auditoria').insert({ usuario, rol, accion, objeto });
  } catch { /* la auditoría no debe botar la operación */ }
}

// Precio vigente por categoría a una fecha dada.
export async function precioVigente(categoriaId, fecha = hoy()) {
  const rows = await q(
    supa.from('precios').select('precio_kg')
      .eq('categoria_id', categoriaId).lte('vigente_desde', fecha)
      .order('vigente_desde', { ascending: false }).limit(1)
  );
  if (!rows.length) throw new Error('No hay precio vigente para la categoría');
  return Number(rows[0].precio_kg);
}
