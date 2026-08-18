import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, LANDING } from '../auth.jsx';
import { BrandHex, useToast } from '../ui.jsx';

export default function Login() {
  const [perfiles, setPerfiles] = useState([]);
  const { login } = useAuth();
  const nav = useNavigate();
  const toast = useToast();

  useEffect(() => { api('/auth/perfiles').then(setPerfiles).catch(() => {}); }, []);

  async function entrar(username) {
    try {
      const user = await login(username, 'demo');
      nav(LANDING[user.role]);
    } catch (e) {
      toast(e.message, true);
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="brand-mark">
          <BrandHex />
          <div><div className="brand-name">GEA</div><div className="brand-sub">Gestión de Enajenación de Activos</div></div>
        </div>
        <div className="login-hero">
          <h1>Chatarra y componentes obsoletos, en un solo flujo trazable.</h1>
          <p>Plataforma de control de enajenación de chatarra industrial y venta de componentes obsoletos para <strong style={{ color: '#D8DCE0' }}>Minera Escondida Limitada</strong>: desde el retiro en patios hasta el pago conciliado, con repositorio documental y portal público de venta.</p>
          <div className="phase-pills">
            <span><b>F1</b> Proceso de chatarra</span>
            <span><b>F2</b> Control documental</span>
            <span><b>F3</b> Obsoletos y portal</span>
            <span><b>F4</b> Indicadores</span>
          </div>
        </div>
        <div className="login-foot">Prototipo funcional · Propuesta de Ariel Beroíza · Cotización v2.0 — julio 2026</div>
      </div>
      <div className="login-side">
        <div className="login-card">
          <h2>Ingresar a la plataforma</h2>
          <p>Seleccione un perfil de demostración para recorrer la plataforma con sus permisos reales (RBAC verificado en el servidor).</p>
          <div className="role-list">
            {perfiles.map((p) => (
              <button key={p.username} className="role-btn" onClick={() => entrar(p.username)}>
                <span className="role-ini" style={{ background: p.color }}>{p.ini}</span>
                <span><b>{p.label}</b><small>{p.desc}</small></span>
              </button>
            ))}
            {!perfiles.length && <div className="loading">Conectando con la API…</div>}
          </div>
          <div className="demo-note">Usuarios de demostración con contraseña «demo». Los datos son ficticios; cada acción queda registrada en la bitácora de auditoría del servidor.</div>
        </div>
      </div>
    </div>
  );
}
