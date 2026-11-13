import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtUSD } from '../api.js';
import { DateField, Chip, Empty, Field, Modal, PageHead, hoyISO, useToast } from '../ui.jsx';

const EYEBROW = 'Venta de obsoletos';
const ESTADO = {
  activa: ['info', 'Activa'], adjudicada: ['ok', 'Adjudicada'],
  convertida: ['bad', 'Convertida a chatarra'], cancelada: ['neutral', 'Cancelada'],
};

// Barra del plazo de 15 días, coloreada según cuánto queda.
function Plazo({ p }) {
  if (p.estado !== 'activa') {
    return <small style={{ color: 'var(--muted)' }}>{p.estado === 'convertida' ? 'Plazo cumplido' : '—'}</small>;
  }
  const pct = Math.min(100, Math.round((p.dia / p.plazo_dias) * 100));
  const tono = (p.vencido || p.dias_restantes <= 1) ? 'bad' : p.dias_restantes <= 5 ? 'warn' : '';
  const color = tono === 'bad' ? 'var(--bad-tx)' : tono === 'warn' ? 'var(--warn-tx)' : null;
  const texto = p.vencido ? `${p.dia} días — plazo cumplido`
    : p.dias_restantes === 1 ? `Día ${p.dia} de ${p.plazo_dias} — vence mañana`
    : `Día ${p.dia} de ${p.plazo_dias}`;
  const ampliada = p.ampliado > 0 ? ` · ampliado +${p.ampliado}` : '';
  return (<>
    <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} /></div>
    <small style={{ color: tono === 'bad' ? 'var(--bad-tx)' : 'var(--ink-2)', fontWeight: p.vencido ? 700 : 400 }}>{texto}{ampliada}</small>
  </>);
}

export default function Publicaciones() {
  const [rows, setRows] = useState(null);
  const [comps, setComps] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ componente_id: '', oferta_minima: '', plazo_dias: 15, publicado_el: hoyISO() });
  const [convertir, setConvertir] = useState(null);
  const [ampliar, setAmpliar] = useState(null);
  const [dias, setDias] = useState(15);
  const [buscaComp, setBuscaComp] = useState('');   // buscador del componente a publicar (SKU o nombre)
  const [buscaPub, setBuscaPub] = useState('');     // buscador sobre la lista de publicaciones
  const [lote, setLote] = useState(null);           // publicación en lote: { sel, busca, plazo_dias, publicado_el, minima }
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const load = () => {
    api('/publicaciones').then(setRows).catch((e) => toast(e.message, true));
    api('/componentes').then((d) => setComps(d.componentes ?? [])).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  // Desde el inventario se llega con el componente ya elegido: el botón
  // «Publicar» de la fila abre este formulario sin tener que buscarlo de nuevo.
  useEffect(() => {
    const comp = params.get('comp');
    if (comp) { setF((prev) => ({ ...prev, componente_id: comp })); setNuevo(true); }
  }, []);
  if (!rows) return <div className="loading">Cargando publicaciones…</div>;

  // Se publica lo que el memo autoriza: confirmado en terreno o todavía «por
  // identificar». La conciliación en terreno no es requisito (se registra
  // después); lo que se marcó como no encontrado sí queda fuera.
  const publicable = (c) => ['planificado', 'por_identificar'].includes(c.estado);
  const disponibles = comps.filter(publicable);
  // El componente elegido (desde el inventario o desde el buscador). Puede ser
  // uno que ya no se puede publicar: se muestra igual, con el motivo, en vez
  // de aparecer como si no existiera.
  const elegido = f.componente_id ? comps.find((c) => String(c.id) === String(f.componente_id)) ?? null : null;
  const MOTIVO_NO = {
    publicado: 'ya está publicado en el portal', adjudicado: 'ya fue adjudicado', entregado: 'ya fue entregado',
    no_encontrado: 'se registró como no encontrado en terreno', chatarra: 'ya se convirtió en chatarra',
  };
  // Por qué un componente no se puede publicar, con el día de su publicación
  // cuando ya está en el portal.
  const motivoNo = (c) => (c.estado === 'publicado' && c.dia != null
    ? `ya está publicado en el portal · día ${c.dia} de ${c.plazo}`
    : MOTIVO_NO[c.estado] ?? 'no se puede publicar');
  // Buscador: cada palabra tiene que aparecer en el SKU, el nombre, las
  // especificaciones o el sitio. Con cientos de materiales, el desplegable
  // no servía para encontrar uno: había que recorrerlo entero.
  const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const calza = (texto, palabras) => { const t = normalizar(texto); return palabras.every((p) => t.includes(p)); };
  const palabras = normalizar(buscaComp).split(/\s+/).filter(Boolean);
  const textoDe = (c) => [c.codigo, c.nombre, c.especificaciones, c.sitio].join(' ');
  const encontrados = palabras.length ? disponibles.filter((c) => calza(textoDe(c), palabras)) : disponibles;
  // Lo que coincide con la búsqueda pero no se puede publicar (ya publicado,
  // adjudicado, no encontrado…). Se muestra con su motivo: antes el buscador
  // respondía «no hay coincidencias» para un componente recién publicado desde
  // el inventario, como si las dos pantallas no hablaran entre sí.
  const noPublicables = palabras.length ? comps.filter((c) => !publicable(c) && calza(textoDe(c), palabras)) : [];
  // Buscador de la lista de publicaciones, por SKU o nombre.
  const palabrasPub = normalizar(buscaPub).split(/\s+/).filter(Boolean);
  const pubsVisibles = palabrasPub.length ? rows.filter((p) => calza([p.codigo, p.componente].join(' '), palabrasPub)) : rows;
  // Publicación en lote: se marcan varios componentes y salen al portal en un
  // solo acto, cada uno con su publicación, con el mismo plazo y la misma fecha.
  const abrirLote = () => setLote({ sel: {}, busca: '', plazo_dias: 15, publicado_el: hoyISO(), minima: false });
  const palabrasLote = normalizar(lote?.busca).split(/\s+/).filter(Boolean);
  const visiblesLote = !lote ? [] : palabrasLote.length ? disponibles.filter((c) => calza(textoDe(c), palabrasLote)) : disponibles;
  const elegidosLote = lote ? disponibles.filter((c) => lote.sel[c.id]) : [];
  async function publicarLote() {
    if (!elegidosLote.length) return toast('Marque los componentes que se van a publicar', true);
    try {
      const r = await api('/publicaciones/masivo', { method: 'POST', body: {
        componente_ids: elegidosLote.map((c) => c.id),
        plazo_dias: Number(lote.plazo_dias) || 15, publicado_el: lote.publicado_el || undefined,
        minima_referencial: lote.minima } });
      toast(`${r.publicados} componente(s) publicados en el portal`);
      setLote(null); load();
    } catch (e) { toast(e.message, true); }
  }
  const abrirNuevo = () => { setF({ componente_id: '', oferta_minima: '', plazo_dias: 15, publicado_el: hoyISO() }); setBuscaComp(''); setNuevo(true); };

  async function publicar() {
    if (!f.componente_id) return toast('Elija el componente a publicar', true);
    if (elegido && !publicable(elegido)) return toast(`${elegido.codigo} ${motivoNo(elegido)}`, true);
    try {
      await api('/publicaciones', { method: 'POST', body: {
        componente_id: Number(f.componente_id),
        oferta_minima: f.oferta_minima === '' ? null : Number(f.oferta_minima),
        plazo_dias: Number(f.plazo_dias) || 15, publicado_el: f.publicado_el || undefined } });
      toast('Componente publicado en el portal');
      setNuevo(false); setF({ componente_id: '', oferta_minima: '', plazo_dias: 15, publicado_el: hoyISO() }); load();
    } catch (e) { toast(e.message, true); }
  }

  // Ampliar el plazo de una publicacion en curso: una que va en el dia 14 de 15
  // con ofertas sobre la mesa no deberia morir por calendario.
  async function ampliarPlazo() {
    const n = Math.round(Number(dias));
    if (!(n > 0)) return toast('Indique por cuántos días se amplía', true);
    try {
      const r = await api(`/publicaciones/${ampliar.id}/ampliar`, { method: 'POST', body: { dias: n } });
      toast(`Plazo ampliado a ${r.plazo_dias} días`);
      setAmpliar(null); load();
    } catch (e) { toast(e.message, true); }
  }

  async function convertirChatarra() {
    try {
      const r = await api(`/publicaciones/${convertir.id}/convertir`, { method: 'POST' });
      toast(r.anticipada
        ? `${convertir.codigo} forzado a chatarra antes del plazo`
        : `${convertir.codigo} convertido a chatarra por plazo cumplido`);
      setConvertir(null); load();
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div>
      <PageHead eyebrow={EYEBROW} title="Publicaciones"
        sub="Control automático de tiempos: a los 15 días sin adjudicar, el componente se convierte en chatarra y queda pendiente de clasificar para el programa de limpieza.">
        <a className="btn" href="/portal" target="_blank" rel="noreferrer">Ver portal público ↗</a>
        <button className="btn" onClick={abrirLote} title="Publicar varios componentes del inventario de una vez">Publicar en lote</button>
        <button className="btn primary" onClick={abrirNuevo}>+ Publicar componente</button>
      </PageHead>

      <div className="card">
        <div className="card-h">
          <input type="search" className="inv-busca" value={buscaPub} onChange={(e) => setBuscaPub(e.target.value)}
            placeholder="Buscar publicación por SKU o nombre" aria-label="Buscar en las publicaciones" />
          <small>{palabrasPub.length ? `${pubsVisibles.length} de ${rows.length} publicaciones` : `${rows.length} publicaciones`}</small>
        </div>
        <div className="tbl-wrap"><table>
        <thead><tr><th>Componente</th><th>Publicado el</th><th style={{ minWidth: 180 }}>Plazo (15 días)</th><th className="num">Ofertas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {pubsVisibles.map((p) => {
            const [tono, txt] = ESTADO[p.estado] ?? ['neutral', p.estado];
            return (
              <tr key={p.id} style={p.estado !== 'activa' ? { opacity: 0.75 } : undefined}>
                <td><b>{p.componente}</b><br /><small className="mono" style={{ color: 'var(--muted)' }}>{p.codigo}</small></td>
                <td className="mono">{p.publicado_el}</td>
                <td><Plazo p={p} /></td>
                <td className="num">{p.ofertas}</td>
                <td><Chip tone={p.estado === 'activa' && (p.vencido || p.dias_restantes <= 1) ? 'warn' : tono}>
                  {p.estado === 'activa' && p.vencido ? 'Por convertir' : txt}</Chip></td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {p.ofertas > 0 && <button className="btn sm" onClick={() => nav(`/ofertas?pub=${p.id}`)}>Ofertas</button>}{' '}
                  {p.estado === 'activa' && (
                    <button className="btn sm" onClick={() => { setAmpliar(p); setDias(15); }}
                      title="Sumar días al plazo de esta publicación">+ Plazo</button>
                  )}{' '}
                  {p.estado === 'activa' && (
                    <button className="btn sm danger" onClick={() => setConvertir(p)}
                      title={p.vencido ? 'El plazo se cumplió sin adjudicar' : 'Forzar la conversión antes de que se cumpla el plazo'}>
                      {p.vencido ? 'Convertir a chatarra' : 'Forzar chatarra'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
        {rows.length === 0 && <Empty title="Sin publicaciones">Publique un componente del inventario para que aparezca en el portal.</Empty>}
        {rows.length > 0 && pubsVisibles.length === 0 && <Empty title="Sin coincidencias">Ninguna publicación coincide con «{buscaPub.trim()}».</Empty>}
      </div>
      <div className="audit-note" style={{ marginTop: 12 }}>⚙ Al cumplirse el plazo sin adjudicar se cierra la publicación, se descartan las ofertas recibidas —avisando a cada oferente— y el componente queda en el inventario <b>pendiente de clasificar</b>. Entra al programa de limpieza cuando se le asigna patio, categoría y peso.</div>

      <Modal open={nuevo} title="Publicar componente en el portal" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={publicar}>Publicar</button>
        </>}>
        {elegido ? (
          // El componente ya está elegido (desde el inventario o el buscador):
          // se muestra con sus datos, no como una opción más de una lista.
          <Field label="Componente">
            <div className={`alerta ${publicable(elegido) ? 'info' : 'bad'}`} style={{ alignItems: 'flex-start' }}>
              <b className="mono">{elegido.codigo}</b>
              <span>
                <b>{elegido.nombre}</b>
                {elegido.especificaciones && <><br /><small>{elegido.especificaciones}</small></>}
                <br /><small>
                  {elegido.sitio ? `${elegido.sitio} · ` : ''}{elegido.ubicacion ? `${elegido.ubicacion} · ` : ''}
                  {elegido.valor_referencial != null ? `valor referencial ${fmtUSD(elegido.valor_referencial)}` : 'sin valor referencial'}
                  {elegido.estado === 'por_identificar' ? ' · por identificar en terreno (se publica igual)' : ''}
                </small>
                {!publicable(elegido) && <><br /><b>No se puede publicar: {motivoNo(elegido)}.</b></>}
              </span>
              <button type="button" className="btn sm" style={{ marginLeft: 'auto', flexShrink: 0 }}
                onClick={() => { setF({ ...f, componente_id: '' }); setBuscaComp(''); }}>Cambiar</button>
            </div>
          </Field>
        ) : (
          <Field label="Componente" hint={`Busque por SKU o por parte del nombre y elija uno: hay ${disponibles.length} componente(s) del inventario disponibles para publicar. La confirmación en terreno no es requisito: se registra después, desde el inventario o el memo.`}>
            <input type="search" value={buscaComp} onChange={(e) => setBuscaComp(e.target.value)} autoFocus
              placeholder="SKU, nombre o especificación" aria-label="Buscar componente" />
            {!palabras.length && disponibles.length === 0 ? (
              <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>No hay componentes disponibles para publicar. Ingréselos en el Inventario, o búsquelos aquí para ver en qué estado están.</small>
            ) : encontrados.length === 0 && noPublicables.length === 0 ? (
              <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6 }}>Ningún componente del inventario coincide con «{buscaComp.trim()}».</small>
            ) : (
              <div className="lista-comp">
                {encontrados.slice(0, 12).map((c) => (
                  <button type="button" key={c.id} className="lista-comp-item" onClick={() => setF({ ...f, componente_id: String(c.id) })}>
                    <span className="mono">{c.codigo}</span>
                    <span><b>{c.nombre}</b>{c.sitio && <small> · {c.sitio}</small>}{c.estado === 'por_identificar' && <small> · por identificar</small>}</span>
                    <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{c.valor_referencial != null ? fmtUSD(c.valor_referencial) : ''}</span>
                  </button>
                ))}
                {encontrados.length > 12 && (
                  <small style={{ color: 'var(--muted)', padding: '6px 10px' }}>… y {encontrados.length - 12} más: afine la búsqueda.</small>
                )}
                {/* Coinciden pero no se pueden publicar: se ven, con el motivo. */}
                {noPublicables.slice(0, 6).map((c) => (
                  <div key={c.id} className="lista-comp-item no" title={`No se puede publicar: ${motivoNo(c)}`}>
                    <span className="mono">{c.codigo}</span>
                    <span><b>{c.nombre}</b><small> · {motivoNo(c)}</small></span>
                  </div>
                ))}
                {noPublicables.length > 6 && (
                  <small style={{ color: 'var(--muted)', padding: '6px 10px' }}>… y {noPublicables.length - 6} más que no se pueden publicar.</small>
                )}
              </div>
            )}
          </Field>
        )}
        {f.componente_id && !elegido && comps.length > 0 && (
          <div className="alerta bad" style={{ marginBottom: 12 }}><b>Componente no encontrado</b>
            <span>El componente elegido ya no está en el inventario. <button type="button" className="btn sm" onClick={() => setF({ ...f, componente_id: '' })}>Elegir otro</button></span></div>
        )}
        <div className="grid g2" style={{ gap: 0, columnGap: 14 }}>
          <Field label="Oferta mínima (USD)" hint="Opcional. Las ofertas bajo este monto se rechazan.">
            <input type="number" min="0" value={f.oferta_minima} onChange={(e) => setF({ ...f, oferta_minima: e.target.value })} placeholder="28500" />
          </Field>
          <Field label="Plazo (días)">
            <input type="number" min="1" value={f.plazo_dias} onChange={(e) => setF({ ...f, plazo_dias: e.target.value })} />
          </Field>
        </div>
        <Field label="Fecha de publicación" hint="Se propone hoy.">
          <DateField value={f.publicado_el} onChange={(e) => setF({ ...f, publicado_el: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={!!lote} title="Publicar componentes en lote" onClose={() => setLote(null)} ancho
        footer={<>
          <button className="btn" onClick={() => setLote(null)}>Cancelar</button>
          <button className="btn primary" onClick={publicarLote} disabled={!elegidosLote.length}>
            {elegidosLote.length ? `Publicar ${elegidosLote.length} componente(s)` : 'Publicar'}
          </button>
        </>}>
        {lote && (<>
          <p style={{ marginTop: 0, color: 'var(--ink-2)', fontSize: 13.5 }}>
            Marque los componentes del inventario que salen al portal. Cada uno queda con su propia publicación,
            todas con el mismo plazo y la misma fecha. Si alguno ya no se puede publicar, no se publica ninguno y se avisa cuál.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="search" className="inv-busca" value={lote.busca} autoFocus
              onChange={(e) => setLote({ ...lote, busca: e.target.value })}
              placeholder="Filtrar por SKU, nombre o especificación" aria-label="Filtrar componentes" />
            <button type="button" className="btn sm" disabled={!visiblesLote.length}
              onClick={() => setLote({ ...lote, sel: { ...lote.sel, ...Object.fromEntries(visiblesLote.map((c) => [c.id, true])) } })}>
              Marcar los {visiblesLote.length} que se ven
            </button>
            <button type="button" className="btn sm" disabled={!elegidosLote.length}
              onClick={() => setLote({ ...lote, sel: {} })}>Quitar todos</button>
            <small style={{ color: 'var(--muted)' }}>{elegidosLote.length} de {disponibles.length} marcados</small>
          </div>
          {disponibles.length === 0 ? (
            <small style={{ color: 'var(--muted)', display: 'block', marginTop: 8 }}>No hay componentes disponibles para publicar. Ingréselos en el Inventario.</small>
          ) : visiblesLote.length === 0 ? (
            <small style={{ color: 'var(--muted)', display: 'block', marginTop: 8 }}>Ningún componente disponible coincide con «{lote.busca.trim()}».</small>
          ) : (
            <div className="lista-comp" style={{ maxHeight: 300 }}>
              {visiblesLote.map((c) => (
                <label key={c.id} className="lista-comp-item">
                  <input type="checkbox" checked={!!lote.sel[c.id]}
                    onChange={(e) => setLote({ ...lote, sel: { ...lote.sel, [c.id]: e.target.checked } })} />
                  <span className="mono">{c.codigo}</span>
                  <span><b>{c.nombre}</b>{c.sitio && <small> · {c.sitio}</small>}{c.estado === 'por_identificar' && <small> · por identificar</small>}</span>
                  <span className="mono" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{c.valor_referencial != null ? fmtUSD(c.valor_referencial) : ''}</span>
                </label>
              ))}
            </div>
          )}
          <div className="grid g2" style={{ gap: 0, columnGap: 14, marginTop: 14 }}>
            <Field label="Plazo (días)">
              <input type="number" min="1" value={lote.plazo_dias} onChange={(e) => setLote({ ...lote, plazo_dias: e.target.value })} />
            </Field>
            <Field label="Fecha de publicación" hint="Se propone hoy.">
              <DateField value={lote.publicado_el} onChange={(e) => setLote({ ...lote, publicado_el: e.target.value })} />
            </Field>
          </div>
          <label className="check-linea">
            <input type="checkbox" checked={lote.minima} onChange={(e) => setLote({ ...lote, minima: e.target.checked })} />
            <span>
              <b>Usar el valor referencial como oferta mínima</b>
              <small>Cada publicación rechaza las ofertas bajo el valor referencial de su componente. Sin marcar, no hay mínimo.</small>
            </span>
          </label>
        </>)}
      </Modal>

      <Modal open={!!ampliar} title={ampliar && `Ampliar plazo · ${ampliar.codigo}`} onClose={() => setAmpliar(null)}
        footer={<>
          <button className="btn" onClick={() => setAmpliar(null)}>Cancelar</button>
          <button className="btn primary" onClick={ampliarPlazo}>Ampliar plazo</button>
        </>}>
        <p style={{ marginTop: 0 }}>
          <b>{ampliar?.componente}</b> va en el <b>día {ampliar?.dia} de {ampliar?.plazo_dias}</b>
          {ampliar?.ofertas > 0 && <> y tiene <b>{ampliar.ofertas} oferta(s)</b> recibida(s)</>}.
        </p>
        <Field label="Días adicionales" hint="Se suman al plazo actual. El original queda registrado en la bitácora.">
          <input type="number" min="1" max="90" value={dias} onChange={(e) => setDias(e.target.value)} />
        </Field>
        <small style={{ color: 'var(--muted)' }}>
          Nuevo plazo: {(Number(ampliar?.plazo_dias) || 0) + (Number(dias) || 0)} días
          · quedarían {(Number(ampliar?.plazo_dias) || 0) + (Number(dias) || 0) - (Number(ampliar?.dia) || 0)} día(s).
        </small>
      </Modal>

      <Modal open={!!convertir} title={convertir?.vencido ? 'Convertir a chatarra' : 'Forzar conversión a chatarra'} onClose={() => setConvertir(null)}
        footer={<>
          <button className="btn" onClick={() => setConvertir(null)}>Cancelar</button>
          <button className="btn danger" onClick={convertirChatarra}>
            {convertir?.vencido ? 'Convertir a chatarra' : 'Forzar de todas formas'}
          </button>
        </>}>
        <p style={{ marginTop: 0 }}>
          Componente <b>{convertir?.componente}</b> ({convertir?.codigo}).{' '}
          {convertir?.vencido
            ? 'Cumplió su plazo de publicación sin adjudicarse.'
            : <>Todavía está en <b>día {convertir?.dia} de {convertir?.plazo_dias}</b>: el plazo no se ha cumplido.</>}
        </p>
        {convertir?.ofertas > 0 && (
          <p style={{ color: 'var(--bad-tx)', fontWeight: 600 }}>
            ⚠ Esta publicación tiene {convertir.ofertas} oferta(s) recibida(s). Al convertirla a chatarra se descartan sin adjudicar.
          </p>
        )}
        <p style={{ color: 'var(--ink-2)' }}>Se dará de baja como activo y quedará marcado como chatarra. Esta acción no se revierte.</p>
      </Modal>
    </div>
  );
}
