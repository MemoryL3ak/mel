import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth, ROL_NOMBRE } from '../auth.jsx';
import { Chip, Empty, Field, Modal, PageHead, useToast } from '../ui.jsx';

const ROLES = ['limpieza', 'vendor', 'ito', 'coordinador'];

// Muestra una contraseña recién generada, una única vez, con botón de copiar.
function ClaveUnica({ username, password }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="audit-note" style={{ marginTop: 0 }}>
      Credenciales de <b>{username}</b> — se muestran una sola vez, entréguelas por un canal seguro:
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <code className="mono" style={{ fontSize: 15, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 12px' }}>{password}</code>
        <button className="btn sm" onClick={() => { navigator.clipboard?.writeText(password); setCopiado(true); }}>
          {copiado ? '✓ Copiada' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

export default function Usuarios() {
  const [rows, setRows] = useState(null);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ username: '', nombre: '', role: 'limpieza' });
  const [creada, setCreada] = useState(null);   // {username, password} recién generada
  const { user } = useAuth();
  const toast = useToast();

  const load = () => api('/usuarios').then(setRows).catch((e) => toast(e.message, true));
  useEffect(() => { load(); }, []);
  if (!rows) return <div className="loading">Cargando cuentas…</div>;

  async function crear() {
    try {
      const r = await api('/usuarios', { method: 'POST', body: f });
      setCreada({ username: r.user.username, password: r.password });
      setF({ username: '', nombre: '', role: 'limpieza' });
      toast(`Cuenta ${r.user.username} creada`);
      load();
    } catch (e) { toast(e.message, true); }
  }
  async function reset(u) {
    try {
      const r = await api(`/usuarios/${u.id}/reset`, { method: 'POST' });
      setCreada({ username: r.username, password: r.password });
      setNuevo(true);
      toast(`Contraseña de ${r.username} restablecida`);
    } catch (e) { toast(e.message, true); }
  }
  async function toggle(u) {
    try {
      await api(`/usuarios/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } });
      toast(u.activo ? `Cuenta ${u.username} desactivada` : `Cuenta ${u.username} activada`);
      load();
    } catch (e) { toast(e.message, true); }
  }

  return (
    <div>
      <PageHead title="Cuentas de usuario"
        sub="Creación, activación y restablecimiento de contraseñas. Las contraseñas se generan aleatorias, se muestran una sola vez y viajan cifradas.">
        <button className="btn primary" onClick={() => { setCreada(null); setNuevo(true); }}>+ Nueva cuenta</button>
      </PageHead>

      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Perfil</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id} style={u.activo ? {} : { opacity: .55 }}>
              <td className="mono">{u.username}</td>
              <td><b>{u.nombre}</b>{u.id === Number(user.id) && <span style={{ color: 'var(--muted)' }}> (usted)</span>}</td>
              <td>{ROL_NOMBRE[u.role]}</td>
              <td><Chip tone={u.activo ? 'ok' : 'neutral'}>{u.activo ? 'Activa' : 'Desactivada'}</Chip></td>
              <td className="num" style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" onClick={() => reset(u)}>Restablecer clave</button>{' '}
                {u.id !== Number(user.id) && (
                  <button className={`btn sm ${u.activo ? 'danger' : ''}`} onClick={() => toggle(u)}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
        {rows.length === 0 && <Empty title="Sin cuentas">Cree la primera cuenta de la plataforma.</Empty>}
      </div>

      <Modal open={nuevo} title={creada ? 'Credenciales generadas' : 'Nueva cuenta de usuario'} onClose={() => { setNuevo(false); setCreada(null); }}
        footer={creada
          ? <button className="btn primary" onClick={() => { setNuevo(false); setCreada(null); }}>Listo, la guardé</button>
          : <>
            <button className="btn" onClick={() => setNuevo(false)}>Cancelar</button>
            <button className="btn primary" onClick={crear}>Crear cuenta</button>
          </>}>
        {creada
          ? <ClaveUnica username={creada.username} password={creada.password} />
          : <>
            <Field label="Usuario" hint="Minúsculas, números, punto o guion (3-24 caracteres).">
              <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="ej. jperez" />
            </Field>
            <Field label="Nombre completo">
              <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Juan Pérez" />
            </Field>
            <Field label="Perfil">
              <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROL_NOMBRE[r]}</option>)}
              </select>
            </Field>
          </>}
      </Modal>
    </div>
  );
}
