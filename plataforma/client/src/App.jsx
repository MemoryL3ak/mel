import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, ROL_NOMBRE, SCREENS } from './auth.jsx';
import { ToastProvider, Logo, Avatar } from './ui.jsx';
import CambiarClave from './CambiarClave.jsx';
import Login from './pages/Login.jsx';
import Panel from './pages/Panel.jsx';
import Programa from './pages/Programa.jsx';
import Despachos from './pages/Despachos.jsx';
import Valorizacion from './pages/Valorizacion.jsx';
import Cuadratura from './pages/Cuadratura.jsx';
import EstadosPago from './pages/EstadosPago.jsx';
import Auditoria from './pages/Auditoria.jsx';
import Usuarios from './pages/Usuarios.jsx';
import Memos from './pages/Memos.jsx';
import Inventario from './pages/Inventario.jsx';
import Publicaciones from './pages/Publicaciones.jsx';
import Ofertas from './pages/Ofertas.jsx';
import Compradores from './pages/Compradores.jsx';
import Portal from './pages/Portal.jsx';
import Documentos from './pages/Documentos.jsx';

const I = {
  panel: <path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" />,
  programa: <path d="M5 5h14v15H5zM5 9h14M9 3v4M15 3v4M8 13h3M8 16h6" />,
  despachos: <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7zM6 19a2 2 0 1 0 0-.01M16 19a2 2 0 1 0 0-.01" />,
  valorizacion: <path d="M12 3v18M8 7h6a2.5 2.5 0 0 1 0 5h-4a2.5 2.5 0 0 0 0 5h6" />,
  cuadratura: <path d="M4 5h16M4 12h16M4 19h16M8 3v4M16 10v4M10 17v4" />,
  estados: <path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6" />,
  auditoria: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" />,
  usuarios: <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><circle cx="17.5" cy="9.5" r="2.6" /><path d="M16 14.6c2.9.4 5 2.7 5 5.4" /></>,
  memos: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  inventario: <path d="M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10" />,
  publicaciones: <path d="M4 5h16v11H4zM4 20h16M9 9h6M9 12h4" />,
  ofertas: <path d="M4 5h16v14H4zM8 3v4M16 3v4M8 12l3 3 5-5" />,
  compradores: <><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M15 4l2 2 4-4" /></>,
  documentos: <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18" />,
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
  ['VENTA DE OBSOLETOS', [
    ['memos', '/memos', 'Memos de baja'],
    ['inventario', '/inventario', 'Inventario de obsoletos'],
    ['publicaciones', '/publicaciones', 'Publicaciones'],
    ['ofertas', '/ofertas', 'Ofertas y adjudicación'],
    ['compradores', '/compradores', 'Compradores'],
  ]],
  ['CONTROL DOCUMENTAL', [
    ['documentos', '/documentos', 'Repositorio documental'],
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
  '/memos': 'Memos de baja', '/inventario': 'Inventario de obsoletos', '/publicaciones': 'Publicaciones',
  '/ofertas': 'Ofertas y adjudicación', '/compradores': 'Compradores',
  '/documentos': 'Repositorio documental',
};
// Ruta de cada pantalla, para el aterrizaje de quien no tiene Panel.
const RUTA = Object.fromEntries(NAV.flatMap(([, items]) => items.map(([id, to]) => [id, to])));

function Shell({ children }) {
  const { user, logout, can } = useAuth();
  // Se ofrece al entrar cuando la clave sigue siendo la entregada.
  const [clave, setClave] = useState(() => !!user?.clave_inicial);
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
          {/* Dos líneas, no un "·": el contrato es 50/50 y en 260 px de
              barra la marca completa no cabe en una sola. */}
          <div className="btxt"><b>GEA</b><small>Minera Escondida</small><small>Grupo Lampa</small></div>
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
          <button onClick={() => setClave(true)} title="Cambiar mi contraseña" aria-label="Cambiar contraseña">
            {user.clave_inicial ? '🔑 Clave' : '🔑'}
          </button>
          <button onClick={logout} title="Cerrar sesión">Salir</button>
        </div>
      </aside>
      <CambiarClave open={clave} inicial={!!user.clave_inicial} onClose={() => setClave(false)} />
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

// Un comprador guardado en el ámbito interno es un resto inválido: el portal
// guarda su sesión aparte. Mandarlo al portal lo dejaría rebotando —el portal
// no lo reconoce y "/" lo devolvería una y otra vez—, así que se limpia el
// resto y se muestra el login, que es la salida real.
function SesionAjena() {
  const { logout } = useAuth();
  useEffect(() => { logout(); }, []);
  return <Navigate to="/login" replace />;
}

function Home() {
  const { user, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'comprador') return <SesionAjena />;
  if (can('panel')) return <Shell><Panel /></Shell>;
  // Quien no ve el Panel aterriza en su primera pantalla disponible.
  const primera = (SCREENS[user.role] || []).find((s) => RUTA[s]);
  return <Navigate to={primera ? RUTA[primera] : '/login'} replace />;
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
            <Route path="/memos" element={<Guard screen="memos"><Memos /></Guard>} />
            <Route path="/inventario" element={<Guard screen="inventario"><Inventario /></Guard>} />
            <Route path="/publicaciones" element={<Guard screen="publicaciones"><Publicaciones /></Guard>} />
            <Route path="/ofertas" element={<Guard screen="ofertas"><Ofertas /></Guard>} />
            <Route path="/compradores" element={<Guard screen="compradores"><Compradores /></Guard>} />
            <Route path="/documentos" element={<Guard screen="documentos"><Documentos /></Guard>} />
            <Route path="/portal" element={<Portal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
