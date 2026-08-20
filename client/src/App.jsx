import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, LANDING } from './auth.jsx';
import Layout from './Layout.jsx';
import Login from './pages/Login.jsx';
import Panel from './pages/Panel.jsx';
import Programa from './pages/Programa.jsx';
import Despachos from './pages/Despachos.jsx';
import Valorizacion from './pages/Valorizacion.jsx';
import EstadosPago from './pages/EstadosPago.jsx';
import Documental from './pages/Documental.jsx';
import Inventario from './pages/Inventario.jsx';
import Publicaciones from './pages/Publicaciones.jsx';
import Ofertas from './pages/Ofertas.jsx';
import Portal from './pages/Portal.jsx';
import Indicadores from './pages/Indicadores.jsx';
import Seguridad from './pages/Seguridad.jsx';

function Guard({ screen, children }) {
  const { user, can } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!can(screen)) return <Navigate to={LANDING[user.role]} replace />;
  return children;
}

export default function App() {
  const { user, booting } = useAuth();
  if (booting) return <div className="loading">Iniciando sesión de demostración…</div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={LANDING[user.role]} replace /> : <Login />} />
      <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
        <Route path="/" element={<Guard screen="panel"><Panel /></Guard>} />
        <Route path="/programa" element={<Guard screen="programa"><Programa /></Guard>} />
        <Route path="/despachos" element={<Guard screen="despachos"><Despachos /></Guard>} />
        <Route path="/valorizacion" element={<Guard screen="valorizacion"><Valorizacion /></Guard>} />
        <Route path="/estados" element={<Guard screen="estados"><EstadosPago /></Guard>} />
        <Route path="/documental" element={<Guard screen="documental"><Documental /></Guard>} />
        <Route path="/inventario" element={<Guard screen="inventario"><Inventario /></Guard>} />
        <Route path="/publicaciones" element={<Guard screen="publicaciones"><Publicaciones /></Guard>} />
        <Route path="/ofertas" element={<Guard screen="ofertas"><Ofertas /></Guard>} />
        <Route path="/portal" element={<Guard screen="portal"><Portal /></Guard>} />
        <Route path="/indicadores" element={<Guard screen="indicadores"><Indicadores /></Guard>} />
        <Route path="/seguridad" element={<Guard screen="seguridad"><Seguridad /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to={user ? LANDING[user.role] : '/login'} replace />} />
    </Routes>
  );
}
