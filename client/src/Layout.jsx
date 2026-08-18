import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { BrandHex } from './ui.jsx';

const NAV = [
  { group: 'Inicio', items: [
    ['panel', '/', 'Panel de control', 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z'],
  ]},
  { group: 'Chatarra · F1–F2', items: [
    ['programa', '/programa', 'Programa de limpieza', 'M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
    ['despachos', '/despachos', 'Despachos y recepciones', 'M1 8h13v8H1zM14 11h4l3 3v2h-7zM5 19a2 2 0 1 0 .01 0M17 19a2 2 0 1 0 .01 0'],
    ['valorizacion', '/valorizacion', 'Valorización y precios', 'M12 2v20M17 6H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6'],
    ['estados', '/estados', 'Estados de pago', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 14l2 2 4-4'],
    ['documental', '/documental', 'Repositorio documental', 'M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  ]},
  { group: 'Obsoletos · F3', items: [
    ['inventario', '/inventario', 'Inventario y logística', 'M21 8 12 3 3 8v8l9 5 9-5zM12 13 3 8M12 13l9-5M12 13v9'],
    ['publicaciones', '/publicaciones', 'Publicaciones', 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
    ['ofertas', '/ofertas', 'Ofertas y adjudicación', 'M8 21h8M12 17v4M17 4H7v5a5 5 0 0 0 10 0zM7 6H4a3 3 0 0 0 3 5M17 6h3a3 3 0 0 1-3 5'],
    ['portal', '/portal', 'Portal público', 'M12 2a10 10 0 1 0 .01 0M2 12h20M12 2c3 3 3 17 0 20c-3-3-3-17 0-20'],
  ]},
  { group: 'Gestión · F4', items: [
    ['indicadores', '/indicadores', 'Indicadores', 'M3 21h18M7 21V9M12 21V3M17 21v-8'],
    ['seguridad', '/seguridad', 'Roles y auditoría', 'M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10z'],
  ]},
];

const ROLE_LABEL = {
  coordinador: 'Coordinador Logístico MEL', ito: 'ITO', limpieza: 'Empresa de limpieza de patios',
  vendor: 'Vendor de chatarra', adminventa: 'Adm. Plataforma de Venta Web', comprador: 'Comprador externo',
};
const TITLES = {
  '/': 'Panel de control', '/programa': 'Programa de limpieza', '/despachos': 'Despachos y recepciones',
  '/valorizacion': 'Valorización y precios', '/estados': 'Estados de pago', '/documental': 'Repositorio documental',
  '/inventario': 'Inventario y logística', '/publicaciones': 'Publicaciones', '/ofertas': 'Ofertas y adjudicación',
  '/portal': 'Portal público', '/indicadores': 'Indicadores', '/seguridad': 'Roles y auditoría',
};

export default function Layout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const visible = NAV.map((g) => ({ ...g, items: g.items.filter(([id]) => can(id)) })).filter((g) => g.items.length);

  return (
    <div className={open ? 'nav-open' : ''}>
      <div className="shell">
        <aside className="sidebar">
          <div className="side-brand">
            <BrandHex size={34} />
            <div><b>GEA</b><small>Minera Escondida</small></div>
          </div>
          <nav className="side-nav">
            {visible.map((g) => (
              <div className="nav-group" key={g.group}>
                <span>{g.group}</span>
                {g.items.map(([id, to, label, d]) => (
                  <NavLink key={id} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={() => setOpen(false)}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
                    {label}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="side-user">
            <b>{user.name}</b>{ROLE_LABEL[user.role]}
            <button onClick={() => { logout(); nav('/login'); }}>Cambiar de perfil</button>
          </div>
        </aside>

        <div className="main">
          <div className="topbar">
            <button className="hamb" onClick={() => setOpen(!open)} aria-label="Menú">☰</button>
            <div className="crumb">GEA / <b>{TITLES[loc.pathname] || ''}</b></div>
            <div className="top-user"><b>{user.name}</b> · {ROLE_LABEL[user.role]}</div>
          </div>
          <div className="content">
            {user.role !== 'coordinador' && (
              <div className="role-banner">◈ Vista según perfil <b>{ROLE_LABEL[user.role]}</b> — los módulos y acciones visibles corresponden a sus permisos.</div>
            )}
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
