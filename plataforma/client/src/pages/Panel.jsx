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
        <KPI label="Kg recepcionados · mes" value={fmtKg(kpis.kg_mes)} unit="kg" delta="pesaje validado en La Negra"
          ico={<path d="M6 20V10M12 20V4M18 20v-8" />} />
        <KPI label="Valorizado · mes" value={fmtCLP(kpis.valor_mes)} delta="según tabla de precios del contrato"
          ico={<path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5h-4a2.5 2.5 0 0 0 0 5h6" />} />
        <KPI label="Despachos en tránsito" value={kpis.en_transito} delta="camiones por recepcionar en La Negra"
          ico={<><path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" /><circle cx="6" cy="18" r="1.6" /><circle cx="16" cy="18" r="1.6" /></>} />
        <KPI label={`Programa semana ${kpis.programa.semana}`}
          value={`${kpis.programa.ejecutadas}/${kpis.programa.total || '—'}`}
          delta="actividades ejecutadas / planificadas"
          ico={<><path d="M5 5h14v15H5zM5 9h14M9 3v4M15 3v4" /><path d="M9 14l2 2 4-4" /></>} />
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
