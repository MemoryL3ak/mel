import { createContext, useContext, useState } from 'react';
import { api } from './api.js';

// Pantallas visibles por rol — espejo del RBAC del servidor (el servidor manda).
export const SCREENS = {
  limpieza:    ['panel', 'programa', 'despachos'],
  vendor:      ['panel', 'despachos', 'estados'],
  ito:         ['panel', 'programa', 'despachos', 'valorizacion', 'cuadratura', 'estados', 'auditoria'],
  coordinador: ['panel', 'programa', 'despachos', 'valorizacion', 'cuadratura', 'estados', 'auditoria', 'usuarios'],
};
export const ROL_NOMBRE = {
  limpieza: 'Empresa de limpieza de patios',
  vendor: 'Empresa vendor de chatarra',
  ito: 'ITO',
  coordinador: 'Coordinador Logístico MEL',
};

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gea_user')); } catch { return null; }
  });

  async function login(username, password) {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { username, password } });
    localStorage.setItem('gea_token', token);
    localStorage.setItem('gea_user', JSON.stringify(user));
    setUser(user);
    return user;
  }
  function logout() {
    localStorage.removeItem('gea_token');
    localStorage.removeItem('gea_user');
    setUser(null);
  }
  const can = (screen) => !!user && SCREENS[user.role]?.includes(screen);
  return <Ctx.Provider value={{ user, login, logout, can }}>{children}</Ctx.Provider>;
}
