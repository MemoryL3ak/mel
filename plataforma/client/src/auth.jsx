import { createContext, useContext, useState } from 'react';
import { api, llaves } from './api.js';

// Pantallas visibles por rol — espejo del RBAC del servidor (el servidor manda).
export const SCREENS = {
  limpieza:    ['panel', 'programa', 'despachos'],
  vendor:      ['panel', 'despachos', 'estados'],
  ito:         ['panel', 'programa', 'despachos', 'valorizacion', 'cuadratura', 'estados', 'auditoria'],
  coordinador: ['panel', 'programa', 'despachos', 'valorizacion', 'cuadratura', 'estados', 'auditoria', 'usuarios',
                'memos', 'inventario', 'publicaciones', 'ofertas', 'compradores'],
  lampa:       ['panel', 'despachos', 'cuadratura'],
  // El vendor ve el memo para saber el origen de lo que publica, pero cargarlo
  // es de MEL: la pantalla filtra las acciones de escritura por rol.
  admin_venta: ['memos', 'inventario', 'publicaciones', 'ofertas', 'compradores'],
};
export const ROL_NOMBRE = {
  limpieza: 'Empresa de limpieza de patios',
  vendor: 'Empresa vendor de chatarra',
  ito: 'ITO',
  coordinador: 'Coordinador Logístico MEL',
  lampa: 'Responsable de Lampa',
  admin_venta: 'Administrador Plataforma de Venta',
  comprador: 'Comprador',
};

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  // La sesión se guarda bajo las llaves del ámbito en que se abrió la página
  // (portal o panel interno), así que el comprador y el personal de MEL pueden
  // estar conectados a la vez en el mismo navegador. Cruzar de un ámbito al
  // otro exige recargar, para que el proveedor lea las llaves correctas.
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem(llaves().user)); } catch { return null; }
  });

  async function login(username, password) {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { username, password } });
    const k = llaves();
    localStorage.setItem(k.token, token);
    localStorage.setItem(k.user, JSON.stringify(user));
    setUser(user);
    return user;
  }
  function logout() {
    const k = llaves();
    localStorage.removeItem(k.token);
    localStorage.removeItem(k.user);
    setUser(null);
  }
  const can = (screen) => !!user && SCREENS[user.role]?.includes(screen);
  // setUser se expone para que el cambio de contraseña pueda apagar el aviso de
  // "clave inicial" sin obligar a cerrar sesion y volver a entrar.
  const guardarUser = (u) => {
    try { localStorage.setItem(llaves().user, JSON.stringify(u)); } catch { /* sin almacenamiento */ }
    setUser(u);
  };
  return <Ctx.Provider value={{ user, login, logout, can, setUser: guardarUser }}>{children}</Ctx.Provider>;
}
