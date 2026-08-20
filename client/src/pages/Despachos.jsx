import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Field, Modal, PageHead, Tabs, useToast } from '../ui.jsx';

const CHIP = {
  recepcionado: ['ok', 'Recepcionado'], en_transito: ['info', 'En tránsito'], observado: ['warn', 'Difer. de peso'],
};

export default function Despachos() {
  const [rows, setRows] = useState(null);
  const [maestros, setMaestros] = useState(null);
  const [tab, setTab] = useState('d1');
  const [detalle, setDetalle] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [recep, setRecep] = useState(null);
  const [form, setForm] = useState({ patio_id: 1, categoria_id: 1, kg_origen: '' });
  const [kgDest, setKgDest] = useState('');
  const { user } = useAuth();
  const toast = useToast();
  // Componente convertido a chatarra que derivó hasta aquí (destaca la asociación)
  const [conv, setConv] = useState(useLocation().state?.conv || null);

  const load = () => api('/despachos').then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => { load(); api('/maestros').then(setMaestros).catch(() => {}); }, []);
  if (!rows) return <div className="loading">Cargando despachos…</div>;

  const puedeCrear = ['limpieza', 'ito', 'coordinador'].includes(user.role);
  const puedeRecep = ['vendor', 'ito', 'coordinador'].includes(user.role);

  async function crear() {
    try {
      const d = await api('/despachos', { method: 'POST', body: { ...form, kg_origen: +form.kg_origen, fotos: 3 } });
      toast(`Despacho ${d.guia} registrado con evidencia`);
      setNuevo(false); setForm({ patio_id: 1, categoria_id: 1, kg_origen: '' });
      load();
    } catch (e) { toast(e.message, true); }
  }
  async function recepcionar() {
    try {
      const r = await api(`/despachos/${recep.id}/recepcionar`, { method: 'POST', body: { kg_destino: +kgDest } });
      toast(r.estado === 'observado' ? 'Recepción registrada con observación (dif. >2%)' : 'Recepción validada');
      setRecep(null); setKgDest('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  const recepciones = rows.filter((r) => r.kg_destino != null);
  return (
    <div className="page">
      <PageHead title="Despachos y recepciones" sub="Registro con evidencia: pesaje, fotografías y guía vinculada. La valorización se calcula automáticamente con la tabla de precios del contrato.">
        {puedeCrear && <button className="btn primary" onClick={() => setNuevo(true)}>+ Registrar despacho</button>}
      </PageHead>

      {conv && (
        <div className="conv-banner">
          <div>
            <b>◈ Proveniente de conversión automática · <span className="mono">{conv.codigo}</span></b>
            <p>«{conv.nombre}» se convirtió a chatarra al cumplir 15 días publicado sin adjudicarse. El material está en <b>{conv.patio} · {conv.sector}</b> con su baja documentada (<span className="mono">SCRAP-{conv.codigo}.pdf</span>). Su retiro entra a este flujo: se programa en la limpieza de patios y se registra aquí como despacho valorizado.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {puedeCrear && <button className="btn sm primary" onClick={() => { setNuevo(true); }}>Registrar su despacho</button>}
            <button className="btn sm" onClick={() => setConv(null)}>Entendido</button>
          </div>
        </div>
      )}
      <Tabs tabs={[['d1', 'Despachos'], ['d2', 'Recepciones vendor']]} active={tab} onChange={setTab} />

      {tab === 'd1' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía</th><th>Fecha</th><th>Patio origen</th><th>Categoría</th><th className="num">Peso (kg)</th><th className="num">Valorización</th><th>Evidencia</th><th>Estado</th><th>EP</th><th></th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.guia}</td><td>{d.fecha}</td><td>{d.patio}</td><td>{d.categoria}</td>
                <td className="num">{fmtKg(d.kg_destino ?? d.kg_origen)}</td>
                <td className="num">{fmtCLP(d.valor)}</td>
                <td><div className="thumbs">{Array.from({ length: d.fotos }).map((_, i) => <i key={i} />)}</div></td>
                <td><Chip tone={CHIP[d.estado][0]}>{CHIP[d.estado][1]}</Chip></td>
                <td className="mono">{d.ep_folio || '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => setDetalle(d)}>Detalle</button>{' '}
                  {d.estado === 'en_transito' && puedeRecep && (
                    <button className="btn sm primary" onClick={() => { setRecep(d); setKgDest(String(d.kg_origen)); }}>Recepcionar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}

      {tab === 'd2' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Guía</th><th>Recepción</th><th className="num">Peso origen (kg)</th><th className="num">Peso destino (kg)</th><th className="num">Diferencia</th><th>Validación</th></tr></thead>
          <tbody>
            {recepciones.map((d) => {
              const dif = ((d.kg_destino - d.kg_origen) / d.kg_origen) * 100;
              return (
                <tr key={d.id}>
                  <td className="mono">{d.guia}</td><td>Metarec SpA · báscula</td>
                  <td className="num">{fmtKg(d.kg_origen)}</td><td className="num">{fmtKg(d.kg_destino)}</td>
                  <td className="num" style={dif < -2 ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>{dif.toFixed(2)} %</td>
                  <td><Chip tone={d.estado === 'observado' ? 'warn' : 'ok'}>{d.estado === 'observado' ? 'Observada' : 'Validada'}</Chip></td>
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
      )}

      <Modal open={!!detalle} title={detalle && `Despacho ${detalle.guia}`} onClose={() => setDetalle(null)}
        footer={<button className="btn" onClick={() => setDetalle(null)}>Cerrar</button>}>
        {detalle && (
          <>
            <div className="grid g2" style={{ gap: 10, marginBottom: 14 }}>
              <div><small style={{ color: 'var(--muted)' }}>Patio origen</small><br /><b>{detalle.patio}</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Categoría</small><br /><b>{detalle.categoria} · ${detalle.precio_kg}/kg</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Peso</small><br /><b>{fmtKg(detalle.kg_destino ?? detalle.kg_origen)} kg</b></div>
              <div><small style={{ color: 'var(--muted)' }}>Valorización</small><br /><b>{fmtCLP(detalle.valor)}</b></div>
            </div>
            <small style={{ color: 'var(--muted)' }}>Evidencia fotográfica ({detalle.fotos})</small>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              {['#C9CFD6,#8A939C', '#D8C4B4,#A4785A', '#B8C6BB,#7E948B'].slice(0, detalle.fotos).map((g) => (
                <div key={g} style={{ flex: 1, height: 90, borderRadius: 8, background: `linear-gradient(140deg,${g})` }} />
              ))}
            </div>
            {detalle.ep_folio && <div className="audit-note">Incluido en el estado de pago <b>&nbsp;{detalle.ep_folio}</b></div>}
          </>
        )}
      </Modal>

      <Modal open={nuevo} title="Registrar despacho de chatarra" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={crear}>Registrar despacho</button>
        </>}>
        <Field label="Patio de origen">
          <select value={form.patio_id} onChange={(e) => setForm({ ...form, patio_id: +e.target.value })}>
            {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Categoría de material">
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre} · ${c.precio_kg}/kg</option>)}
          </select>
        </Field>
        <Field label="Peso en báscula MEL (kg)">
          <input type="number" value={form.kg_origen} onChange={(e) => setForm({ ...form, kg_origen: e.target.value })} placeholder="0" />
        </Field>
        <Field label="Evidencia fotográfica"><input type="file" multiple accept="image/*" /></Field>
        <small style={{ color: 'var(--muted)' }}>La guía se folia automáticamente y la carga queda valorizada con la tabla de precios vigente.</small>
      </Modal>

      <Modal open={!!recep} title={recep && `Recepcionar ${recep.guia} en destino`} onClose={() => setRecep(null)}
        footer={<>
          <button className="btn" onClick={() => setRecep(null)}>Cancelar</button>
          <button className="btn primary" onClick={recepcionar}>Validar recepción</button>
        </>}>
        <Field label={`Peso validado en báscula destino (origen: ${recep && fmtKg(recep.kg_origen)} kg)`}>
          <input type="number" value={kgDest} onChange={(e) => setKgDest(e.target.value)} />
        </Field>
        <small style={{ color: 'var(--muted)' }}>Una diferencia mayor al 2% deja la recepción observada para revisión del ITO.</small>
      </Modal>
    </div>
  );
}
