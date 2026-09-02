import { useEffect, useState } from 'react';
import { api, fmtKg } from '../api.js';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

export default function Cuadratura() {
  const [data, setData] = useState(null);
  const [cerrar, setCerrar] = useState(false);
  const [obs, setObs] = useState('');
  const toast = useToast();

  const load = (s) => {
    const qs = s ? `?anio=${s.anio}&semana=${s.semana}` : '';
    api('/cuadratura' + qs).then(setData).catch((e) => toast(e.message, true));
  };
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Cargando cuadratura…</div>;

  const mover = (delta) => {
    let { anio, semana } = data;
    semana += delta;
    if (semana < 1) { anio -= 1; semana = 52; }
    if (semana > 52) { anio += 1; semana = 1; }
    load({ anio, semana });
  };

  async function cerrarSemana() {
    try {
      const r = await api('/cuadratura/cerrar', { method: 'POST', body: { anio: data.anio, semana: data.semana, observacion: obs } });
      toast(r.estado === 'cuadrada' ? 'Semana cuadrada sin diferencias' : 'Cuadratura cerrada con diferencias registradas');
      setCerrar(false); setObs('');
      load({ anio: data.anio, semana: data.semana });
    } catch (e) { toast(e.message, true); }
  }

  const hayDif = data.detalle.some((x) => x.observados > 0 || (x.dif_pct != null && Math.abs(x.dif_pct) > 2));

  return (
    <div>
      <PageHead title="Cuadratura semanal de movimientos"
        sub="Cruce de los kilos de la semana entre las guías MEL, las recepciones en La Negra y los traslados a Lampa, por categoría. El cierre guarda un registro inmutable.">
        {!data.cerrada && data.detalle.length > 0 && (
          <button className="btn primary" onClick={() => setCerrar(true)}>Cerrar cuadratura S{data.semana}</button>
        )}
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
            {data.desde} — {data.hasta}
            {data.cerrada && <> · <Chip tone={data.cerrada.estado === 'cuadrada' ? 'ok' : 'warn'}>
              {data.cerrada.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencias'}</Chip></>}
          </small>
        </div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Kg guías MEL</th><th className="num">Kg La Negra</th><th className="num">Dif. recepción</th><th className="num">Kg desp. Lampa</th><th className="num">Kg rec. Lampa</th><th className="num">En tránsito</th><th className="num">Observados</th></tr></thead>
          <tbody>
            {(data.cerrada?.detalle ?? data.detalle).map((x) => (
              <tr key={x.categoria}>
                <td><b>{x.categoria}</b></td>
                <td className="num">{fmtKg(x.kg_mel)}</td>
                <td className="num">{fmtKg(x.kg_lanegra)}</td>
                <td className="num" style={x.dif_pct != null && Math.abs(x.dif_pct) > 2 ? { color: 'var(--bad-tx)', fontWeight: 700 } : {}}>
                  {x.dif_pct != null ? `${x.dif_pct.toFixed(2)} %` : '—'}
                </td>
                <td className="num">{fmtKg(x.kg_lampa_desp)}</td>
                <td className="num">{fmtKg(x.kg_lampa_rec)}</td>
                <td className="num">{x.pendientes_transito || '—'}</td>
                <td className="num" style={x.observados ? { color: 'var(--warn-tx)', fontWeight: 700 } : {}}>{x.observados || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.detalle.length === 0 && !data.cerrada && <Empty title="Semana sin movimientos">No hay despachos ni traslados registrados en este rango.</Empty>}
        {data.cerrada?.observacion && <div className="card-b audit-note">Observación del cierre: {data.cerrada.observacion} — {data.cerrada.generada_por}</div>}
      </div>

      <div className="card">
        <div className="card-h"><h3>Cierres históricos</h3><small>últimas 12 semanas cerradas</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Semana</th><th>Estado</th><th>Cerrada por</th><th>Observación</th></tr></thead>
          <tbody>
            {data.historico.map((c) => (
              <tr key={c.id}>
                <td className="mono">S{c.semana}/{c.anio}</td>
                <td><Chip tone={c.estado === 'cuadrada' ? 'ok' : 'warn'}>{c.estado === 'cuadrada' ? 'Cuadrada' : 'Con diferencias'}</Chip></td>
                <td>{c.generada_por}</td>
                <td style={{ color: 'var(--ink-2)', maxWidth: 320 }}>{c.observacion || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.historico.length === 0 && <Empty title="Sin cierres aún">La primera cuadratura cerrada quedará registrada aquí.</Empty>}
      </div>

      <Modal open={cerrar} title={`Cerrar cuadratura · semana ${data.semana}`} onClose={() => setCerrar(false)}
        footer={<>
          <button className="btn" onClick={() => setCerrar(false)}>Cancelar</button>
          <button className="btn primary" onClick={cerrarSemana}>Cerrar cuadratura</button>
        </>}>
        <p style={{ marginTop: 0, color: 'var(--ink-2)' }}>
          {hayDif
            ? 'La semana registra diferencias sobre el 2% o recepciones observadas: la observación es obligatoria y quedará en el registro.'
            : 'Los movimientos cuadran dentro de la tolerancia. El cierre guarda un registro inmutable de la semana.'}
        </p>
        <Field label={hayDif ? 'Observación (obligatoria)' : 'Observación (opcional)'}>
          <textarea rows="2" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej.: diferencia por humedad en fierro liviano; guía GD-1007 en revisión con vendor." />
        </Field>
      </Modal>
    </div>
  );
}
