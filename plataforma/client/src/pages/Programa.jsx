import { useEffect, useState } from 'react';
import { api, fmtTon } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = {
  programado: ['info', 'Programado'], ejecutado: ['ok', 'Ejecutado'],
  reprogramado: ['warn', 'Reprogramado'], cancelado: ['neutral', 'Cancelado'],
};
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default function Programa() {
  const [data, setData] = useState(null);
  const [maestros, setMaestros] = useState(null);
  const [sel, setSel] = useState(null);          // {anio, semana} seleccionada
  const [nuevo, setNuevo] = useState(false);
  const [ejec, setEjec] = useState(null);
  const [repro, setRepro] = useState(null);
  const [form, setForm] = useState({ dia: 'Lun', patio_id: 1, categoria_id: 1, ton_estimadas: '' });
  const [tonReal, setTonReal] = useState('');
  const [obs, setObs] = useState('');
  const { user } = useAuth();
  const toast = useToast();

  const load = (s) => {
    const qs = s ? `?anio=${s.anio}&semana=${s.semana}` : '';
    api('/programa' + qs).then((d) => { setData(d); setSel({ anio: d.anio, semana: d.semana }); })
      .catch((e) => toast(e.message, true));
  };
  useEffect(() => { load(); api('/maestros').then(setMaestros).catch(() => {}); }, []);
  if (!data) return <div className="loading">Cargando programa…</div>;

  const puedePlanificar = ['limpieza', 'coordinador'].includes(user.role);
  const puedeEjecutar = ['limpieza', 'ito', 'coordinador'].includes(user.role);
  const mover = (delta) => {
    let { anio, semana } = sel;
    semana += delta;
    if (semana < 1) { anio -= 1; semana = 52; }
    if (semana > 52) { anio += 1; semana = 1; }
    load({ anio, semana });
  };

  async function duplicar() {
    try {
      const r = await api('/programa/duplicar', { method: 'POST', body: { anio: sel.anio, semana: sel.semana } });
      toast(`${r.length} actividades copiadas de la semana anterior`);
      load(sel);
    } catch (e) { toast(e.message, true); }
  }
  async function crear() {
    try {
      await api('/programa', { method: 'POST', body: { ...form, anio: sel.anio, semana: sel.semana, ton_estimadas: +form.ton_estimadas } });
      toast('Actividad planificada');
      setNuevo(false); setForm({ ...form, ton_estimadas: '' });
      load(sel);
    } catch (e) { toast(e.message, true); }
  }
  async function ejecutar() {
    try {
      await api(`/programa/${ejec.id}/ejecutar`, { method: 'POST', body: { ton_reales: +tonReal } });
      toast('Ejecución registrada');
      setEjec(null); setTonReal('');
      load(sel);
    } catch (e) { toast(e.message, true); }
  }
  async function reprogramar() {
    try {
      await api(`/programa/${repro.id}/reprogramar`, { method: 'POST', body: { observacion: obs } });
      toast('Actividad reprogramada');
      setRepro(null); setObs('');
      load(sel);
    } catch (e) { toast(e.message, true); }
  }

  const c = data.cumplimiento;
  return (
    <div>
      <PageHead title="Programa de limpieza de patios"
        sub="Planificación semanal de despachos por tipo de material, enviada por la empresa de limpieza, con seguimiento de cumplimiento.">
        {puedePlanificar && data.rows.length === 0 && (
          <button className="btn" onClick={duplicar}>⧉ Copiar semana anterior</button>
        )}
        {puedePlanificar && <button className="btn primary" onClick={() => setNuevo(true)}>+ Planificar actividad</button>}
      </PageHead>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn sm" onClick={() => mover(-1)}>←</button>
            <h3>Semana {data.semana} · {data.anio}</h3>
            <button className="btn sm" onClick={() => mover(1)}>→</button>
            {(data.semana !== data.actual.semana || data.anio !== data.actual.anio) &&
              <button className="btn sm" onClick={() => load(data.actual)}>Hoy</button>}
          </div>
          <small>
            {c.actividades.ejecutadas} de {c.actividades.total} ejecutadas
            {c.pct_tonelaje != null && ` · cumplimiento tonelaje ${c.pct_tonelaje}%`}
          </small>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Día</th><th>Patio</th><th>Material</th><th className="num">Estimado</th><th className="num">Real</th><th>Estado</th><th>Observación</th><th></th></tr></thead>
          <tbody>
            {data.rows.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.dia}</td>
                <td>{p.patios?.codigo} <span style={{ color: 'var(--muted)' }}>· {p.patios?.nombre}</span></td>
                <td>{p.categorias?.nombre}</td>
                <td className="num">{fmtTon(p.ton_estimadas)}</td>
                <td className="num">{p.ton_reales != null ? fmtTon(p.ton_reales) : '—'}</td>
                <td><Chip tone={CHIP[p.estado][0]}>{CHIP[p.estado][1]}</Chip></td>
                <td style={{ color: 'var(--ink-2)', maxWidth: 220 }}>{p.observacion || '—'}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  {p.estado === 'programado' && puedeEjecutar && (
                    <>
                      <button className="btn sm primary" onClick={() => { setEjec(p); setTonReal(String(p.ton_estimadas)); }}>Ejecutar</button>{' '}
                      {puedePlanificar && <button className="btn sm" onClick={() => setRepro(p)}>Reprogramar</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.rows.length === 0 && <Empty title="Semana sin planificación">La empresa de limpieza aún no envía el programa de esta semana.</Empty>}
      </div>

      <Modal open={nuevo} title={`Planificar actividad · semana ${sel?.semana}`} onClose={() => setNuevo(false)}
        footer={<>
          <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
          <button className="btn primary" onClick={crear}>Planificar</button>
        </>}>
        <Field label="Día">
          <select value={form.dia} onChange={(e) => setForm({ ...form, dia: e.target.value })}>
            {DIAS.map((d) => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="Patio de origen">
          <select value={form.patio_id} onChange={(e) => setForm({ ...form, patio_id: +e.target.value })}>
            {maestros?.patios.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Tipo de material">
          <select value={form.categoria_id} onChange={(e) => setForm({ ...form, categoria_id: +e.target.value })}>
            {maestros?.categorias.map((c2) => <option key={c2.id} value={c2.id}>{c2.nombre}</option>)}
          </select>
        </Field>
        <Field label="Tonelaje estimado (t)">
          <input type="number" min="0.1" step="0.1" value={form.ton_estimadas}
            onChange={(e) => setForm({ ...form, ton_estimadas: e.target.value })} placeholder="0" />
        </Field>
      </Modal>

      <Modal open={!!ejec} title={ejec && `Registrar ejecución · ${ejec.dia} ${ejec.patios?.codigo}`} onClose={() => setEjec(null)}
        footer={<>
          <button className="btn" onClick={() => setEjec(null)}>Cancelar</button>
          <button className="btn primary" onClick={ejecutar}>Registrar</button>
        </>}>
        <Field label={`Tonelaje real retirado (estimado: ${ejec && fmtTon(ejec.ton_estimadas)})`}>
          <input type="number" min="0.1" step="0.1" value={tonReal} onChange={(e) => setTonReal(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={!!repro} title={repro && `Reprogramar · ${repro.dia} ${repro.patios?.codigo}`} onClose={() => setRepro(null)}
        footer={<>
          <button className="btn" onClick={() => setRepro(null)}>Cancelar</button>
          <button className="btn primary" onClick={reprogramar}>Reprogramar</button>
        </>}>
        <Field label="Motivo (obligatorio)" hint="Queda registrado en la actividad y en la bitácora de auditoría.">
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: clima, prioridad operacional, falta de equipo…" />
        </Field>
      </Modal>
    </div>
  );
}
