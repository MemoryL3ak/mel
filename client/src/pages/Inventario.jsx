import { useEffect, useState } from 'react';
import { api, fmtCLP } from '../api.js';
import { Chip, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = {
  planificado: ['neutral', 'Planificado'], publicado: ['info', 'Publicado'],
  adjudicado: ['ok', 'Adjudicado'], convertido: ['bad', 'Convertido a chatarra'],
};

export default function Inventario() {
  const [comps, setComps] = useState(null);
  const [entregas, setEntregas] = useState([]);
  const [maestros, setMaestros] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: '', descripcion: '', patio_id: 1, sector: '', valor_ref: '' });
  const [agenda, setAgenda] = useState(null);
  const [fechaAg, setFechaAg] = useState('');
  const toast = useToast();

  const load = () => Promise.all([api('/componentes'), api('/entregas'), api('/maestros')])
    .then(([c, e, m]) => { setComps(c); setEntregas(e); setMaestros(m); })
    .catch((err) => toast(err.message, true));
  useEffect(() => { load(); }, []);
  if (!comps) return <div className="loading">Cargando inventario…</div>;

  async function crear() {
    try {
      const r = await api('/componentes', { method: 'POST', body: { ...form, valor_ref: +form.valor_ref } });
      toast(`Componente ${r.codigo} ingresado al inventario`);
      setNuevo(false); setForm({ nombre: '', descripcion: '', patio_id: 1, sector: '', valor_ref: '' });
      load();
    } catch (e) { toast(e.message, true); }
  }
  async function publicar(c) {
    try {
      await api(`/componentes/${c.id}/publicar`, { method: 'POST' });
      toast(`${c.nombre} publicado en el portal — plazo de 15 días iniciado`);
      load();
    } catch (e) { toast(e.message, true); }
  }
  async function notificar(e) {
    try {
      await api(`/entregas/${e.id}/notificar`, { method: 'POST' });
      toast('Notificación de retiro enviada al comprador');
    } catch (err) { toast(err.message, true); }
  }
  async function agendar() {
    try {
      await api(`/entregas/${agenda.id}/agendar`, { method: 'POST', body: { fecha: fechaAg } });
      toast(`Retiro agendado para el ${fechaAg}`);
      setAgenda(null); setFechaAg('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div className="page">
      <PageHead title="Inventario y logística de obsoletos" sub="Planificación de venta, ubicación en terreno y bandeja de pendientes de entrega con alertas.">
        <button className="btn primary" onClick={() => setNuevo(true)}>+ Ingresar componente</button>
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}><div className="tbl-wrap"><table>
        <thead><tr><th>Componente</th><th>Código</th><th>Ubicación en terreno</th><th className="num">Valor referencial</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {comps.map((c) => (
            <tr key={c.id}>
              <td><b>{c.nombre}</b><br /><small style={{ color: 'var(--muted)' }}>{c.descripcion}</small></td>
              <td className="mono">{c.codigo}</td>
              <td>{c.patio} · {c.sector}</td>
              <td className="num">{fmtCLP(c.valor_ref)}</td>
              <td>
                <Chip tone={CHIP[c.estado][0]}>
                  {CHIP[c.estado][1]}{c.estado === 'publicado' && ` · día ${c.dias_publicado}`}
                </Chip>
                {c.comprador && <><br /><small style={{ color: 'var(--muted)' }}>{c.comprador}</small></>}
              </td>
              <td className="num">
                {c.estado === 'planificado' && <button className="btn sm primary" onClick={() => publicar(c)}>Publicar</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div></div>

      <div className="card">
        <div className="card-h"><h3>Pendientes de entrega</h3><small>adjudicados sin retiro completado</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Componente</th><th>Comprador</th><th>Adjudicado el</th><th className="num">Días de espera</th><th>Alerta</th><th></th></tr></thead>
          <tbody>
            {entregas.map((e) => (
              <tr key={e.id}>
                <td>{e.componente}</td><td>{e.comprador}</td><td>{e.adjudicado_el}</td>
                <td className="num">{e.dias_espera}</td>
                <td>{e.estado === 'sin_coordinacion'
                  ? <Chip tone="bad">Sin coordinación</Chip>
                  : <Chip tone="warn">Retiro agendado {e.agenda}</Chip>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn sm" onClick={() => notificar(e)}>Notificar</button>{' '}
                  {e.estado === 'sin_coordinacion' && <button className="btn sm primary" onClick={() => setAgenda(e)}>Agendar retiro</button>}
                </td>
              </tr>
            ))}
            {!entregas.length && <tr><td className="loading">Sin entregas pendientes.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <Modal open={nuevo} title="Ingresar componente obsoleto" onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={crear}>Ingresar al inventario</button>
        </>}>
        <Field label="Nombre del componente"><input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej.: Bomba centrífuga 14×12" /></Field>
        <Field label="Descripción / ficha técnica"><textarea rows="2" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></Field>
        <div className="grid g2" style={{ gap: 10 }}>
          <Field label="Patio">
            <select value={form.patio_id} onChange={(e) => setForm({ ...form, patio_id: +e.target.value })}>
              {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Sector / coordenada"><input value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} placeholder="Sector B-2" /></Field>
        </div>
        <Field label="Valor referencial (CLP)"><input type="number" value={form.valor_ref} onChange={(e) => setForm({ ...form, valor_ref: e.target.value })} /></Field>
      </Modal>

      <Modal open={!!agenda} title={`Agendar retiro · ${agenda?.componente}`} onClose={() => setAgenda(null)}
        footer={<>
          <button className="btn" onClick={() => setAgenda(null)}>Cancelar</button>
          <button className="btn primary" onClick={agendar}>Agendar</button>
        </>}>
        <Field label="Fecha de retiro comprometida">
          <input type="date" value={fechaAg} onChange={(e) => setFechaAg(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
