import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtCLP, fmtKg } from '../api.js';
import { Chip, KPI, PageHead, useToast } from '../ui.jsx';

const EP_CHIP = {
  generado: ['neutral', 'Generado'], en_revision: ['warn', 'En revisión'], con_ajustes: ['bad', 'Con ajustes'],
  firmado: ['info', 'Firmado'], facturado: ['info', 'Facturado'], pagado: ['warn', 'Pagado'], conciliado: ['ok', 'Conciliado'],
};

export default function Panel() {
  const [data, setData] = useState(null);
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { api('/panel').then(setData).catch((e) => toast(e.message, true)); }, []);
  if (!data) return <div className="loading">Cargando panel…</div>;
  const { kpis, pendientes, actividad } = data;

  return (
    <div>
      <PageHead title="Panel de control" sub="Estado del proceso de chatarra: lo que requiere su decisión aparece primero." />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <KPI label="Kg recepcionados · mes" value={fmtKg(kpis.kg_mes)} unit="kg" delta="pesaje validado en La Negra" />
        <KPI label="Valorizado · mes" value={fmtCLP(kpis.valor_mes)} delta="según tabla de precios del contrato" />
        <KPI label="Despachos en tránsito" value={kpis.en_transito} delta="camiones por recepcionar en La Negra" />
        <KPI label={`Programa semana ${kpis.programa.semana}`}
          value={`${kpis.programa.ejecutadas}/${kpis.programa.total || '—'}`}
          delta="actividades ejecutadas / planificadas" />
      </div>

      <div className="grid g2">
        <div className="card">
          <div className="card-h"><h3>Pendientes</h3><small>requieren acción</small></div>
          {pendientes.length === 0 && <div className="empty"><b>Sin pendientes</b>El proceso está al día.</div>}
          {pendientes.map((p, i) => (
            <div className="pend" key={i}>
              <Chip tone={p.tipo}>{p.tag}</Chip>
              <span>{p.texto}</span>
              <button className="btn sm go" onClick={() => nav('/' + p.destino)}>Ir</button>
            </div>
          ))}
          {kpis.ep && (
            <div className="pend" style={{ background: 'var(--surface-2)' }}>
              <span className="mono">{kpis.ep.folio}</span>
              <Chip tone={EP_CHIP[kpis.ep.estado][0]}>{EP_CHIP[kpis.ep.estado][1]}</Chip>
              <span style={{ color: 'var(--ink-2)' }}>{fmtCLP(kpis.ep.total)}</span>
              <button className="btn sm go" onClick={() => nav('/estados')}>Ver EP</button>
            </div>
          )}
        </div>
        <div className="card">
          <div className="card-h"><h3>Actividad reciente</h3><small>bitácora de auditoría</small></div>
          {actividad.length === 0 && <div className="empty"><b>Sin actividad</b>Las acciones del sistema aparecerán aquí.</div>}
          {actividad.map((a) => (
            <div className="act" key={a.id}>
              <span><b>{a.usuario}</b> · {a.accion}{a.objeto ? ` — ${a.objeto}` : ''}</span>
              <span className="when">{a.fecha}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
