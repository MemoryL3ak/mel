import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtUSD } from '../api.js';
import { DateField, Select, Chip, Empty, Field, Modal, PageHead, hoyISO, useToast } from '../ui.jsx';

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
  const disponibles = comps.filter((c) => ['planificado', 'por_identificar'].includes(c.estado));

  async function publicar() {
    if (!f.componente_id) return toast('Elija el componente a publicar', true);
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
        <button className="btn primary" onClick={() => setNuevo(true)}>+ Publicar componente</button>
      </PageHead>

      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Componente</th><th>Publicado el</th><th style={{ minWidth: 180 }}>Plazo (15 días)</th><th className="num">Ofertas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((p) => {
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
      </div>
      <div className="audit-note" style={{ marginTop: 12 }}>⚙ Al cumplirse el plazo sin adjudicar se cierra la publicación, se descartan las ofertas recibidas —avisando a cada oferente— y el componente queda en el inventario <b>pendiente de clasificar</b>. Entra al programa de limpieza cuando se le asigna patio, categoría y peso.</div>

      <Modal open={nuevo} title="Publicar componente en el portal" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={publicar}>Publicar</button>
        </>}>
        <Field label="Componente" hint="Componentes del inventario sin publicar. La confirmación en terreno no es requisito: se registra después, desde el inventario o el memo.">
          <Select value={f.componente_id} onChange={(e) => setF({ ...f, componente_id: e.target.value })}>
            <option value="">— Elija un componente —</option>
            {disponibles.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}{c.estado === 'por_identificar' ? ' · por identificar en terreno' : ''}</option>)}
          </Select>
        </Field>
        {disponibles.length === 0 && (
          <small style={{ color: 'var(--muted)' }}>No hay componentes disponibles para publicar. Ingréselos en el Inventario.</small>
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
