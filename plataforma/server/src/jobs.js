// Tareas programadas en proceso (sin cron externo).
// Regla de 15 días de obsoletos: una publicación que cumple su plazo sin
// adjudicarse se convierte en chatarra automáticamente. El barrido corre al
// arrancar y cada pocas horas; el botón manual sigue disponible por si hay que
// forzarlo antes.
import { supa, q, audit, hoy } from './supa.js';
import { tiene } from './esquema.js';

const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);

export async function barrerPublicacionesVencidas() {
  if (!tiene.obsoletos) return 0;
  try {
    const activas = await q(supa.from('publicaciones').select('*').eq('estado', 'activa'));
    const vencidas = activas.filter((p) => diasDesde(p.publicado_el) >= p.plazo_dias);
    let n = 0;
    for (const p of vencidas) {
      const comp = await q(supa.from('componentes').select('id,codigo').eq('id', p.componente_id).single());
      await q(supa.from('publicaciones').update({ estado: 'convertida', cerrada_el: new Date().toISOString() }).eq('id', p.id).select('id').single());
      await q(supa.from('componentes').update({ estado: 'chatarra' }).eq('id', comp.id).select('id').single());
      await audit('Sistema', 'sistema', 'Convirtió componente a chatarra (plazo cumplido, automático)', `${comp.codigo} → enajenación`);
      n++;
    }
    if (n) console.log(`[GEA] barrido de obsoletos: ${n} publicación(es) convertida(s) a chatarra por plazo cumplido`);
    return n;
  } catch (e) {
    console.error('[GEA] barrido de obsoletos:', e.message);
    return 0;
  }
}

// Arranca el barrido: una vez ahora y luego cada 6 horas. unref() para no
// impedir que el proceso termine si alguien lo detiene.
export function iniciarBarridoObsoletos() {
  barrerPublicacionesVencidas();
  const t = setInterval(barrerPublicacionesVencidas, 6 * 60 * 60 * 1000);
  if (typeof t.unref === 'function') t.unref();
}
