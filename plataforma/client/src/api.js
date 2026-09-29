// Cliente HTTP: agrega el token de sesión y normaliza errores.
// En desarrollo la API vive en el mismo origen (proxy de Vite); en producción
// con frontend y backend separados, VITE_API_URL apunta al backend (…/api).
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

// El portal público y el panel interno son la misma aplicación en el mismo
// origen, así que comparten localStorage. Con una sola llave de sesión, entrar
// como comprador pisaba la sesión del coordinador (y al revés). Cada ámbito
// guarda la suya por separado, y así conviven en el mismo navegador.
export const enPortal = () => window.location.pathname.startsWith('/portal');
export const llaves = () => (enPortal()
  ? { token: 'gea_portal_token', user: 'gea_portal_user' }
  : { token: 'gea_token', user: 'gea_user' });

export async function api(path, { method = 'GET', body } = {}) {
  const k = llaves();
  const token = localStorage.getItem(k.token);
  const esForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(esForm ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: esForm ? body : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth/')) {
    localStorage.removeItem(k.token);
    localStorage.removeItem(k.user);
    // Un comprador con la sesión vencida vuelve al portal, no al login interno:
    // ese login no es suyo y no tiene cómo entrar por ahí.
    window.location.href = enPortal() ? '/portal' : '/login';
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    if (data.detalle) err.detalle = data.detalle;   // p. ej. errores por fila de una carga masiva
    throw err;
  }
  return data;
}

export const fmtCLP = (n) => (n == null ? '—' : '$ ' + Math.round(Number(n)).toLocaleString('es-CL'));
export const fmtUSD = (n) => (n == null ? '—' : 'US$ ' + Number(n).toLocaleString('en-US'));
export const fmtKg = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }));
export const fmtTon = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' t');
