import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtCLP, fmtKg } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, KPI, PageHead, useToast } from '../ui.jsx';

const EP_CHIP = {
  generado: ['neutral', 'Generado'], en_revision: ['warn', 'En revisión'], con_ajustes: ['bad', 'Con ajustes'],
  firmado: ['info', 'Firmado'], facturado: ['info', 'Facturado'], pagado: ['warn', 'Pagado'], conciliado: ['ok', 'Conciliado'],
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const saludo = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
};

function Nodo({ label, kg, sub }) {
  return (
    <div className="fnode">
      <span className="flbl"><i />{label}</span>
      <span className="fval display">{fmtKg(kg)} <small>kg</small></span>
      <span className="fsub">{sub}</span>
    </div>
  );
}

function Spark({ serie }) {
  const max = Math.max(1, ...serie.map((s) => s.kg));
  return (
    <div className="spark" aria-hidden="true">
      {serie.map((s, i) => (
        <i key={i} className={s.kg ? '' : 'zero'} style={{ height: `${Math.max(6, (s.kg / max) * 100)}%` }}
          title={`día ${s.dia}: ${fmtKg(s.kg)} kg`} />
      ))}
    </div>
  );
}

export default function Panel() {
  const [data, setData] = useState(null);
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();

  useEffect(() => { api('/panel').then(setData).catch((e) => toast(e.message, true)); }, []);
  if (!data) return <div className="loading">Cargando panel…</div>;
  const { flujo, serie14, kpis, pendientes, actividad } = data;
  const nombre = user.name.split(' ')[0];
  const mes = MESES[new Date().getMonth()];

  return (
    <div>
      <PageHead title="Panel de control" sub="Estado del proceso de chatarra: lo que requiere su decisión aparece primero." />

      <section className="hero" aria-label="Flujo del material del mes">
        <div className="hero-top">
          <div>
            <div className="hola">{saludo()}, {nombre} · así se mueve el material este mes</div>
            <h2>Flujo de enajenación · {mes}</h2>
          </div>
          <span className="tag">Trazado de punta a punta</span>
        </div>
        <div className="flow">
          <Nodo label="Patios MEL" kg={flujo.kg_patios} sub={`${flujo.guias} guía(s) despachada(s) en el mes`} />
          <div className="fjoin" aria-hidden="true" />
          <Nodo label="La Negra · vendor" kg={flujo.kg_lanegra} sub="recepcionado, pesado y clasificado" />
          <div className="fjoin" aria-hidden="true" />
          <Nodo label="Lampa · disposición" kg={flujo.kg_lampa} sub={`${flujo.certs} certificado(s) de disposición final`} />
        </div>
      </section>

      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="card kpi">
          <span className="ico">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 20V10M12 20V4M18 20v-8" /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lbl">Actividad · 14 días</div>
            <div className="val">{fmtKg(serie14.reduce((a, s) => a + s.kg, 0))}<small> kg</small></div>
            <Spark serie={serie14} />
          </div>
        </div>
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
