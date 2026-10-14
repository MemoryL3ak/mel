import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Field, Logo } from '../ui.jsx';

export default function Login() {
  const { login, logout } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);
  // Recuperación de contraseña: null = formulario de ingreso; '' o texto = el
  // formulario de recuperación con el correo digitado.
  const [correo, setCorreo] = useState(null);
  const [enviado, setEnviado] = useState(null);

  async function recuperar(e) {
    e.preventDefault();
    setError(null);
    setCargando(true);
    try {
      const r = await api('/auth/recuperar', { method: 'POST', body: { correo, ambito: 'interno' } });
      setEnviado(r.mensaje);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }
  const aIngreso = () => { setCorreo(null); setEnviado(null); setError(null); };

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
        {correo !== null ? (
          <form className="login-card" onSubmit={recuperar}>
            <h2>Recuperar contraseña</h2>
            {enviado ? (<>
              <p>{enviado}</p>
              <button type="button" className="btn primary" style={{ width: '100%', padding: '11px' }} onClick={aIngreso}>Volver a iniciar sesión</button>
            </>) : (<>
              <p>Le enviaremos un enlace para definir una contraseña nueva.</p>
              {error && <div className="login-error">{error}</div>}
              <Field label="Correo registrado en su cuenta">
                <input type="email" autoFocus autoComplete="email" value={correo}
                  onChange={(e) => setCorreo(e.target.value)} placeholder="nombre@empresa.cl" />
              </Field>
              <button className="btn primary" style={{ width: '100%', padding: '11px' }} disabled={cargando || !correo.trim()}>
                {cargando ? 'Enviando…' : 'Enviar enlace'}
              </button>
              <button type="button" className="login-link" onClick={aIngreso}>Volver a iniciar sesión</button>
            </>)}
            <div className="login-help">
              Las cuentas sin correo registrado las restablece el Coordinador Logístico MEL desde «Cuentas de usuario».
            </div>
          </form>
        ) : (
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
          <button type="button" className="login-link" onClick={() => { setCorreo(''); setError(null); }}>¿Olvidó su contraseña?</button>
          <div className="login-help">
            ¿Sin acceso? Contacte al Coordinador Logístico MEL, quien administra las cuentas de la plataforma.
          </div>
        </form>
        )}
      </section>
    </div>
  );
}
