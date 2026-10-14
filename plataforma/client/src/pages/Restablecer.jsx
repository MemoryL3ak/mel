import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Field, Logo } from '../ui.jsx';

// Definir una contraseña nueva desde el enlace que llega por correo. Sirve a
// las cuentas internas y a las de comprador (a=portal): cambia solo a dónde se
// vuelve al terminar.
export default function Restablecer() {
  const [params] = useSearchParams();
  // El token se lee una vez y se quita de la barra de direcciones, para que no
  // quede en el historial ni se comparta por error al copiar la URL.
  const [t] = useState(() => params.get('t') || '');
  const portal = params.get('a') === 'portal';
  const volver = portal ? '/portal' : '/login';
  const [cuenta, setCuenta] = useState(null);
  const [error, setError] = useState(null);
  const [f, setF] = useState({ nueva: '', repetir: '' });
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, '', portal ? '/restablecer?a=portal' : '/restablecer');
    if (!t) { setError('Falta el enlace de recuperación. Ábralo desde el correo que le enviamos.'); return; }
    api('/auth/restablecer/validar', { method: 'POST', body: { t } })
      .then(setCuenta).catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(e) {
    e.preventDefault();
    if (f.nueva.length < 8) return setError('La nueva contraseña debe tener al menos 8 caracteres');
    if (f.nueva !== f.repetir) return setError('Las contraseñas no coinciden');
    setError(null);
    setCargando(true);
    try {
      await api('/auth/restablecer', { method: 'POST', body: { t, nueva: f.nueva } });
      setListo(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="login login-solo">
      <section className="login-form">
        <form className="login-card" onSubmit={guardar}>
          <div className="login-marca"><Logo size={30} /><b>GEA</b></div>
          <h2>Nueva contraseña</h2>
          {listo ? (<>
            <p>Su contraseña quedó actualizada. Ya puede iniciar sesión con ella.</p>
            <Link className="btn primary" to={volver} style={{ display: 'block', textAlign: 'center', padding: 11 }}>
              {portal ? 'Ir al portal' : 'Iniciar sesión'}
            </Link>
          </>) : (<>
            <p>{cuenta ? <>Cuenta <b>{cuenta.usuario}</b> · {cuenta.nombre}</>
              : error ? 'No pudimos usar este enlace.' : 'Verificando el enlace…'}</p>
            {error && <div className="login-error">{error}</div>}
            {cuenta && (<>
              <Field label="Nueva contraseña" hint="Mínimo 8 caracteres.">
                <input type="password" autoFocus autoComplete="new-password" value={f.nueva}
                  onChange={(e) => setF({ ...f, nueva: e.target.value })} placeholder="••••••••" />
              </Field>
              <Field label="Repita la nueva contraseña">
                <input type="password" autoComplete="new-password" value={f.repetir}
                  onChange={(e) => setF({ ...f, repetir: e.target.value })} placeholder="••••••••" />
              </Field>
              <button className="btn primary" style={{ width: '100%', padding: '11px' }} disabled={cargando}>
                {cargando ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </>)}
            <div className="login-help">
              <Link to={volver}>Volver al inicio de sesión</Link>
            </div>
          </>)}
        </form>
      </section>
    </div>
  );
}
