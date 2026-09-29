import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtUSD } from '../api.js';
import { DateField, Select, Chip, Empty, Field, Modal, PageHead, hoyISO, useToast } from '../ui.jsx';

const EYEBROW = 'Fase 2 · Venta de obsoletos';
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
  return (<>
    <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%`, ...(color ? { background: color } : {}) }} /></div>
    <small style={{ color: tono === 'bad' ? 'var(--bad-tx)' : 'var(--ink-2)', fontWeight: p.vencido ? 700 : 400 }}>{texto}</small>
  </>);
}

export default function Publicaciones() {
  const [rows, setRows] = useState(null);
  const [disponibles, setDisponibles] = useState([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ componente_id: '', oferta_minima: '', plazo_dias: 15, publicado_el: hoyISO() });
  const [convertir, setConvertir] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  const load = () => {
    api('/publicaciones').then(setRows).catch((e) => toast(e.message, true));
    api('/componentes').then((d) => setDisponibles((d.componentes ?? []).filter((c) => ['planificado', 'chatarra'].includes(c.estado)))).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="loading">Cargando publicaciones…</div>;

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
        sub="Control automático de tiempos: a los 15 días sin adjudicar, el componente se convierte en chatarra y pasa al flujo de enajenación.">
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
      <div className="audit-note" style={{ marginTop: 12 }}>⚙ Al cumplirse el plazo sin adjudicar, la conversión a chatarra da de baja el activo y crea el registro en el flujo de enajenación (Fase 1).</div>

      <Modal open={nuevo} title="Publicar componente en el portal" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={publicar}>Publicar</button>
        </>}>
        <Field label="Componente" hint="Solo componentes del inventario que aún no están publicados.">
          <Select value={f.componente_id} onChange={(e) => setF({ ...f, componente_id: e.target.value })}>
            <option value="">— Elija un componente —</option>
            {disponibles.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </Select>
        </Field>
        {disponibles.length === 0 && <small style={{ color: 'var(--muted)' }}>No hay componentes disponibles para publicar. Ingréselos en el Inventario.</small>}
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
