// Tareas programadas en proceso (sin cron externo) y derivación a chatarra.
// Regla de 15 días de obsoletos: una publicación que cumple su plazo sin
// adjudicarse se convierte en chatarra automáticamente. El barrido corre al
// arrancar y cada pocas horas; el botón manual sigue disponible por si hay que
// forzarlo antes. Ambos caminos pasan por convertirAChatarra() para que hagan
// exactamente lo mismo: antes estaban duplicados y ya habían divergido.
import { supa, q, audit, hoy } from './supa.js';
import { tiene } from './esquema.js';
import { env } from './env.js';
import { enviarCorreo, plantilla } from './mail.js';
import { diasHasta } from './documental.js';

const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);

// Plazo vigente = original + lo ampliado. Sin esto el barrido seguiria
// convirtiendo a chatarra una publicacion cuyo plazo se acaba de extender.
const plazoTotal = (p) => Number(p.plazo_dias) + Number(p.plazo_ampliado_dias ?? 0);

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
  const plazo = plazoTotal(p);
  const anticipada = dia < plazo;
  const ahora = new Date().toISOString();

  await q(supa.from('publicaciones').update({ estado: 'convertida', cerrada_el: ahora }).eq('id', p.id).select('id').single());

  const cambios = { estado: 'chatarra' };
  if (tiene.chatarra_obs) {
    cambios.chatarra_el = ahora;
    cambios.chatarra_motivo = anticipada
      ? `Forzado en el día ${dia} de ${plazo}`
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
    `${comp.codigo} · día ${dia} de ${plazo}${ofertas.length ? ` · ${ofertas.length} oferta(s) descartada(s)` : ''}`);

  return { comp, anticipada, ofertas: ofertas.length, dia };
}

export async function barrerPublicacionesVencidas() {
  if (!tiene.obsoletos) return 0;
  try {
    const activas = await q(supa.from('publicaciones').select('*').eq('estado', 'activa'));
    const vencidas = activas.filter((p) => diasDesde(p.publicado_el) >= plazoTotal(p));
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

// Vencimientos del repositorio documental (Fase 3). Cada documento avisa dos
// veces: al entrar en su ventana de "por vencer" y al vencer. Cada aviso sale
// una sola vez; cargar una versión con otra fecha los rearma. Reciben el aviso
// quienes cargan ese tipo (son los que deben renovarlo) y el coordinador, en
// un solo correo por persona con todos sus documentos.
export async function revisarVencimientos() {
  if (!tiene.documentos) return 0;
  try {
    const [docs, tipos, usuarios] = await Promise.all([
      q(supa.from('documentos').select('id, folio, titulo, tipo, vence_el, aviso_por_vencer_el, aviso_vencido_el')
        .eq('estado', 'vigente').not('vence_el', 'is', null)),
      q(supa.from('doc_tipos').select('codigo, nombre, aviso_dias, roles_carga')),
      tiene.user_email
        ? q(supa.from('users').select('nombre, role, email').eq('activo', true).not('email', 'is', null))
        : [],
    ]);
    const tipo = new Map(tipos.map((t) => [t.codigo, t]));
    const avisos = [];
    for (const d of docs) {
      const t = tipo.get(d.tipo);
      const dias = diasHasta(d.vence_el);
      if (dias < 0 && !d.aviso_vencido_el) avisos.push({ d, t, vencido: true, dias });
      else if (dias >= 0 && dias <= (t?.aviso_dias ?? 30) && !d.aviso_por_vencer_el) avisos.push({ d, t, vencido: false, dias });
    }
    if (!avisos.length) return 0;

    const porCorreo = new Map();
    for (const a of avisos) {
      for (const u of usuarios) {
        if (u.role !== 'coordinador' && !a.t?.roles_carga?.includes(u.role)) continue;
        if (!porCorreo.has(u.email)) porCorreo.set(u.email, []);
        porCorreo.get(u.email).push(a);
      }
    }
    const linea = (a) => `<li><b>${a.d.folio}</b> · ${a.t?.nombre ?? a.d.tipo} — ${a.d.titulo}: `
      + (a.vencido ? `<span style="color:#B23A2E">venció el ${a.d.vence_el}</span>`
                   : `vence el ${a.d.vence_el} (${a.dias === 0 ? 'hoy' : `en ${a.dias} día(s)`})`) + '</li>';
    for (const [email, items] of porCorreo) {
      const vencidos = items.filter((a) => a.vencido).length;
      enviarCorreo({
        to: email,
        subject: vencidos
          ? `${vencidos} documento(s) vencido(s) · GEA`
          : `${items.length} documento(s) por vencer · GEA`,
        html: plantilla({
          encabezado: 'Repositorio documental',
          pie: 'Este es un aviso automático de la plataforma GEA de Minera Escondida.',
          titulo: 'Documentos que requieren renovación',
          cuerpo: `Los siguientes documentos del repositorio vencieron o están por vencer. Cargue la versión renovada para mantenerlos vigentes.<ul style="padding-left:18px">${items.map(linea).join('')}</ul>`,
          cta: env.APP_URL ? 'Abrir el repositorio' : null,
          url: env.APP_URL ? `${env.APP_URL}/documentos` : null,
        }),
      });
    }

    const ahora = new Date().toISOString();
    for (const a of avisos) {
      await q(supa.from('documentos').update(a.vencido ? { aviso_vencido_el: ahora } : { aviso_por_vencer_el: ahora })
        .eq('id', a.d.id).select('id').single());
    }
    await audit('Sistema', 'sistema', 'Avisó vencimientos documentales',
      `${avisos.length} documento(s) · ${porCorreo.size} destinatario(s)`);
    return avisos.length;
  } catch (e) {
    console.error('[GEA] vencimientos documentales:', e.message);
    return 0;
  }
}

// Arranca el barrido: una vez ahora y luego cada 6 horas. unref() para no
// impedir que el proceso termine si alguien lo detiene. El mismo ciclo revisa
// los vencimientos del repositorio documental.
export function iniciarBarridoObsoletos() {
  const ciclo = () => { barrerPublicacionesVencidas(); revisarVencimientos(); };
  ciclo();
  const t = setInterval(ciclo, 6 * 60 * 60 * 1000);
  if (typeof t.unref === 'function') t.unref();
}
