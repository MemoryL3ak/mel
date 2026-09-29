// Tareas programadas en proceso (sin cron externo) y derivación a chatarra.
// Regla de 15 días de obsoletos: una publicación que cumple su plazo sin
// adjudicarse se convierte en chatarra automáticamente. El barrido corre al
// arrancar y cada pocas horas; el botón manual sigue disponible por si hay que
// forzarlo antes. Ambos caminos pasan por convertirAChatarra() para que hagan
// exactamente lo mismo: antes estaban duplicados y ya habían divergido.
import { supa, q, audit, hoy } from './supa.js';
import { tiene } from './esquema.js';
import { enviarCorreo, plantilla } from './mail.js';

const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);

// Los oferentes de una publicación que se cierra sin adjudicar quedaban
// esperando una respuesta que no llegaba nunca.
async function avisarOferentes(ofertas, comp) {
  const ids = [...new Set(ofertas.map((o) => o.comprador_id))];
  if (!ids.length) return;
  const compradores = await q(supa.from('compradores').select('id,razon_social,email').in('id', ids));
  for (const c of compradores) {
    if (!c.email) continue;
    enviarCorreo({
      to: c.email, subject: 'Publicación cerrada sin adjudicar · Venta de obsoletos MEL',
      html: plantilla({
        titulo: 'La publicación se cerró sin adjudicar',
        cuerpo: `Le informamos que <b>${comp.nombre}</b> (${comp.codigo}) cumplió su plazo de publicación sin adjudicarse, y el componente pasó a disposición como chatarra. Su oferta quedó sin efecto. Agradecemos su participación y le invitamos a revisar las publicaciones vigentes.`,
        cta: 'Ver publicaciones',
      }),
    });
  }
}

// Cierra la publicación y manda el componente a chatarra. Devuelve qué pasó,
// para que quien la llame pueda informarlo.
export async function convertirAChatarra(p, { usuario = 'Sistema', rol = 'sistema' } = {}) {
  const comp = await q(supa.from('componentes').select('id,codigo,nombre').eq('id', p.componente_id).single());
  const dia = diasDesde(p.publicado_el);
  const anticipada = dia < p.plazo_dias;
  const ahora = new Date().toISOString();

  await q(supa.from('publicaciones').update({ estado: 'convertida', cerrada_el: ahora }).eq('id', p.id).select('id').single());

  const cambios = { estado: 'chatarra' };
  if (tiene.chatarra_obs) {
    cambios.chatarra_el = ahora;
    cambios.chatarra_motivo = anticipada
      ? `Forzado en el día ${dia} de ${p.plazo_dias}`
      : 'Plazo cumplido sin adjudicar';
  }
  await q(supa.from('componentes').update(cambios).eq('id', comp.id).select('id').single());

  const ofertas = await q(supa.from('ofertas').select('id,comprador_id').eq('publicacion_id', p.id).eq('estado', 'recibida'));
  if (ofertas.length) {
    await q(supa.from('ofertas').update({ estado: 'descartada' })
      .eq('publicacion_id', p.id).eq('estado', 'recibida').select('id'));
    await avisarOferentes(ofertas, comp);
  }

  await audit(usuario, rol,
    anticipada ? 'Convirtió componente a chatarra (forzado antes del plazo)'
               : 'Convirtió componente a chatarra (plazo cumplido)',
    `${comp.codigo} · día ${dia} de ${p.plazo_dias}${ofertas.length ? ` · ${ofertas.length} oferta(s) descartada(s)` : ''}`);

  return { comp, anticipada, ofertas: ofertas.length, dia };
}

export async function barrerPublicacionesVencidas() {
  if (!tiene.obsoletos) return 0;
  try {
    const activas = await q(supa.from('publicaciones').select('*').eq('estado', 'activa'));
    const vencidas = activas.filter((p) => diasDesde(p.publicado_el) >= p.plazo_dias);
    let n = 0;
    for (const p of vencidas) {
      await convertirAChatarra(p);
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
