import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, ROL_NOMBRE } from './auth.jsx';
import { ToastProvider, Logo, Avatar } from './ui.jsx';
import Login from './pages/Login.jsx';
import Panel from './pages/Panel.jsx';
import Programa from './pages/Programa.jsx';
import Despachos from './pages/Despachos.jsx';
import Valorizacion from './pages/Valorizacion.jsx';
import Cuadratura from './pages/Cuadratura.jsx';
import EstadosPago from './pages/EstadosPago.jsx';
import Auditoria from './pages/Auditoria.jsx';
import Usuarios from './pages/Usuarios.jsx';

const I = {
  panel: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  programa: <path d="M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M8 13h3M8 16h6" />,
  despachos: <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7zM6 19a2 2 0 1 0 0-.01M16 19a2 2 0 1 0 0-.01" />,
  valorizacion: <path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5h-4a2.5 2.5 0 0 0 0 5h6" />,
  cuadratura: <path d="M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4" />,
  estados: <path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6" />,
  auditoria: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  usuarios: <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17.5" cy="9.5" r="2.6" /><path d="M16 14.6c2.9.4 5 2.7 5 5.4" /></>,
};
const NAV = [
  ['INICIO', [['panel', '/', 'Panel de control']]],
  ['PROCESO DE CHATARRA', [
    ['programa', '/programa', 'Programa de limpieza'],
    ['despachos', '/despachos', 'Despachos y recepciones'],
    ['valorizacion', '/valorizacion', 'Valorización y precios'],
    ['cuadratura', '/cuadratura', 'Cuadratura semanal'],
    ['estados', '/estados', 'Estados de pago'],
  ]],
  ['GESTIÓN', [
    ['auditoria', '/auditoria', 'Auditoría y permisos'],
    ['usuarios', '/usuarios', 'Cuentas de usuario'],
  ]],
];
const TITULOS = {
  '/': 'Panel de control', '/programa': 'Programa de limpieza', '/despachos': 'Despachos y recepciones',
  '/valorizacion': 'Valorización y precios', '/cuadratura': 'Cuadratura semanal',
  '/estados': 'Estados de pago', '/auditoria': 'Auditoría y permisos', '/usuarios': 'Cuentas de usuario',
};

function Shell({ children }) {
  const { user, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [rail, setRail] = useState(() => localStorage.getItem('gea_nav') === '1');
  const loc = useLocation();
  const toggleRail = () => {
    const v = !rail;
    setRail(v);
    localStorage.setItem('gea_nav', v ? '1' : '0');
  };
  return (
    <div className={`shell ${open ? 'nav-open' : ''} ${rail ? 'nav-rail' : ''}`}>
      <aside className="sidebar">
        <div className="side-brand">
          <Logo />
          <div className="btxt"><b>GEA</b><small>Minera Escondida</small></div>
        </div>
        <nav className="nav">
          {NAV.map(([sec, items]) => {
            const visibles = items.filter(([id]) => can(id));
            if (!visibles.length) return null;
            return (
              <div key={sec}>
                <div className="nav-sec">{sec}</div>
                {visibles.map(([id, to, label]) => (
                  <NavLink key={id} to={to} title={label} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setOpen(false)}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{I[id]}</svg>
                    <span className="ntxt">{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-user">
          <Avatar name={user.name} />
          <div className="who">
            <b>{user.name}</b>
            <small>{ROL_NOMBRE[user.role]}</small>
          </div>
          <button onClick={logout} title="Cerrar sesión">Salir</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="hamb" onClick={() => setOpen(!open)} aria-label="Menú">☰</button>
          <button className="nav-toggle" onClick={toggleRail} title={rail ? 'Expandir menú' : 'Contraer menú'}
            aria-label={rail ? 'Expandir menú' : 'Contraer menú'}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M9.5 4v16" />
              {rail ? <path d="M14 9.5l2.5 2.5L14 14.5" /> : <path d="M17 9.5L14.5 12l2.5 2.5" />}
            </svg>
          </button>
          <span className="crumb">GEA <span className="sep">/</span> <b>{TITULOS[loc.pathname] ?? 'Fase 1'}</b></span>
          <span className="top-user">
            <span className="top-date">{new Date().toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <Avatar name={user.name} className="avatar" />
            <span><b>{user.name}</b></span>
          </span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function Guard({ screen, children }) {
  const { user, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!can(screen)) return <Navigate to="/" replace />;
  return <Shell>{children}</Shell>;
}

function Home() {
  const { user, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!can('panel')) return <Navigate to="/despachos" replace />;
  return <Shell><Panel /></Shell>;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Home />} />
            <Route path="/programa" element={<Guard screen="programa"><Programa /></Guard>} />
            <Route path="/despachos" element={<Guard screen="despachos"><Despachos /></Guard>} />
            <Route path="/valorizacion" element={<Guard screen="valorizacion"><Valorizacion /></Guard>} />
            <Route path="/cuadratura" element={<Guard screen="cuadratura"><Cuadratura /></Guard>} />
            <Route path="/estados" element={<Guard screen="estados"><EstadosPago /></Guard>} />
            <Route path="/auditoria" element={<Guard screen="auditoria"><Auditoria /></Guard>} />
            <Route path="/usuarios" element={<Guard screen="usuarios"><Usuarios /></Guard>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
