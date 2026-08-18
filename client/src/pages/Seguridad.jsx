import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageHead, useToast } from '../ui.jsx';

export default function Seguridad() {
  const [matriz, setMatriz] = useState(null);
  const [bitacora, setBitacora] = useState([]);
  const toast = useToast();

  useEffect(() => {
    api('/seguridad/matriz').then(setMatriz).catch((e) => toast(e.message, true));
    api('/auditoria').then(setBitacora).catch(() => {});
  }, []);
  if (!matriz) return <div className="loading">Cargando seguridad…</div>;

  return (
    <div className="page">
      <PageHead title="Roles y auditoría" sub="Seis perfiles con permisos granulares por módulo y acción (RBAC verificado por la API; en producción, políticas RLS en PostgreSQL). Bitácora inmutable." />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-h"><h3>Matriz de permisos por módulo</h3><small>● total · ◐ parcial · ○ sin acceso</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Módulo</th>{matriz.roles.map((r) => <th key={r}>{r}</th>)}</tr></thead>
          <tbody>
            {matriz.modulos.map(([mod, perms]) => (
              <tr key={mod}>
                <td>{mod}</td>
                {perms.map((p, i) => <td key={i}><span className={`perm ${p}`} /></td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
      <div className="card">
        <div className="card-h"><h3>Bitácora de auditoría</h3><small>registro inmutable — solo lectura · en vivo</small></div>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Objeto</th></tr></thead>
          <tbody>
            {bitacora.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.fecha}</td><td>{a.usuario}</td><td>{a.rol}</td><td>{a.accion}</td><td className="mono">{a.objeto}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
