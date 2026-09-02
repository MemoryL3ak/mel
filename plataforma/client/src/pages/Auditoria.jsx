import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Empty, PageHead, Tabs, useToast } from '../ui.jsx';

const NIVEL = { full: ['●', 'Acceso completo'], part: ['◐', 'Acceso parcial'], none: ['○', 'Sin acceso'] };
const ROL_COL = { limpieza: 'Limpieza', vendor: 'Vendor', ito: 'ITO', coordinador: 'Coordinador' };

export default function Auditoria() {
  const [rows, setRows] = useState(null);
  const [matriz, setMatriz] = useState(null);
  const [tab, setTab] = useState('a1');
  const toast = useToast();

  useEffect(() => {
    api('/auditoria').then(setRows).catch((e) => toast(e.message, true));
    api('/seguridad/matriz').then(setMatriz).catch(() => {});
  }, []);
  if (!rows) return <div className="loading">Cargando auditoría…</div>;

  return (
    <div>
      <PageHead title="Auditoría y permisos"
        sub="Bitácora inmutable de todas las acciones del sistema y matriz de acceso por rol. Los registros solo se agregan: nunca se editan ni se eliminan." />
      <Tabs active={tab} onChange={setTab} tabs={[['a1', 'Bitácora de auditoría'], ['a2', 'Matriz de permisos']]} />

      {tab === 'a1' && (
        <div className="card"><div className="tbl-wrap"><table>
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Rol</th><th>Acción</th><th>Objeto</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{a.fecha}</td>
                <td><b>{a.usuario}</b></td>
                <td style={{ color: 'var(--ink-2)' }}>{ROL_COL[a.rol] ?? a.rol}</td>
                <td>{a.accion}</td>
                <td className="mono" style={{ color: 'var(--ink-2)' }}>{a.objeto || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
          {rows.length === 0 && <Empty title="Bitácora vacía">Cada acción del sistema quedará registrada aquí.</Empty>}
        </div>
      )}

      {tab === 'a2' && matriz && (
        <div className="card">
          <div className="tbl-wrap"><table>
            <thead><tr><th>Módulo</th>{matriz.roles.map((r) => <th key={r}>{ROL_COL[r]}</th>)}</tr></thead>
            <tbody>
              {matriz.modulos.map(([mod, perms]) => (
                <tr key={mod}>
                  <td><b>{mod}</b></td>
                  {matriz.roles.map((r) => (
                    <td key={r} title={NIVEL[perms[r]][1]} style={{ color: perms[r] === 'none' ? 'var(--muted)' : 'var(--copper-deep)' }}>
                      {NIVEL[perms[r]][0]} <small style={{ color: 'var(--ink-2)' }}>{NIVEL[perms[r]][1]}</small>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="card-b" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
            Los permisos se aplican en el servidor por acción y por módulo, y en la base de datos con políticas de seguridad a nivel de fila (RLS).
          </div>
        </div>
      )}
    </div>
  );
}
