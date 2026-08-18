import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Chip, Field, KPI, Modal, PageHead, useToast } from '../ui.jsx';

const CHIP = { ejecutado: ['ok', 'Ejecutado'], programado: ['info', 'Programado'], reprogramado: ['warn', 'Reprogramado'] };

export default function Programa() {
  const [data, setData] = useState(null);
  const [semana, setSemana] = useState(null);
  const [ejec, setEjec] = useState(null); // fila en ejecución
  const [ton, setTon] = useState('');
  const toast = useToast();

  const load = () => api('/programa').then((d) => {
    setData(d);
    setSemana((s) => s ?? Math.max(...d.semanas));
  }).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando programa…</div>;

  const rows = data.rows.filter((r) => r.semana === semana);
  const ejecutados = rows.filter((r) => r.estado === 'ejecutado');
  const tonReal = ejecutados.reduce((s, r) => s + (r.real_ton || 0), 0);
  const tonEst = rows.reduce((s, r) => s + (r.est_ton || 0), 0);

  async function registrar() {
    try {
      await api(`/programa/${ejec.id}/ejecutar`, { method: 'POST', body: { real_ton: +ton } });
      toast(`Retiro registrado: ${ton} t en ${ejec.patio}`);
      setEjec(null); setTon('');
      load();
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div className="page">
      <PageHead title="Programa de limpieza de patios" sub="Planificación semanal asignada a Serlim Ltda. y seguimiento de cumplimiento.">
        {data.semanas.map((s) => (
          <button key={s} className={`btn ${s === semana ? 'primary' : ''}`} onClick={() => setSemana(s)}>Semana {s}</button>
        ))}
      </PageHead>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <KPI label={`Cumplimiento semana ${semana}`} value={rows.length ? Math.round((ejecutados.length / rows.length) * 100) : 0} unit="%"
          delta={`${ejecutados.length} de ${rows.length} retiros ejecutados`} />
        <KPI label="Retiros programados" value={rows.length} delta={`${new Set(rows.map((r) => r.patio)).size} patios`} />
        <KPI label="Tonelaje retirado · semana" value={tonReal.toLocaleString('es-CL', { maximumFractionDigits: 1 })} unit="t"
          delta={`planificado: ${tonEst.toLocaleString('es-CL')} t`} />
      </div>
      <div className="card">
        <div className="card-h"><h3>Semana {semana} · agosto 2026</h3><small>empresa asignada: Serlim Ltda.</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Día</th><th>Patio</th><th>Material previsto</th><th className="num">Est. (t)</th><th className="num">Real (t)</th><th>Evidencia</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.dia}</td><td>{r.patio}</td><td>{r.material}</td>
                <td className="num">{r.est_ton?.toLocaleString('es-CL')}</td>
                <td className="num">{r.real_ton ? r.real_ton.toLocaleString('es-CL') : '—'}</td>
                <td>{r.estado === 'ejecutado' ? <div className="thumbs"><i /><i /><i /></div> : '—'}</td>
                <td><Chip tone={CHIP[r.estado][0]}>{CHIP[r.estado][1]}</Chip></td>
                <td className="num">
                  {r.estado !== 'ejecutado' && (
                    <button className="btn sm" onClick={() => { setEjec(r); setTon(String(r.est_ton)); }}>Registrar retiro</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <Modal open={!!ejec} title={`Registrar retiro · ${ejec?.patio}`} onClose={() => setEjec(null)}
        footer={<>
          <button className="btn" onClick={() => setEjec(null)}>Cancelar</button>
          <button className="btn primary" onClick={registrar}>Registrar con evidencia</button>
        </>}>
        <Field label="Tonelaje real retirado (t)">
          <input type="number" step="0.1" value={ton} onChange={(e) => setTon(e.target.value)} />
        </Field>
        <Field label="Evidencia fotográfica">
          <input type="file" multiple accept="image/*" />
        </Field>
        <small style={{ color: 'var(--muted)' }}>El registro queda en la bitácora de auditoría con su usuario y hora.</small>
      </Modal>
    </div>
  );
}
