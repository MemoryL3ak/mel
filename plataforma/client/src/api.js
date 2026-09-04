// Cliente HTTP: agrega el token de sesión y normaliza errores.
// En desarrollo la API vive en el mismo origen (proxy de Vite); en producción
// con frontend y backend separados, VITE_API_URL apunta al backend (…/api).
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export async function api(path, { method = 'GET', body } = {}) {
  const token = localStorage.getItem('gea_token');
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
    localStorage.removeItem('gea_token');
    localStorage.removeItem('gea_user');
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const fmtCLP = (n) => (n == null ? '—' : '$ ' + Math.round(Number(n)).toLocaleString('es-CL'));
export const fmtKg = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }));
export const fmtTon = (n) => (n == null ? '—' : Number(n).toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' t');
