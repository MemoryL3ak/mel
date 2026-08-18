import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtCLP } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Chip, KPI, PageHead } from '../ui.jsx';
import { BarChart, LineChart, mesLabel } from '../charts.jsx';

const DEST = { estados: '/estados', publicaciones: '/publicaciones', inventario: '/inventario', documental: '/documental' };

export default function Panel() {
  const [d, setD] = useState(null);
  const nav = useNavigate();
  const { can } = useAuth();
  useEffect(() => { api('/panel').then(setD).catch(() => {}); }, []);
  if (!d) return <div className="loading">Cargando panel…</div>;

  const labels = d.serie.map((s) => mesLabel(s.mes));
  return (
    <div className="page">
      <PageHead title="Panel de control" sub={`Resumen operativo de ambos procesos · datos en vivo desde la API`} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <KPI label="Tonelaje despachado · mes" value={d.kpis.tonelaje_mes.toLocaleString('es-CL')} unit="t" delta="acumulado del período en curso" />
        <KPI label="Estado de pago pendiente" value={d.kpis.ep_pendiente ? fmtCLP(d.kpis.ep_pendiente.total) : '—'}
          delta={d.kpis.ep_pendiente ? `${d.kpis.ep_pendiente.folio} · en aprobación` : 'sin EP en aprobación'} />
        <KPI label="Publicaciones activas" value={d.kpis.publicaciones.activas}
          delta={d.kpis.publicaciones.por_vencer ? <b className="down">{d.kpis.publicaciones.por_vencer} por vencer (día ≥13)</b> : 'ninguna por vencer'} />
        <KPI label="Ofertas recibidas · mes" value={d.kpis.ofertas_mes} delta="portal público de venta" />
      </div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-h"><h3>Tonelaje despachado por mes</h3><small>2026 · toneladas</small></div>
          <div className="card-b"><BarChart labels={labels} data={d.serie.map((s) => s.tonelaje)} unit=" t" /></div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Ingresos por venta</h3><small>millones CLP</small></div>
          <div className="card-b">
            <LineChart labels={labels} series={[
              { name: 'Chatarra', color: '#2a78d6', data: d.serie.map((s) => s.ing_chatarra) },
              { name: 'Obsoletos', color: '#eb6834', data: d.serie.map((s) => s.ing_obsoletos) },
            ]} />
          </div>
        </div>
      </div>
      <div className="grid g23">
        <div className="card">
          <div className="card-h"><h3>Bandeja de pendientes</h3><small>calculada por el servidor</small></div>
          <div className="tbl-wrap"><table><tbody>
            {d.pendientes.map((p, i) => (
              <tr key={i}>
                <td><Chip tone={p.tipo}>{p.tag}</Chip></td>
                <td>{p.texto}</td>
                <td className="num">
                  {can(p.destino) && <button className="btn sm" onClick={() => nav(DEST[p.destino])}>Revisar</button>}
                </td>
              </tr>
            ))}
            {!d.pendientes.length && <tr><td className="loading">Sin pendientes — todo al día.</td></tr>}
          </tbody></table></div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Actividad reciente</h3><small>bitácora</small></div>
          <div className="card-b" style={{ paddingTop: 10 }}>
            <ul className="flow">
              {d.actividad.map((a) => (
                <li key={a.id} className="done"><span className="dot">✓</span>
                  <div><b>{a.accion} · {a.objeto}</b><small>{a.usuario} · {a.fecha}</small></div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
