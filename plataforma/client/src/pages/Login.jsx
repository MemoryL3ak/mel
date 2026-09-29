import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Field, Logo } from '../ui.jsx';

export default function Login() {
  const { login, logout } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const u = await login(form.username, form.password);
      // Un comprador no tiene pantallas internas, y su sesión vive en el ámbito
      // del portal: si entrara por acá quedaría conectado donde no puede hacer
      // nada. Se le cierra y se le indica su acceso.
      if (u.role === 'comprador') {
        logout();
        setError('Esta es una cuenta de comprador. Ingrese por el portal de ventas, en /portal.');
        return;
      }
      nav('/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login">
      <section className="login-brand">
        <div className="logo">
          <Logo size={44} />
          <div><b>GEA</b><small>Gestión de enajenación de activos</small></div>
        </div>
        <div>
          <h1 className="display">Del patio al pago conciliado, <em>cada kilo trazado</em>.</h1>
          <p className="desc">Trazabilidad completa del material: del retiro en patios al pago conciliado, con evidencia, folios automáticos y auditoría inmutable.</p>
          <span className="fase">Fase 1 · Proceso de chatarra</span>
        </div>
        <div className="foot">Minera Escondida Limitada · Grupo Lampa</div>
      </section>
      <section className="login-form">
        <form className="login-card" onSubmit={entrar}>
          <h2>Iniciar sesión</h2>
          <p>Ingrese con la cuenta asignada a su perfil.</p>
          {error && <div className="login-error">{error}</div>}
          <Field label="Usuario">
            <input autoFocus autoComplete="username" value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="usuario" />
          </Field>
          <Field label="Contraseña">
            <input type="password" autoComplete="current-password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="••••••••" />
          </Field>
          <button className="btn primary" style={{ width: '100%', padding: '11px' }} disabled={cargando}>
            {cargando ? 'Verificando…' : 'Entrar'}
          </button>
          <div className="login-help">
            ¿Sin acceso o contraseña olvidada? Contacte al Coordinador Logístico MEL, quien administra las cuentas de la plataforma.
          </div>
        </form>
      </section>
    </div>
  );
}
