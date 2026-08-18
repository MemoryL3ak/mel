import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Chip, PageHead, useToast } from '../ui.jsx';

export default function Publicaciones() {
  const [comps, setComps] = useState(null);
  const nav = useNavigate();
  const toast = useToast();

  const load = () => api('/componentes').then(setComps).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!comps) return <div className="loading">Cargando publicaciones…</div>;

  const visibles = comps.filter((c) => ['publicado', 'convertido'].includes(c.estado));

  return (
    <div className="page">
      <PageHead title="Publicaciones" sub={<>Control automático de tiempos: a los <b>15 días sin adjudicar</b>, el componente se convierte en chatarra y pasa al flujo de enajenación. La regla corre en el servidor.</>} />
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Componente</th><th>Publicado el</th><th style={{ minWidth: 190 }}>Plazo (15 días)</th><th className="num">Ofertas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {visibles.map((c) => {
            const dia = Math.min(c.dias_publicado ?? 0, 16);
            const pct = Math.min(100, Math.round((dia / 15) * 100));
            const tone = c.estado === 'convertido' ? 'bad' : dia >= 13 ? 'bad' : dia >= 8 ? 'warn' : '';
            return (
              <tr key={c.id} style={c.estado === 'convertido' ? { opacity: 0.75 } : {}}>
                <td><b>{c.nombre}</b><br /><small style={{ color: 'var(--muted)' }}>{c.codigo}</small></td>
                <td>{c.publicado_el}</td>
                <td>
                  <div className="bar-track"><div className={`bar-fill ${tone}`} style={{ width: pct + '%' }} /></div>
                  <small style={dia >= 13 ? { color: 'var(--bad-tx)', fontWeight: 700 } : { color: 'var(--ink-2)' }}>
                    {c.estado === 'convertido' ? `${c.dias_publicado} días — plazo cumplido` : `Día ${dia} de 15${dia >= 14 ? ' — vence mañana' : ''}`}
                  </small>
                </td>
                <td className="num">{c.n_ofertas}</td>
                <td>{c.estado === 'convertido'
                  ? <Chip tone="bad">Convertido a chatarra</Chip>
                  : dia >= 13 ? <Chip tone="warn">Por vencer</Chip> : <Chip tone="info">Activa</Chip>}</td>
                <td className="num">
                  {c.estado === 'publicado' && <button className="btn sm" onClick={() => nav('/ofertas')}>Ofertas</button>}
                  {c.estado === 'convertido' && <button className="btn sm" onClick={() => nav('/despachos')}>Ver flujo chatarra</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></div></div>
      <div className="audit-note">⚙ La conversión es automática en el servidor: genera la baja del activo (documento scrap), la registra en la bitácora y el componente entra al flujo de enajenación de la Fase 1.</div>
    </div>
  );
}
