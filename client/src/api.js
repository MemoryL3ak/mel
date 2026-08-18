export const getToken = () => localStorage.getItem('gea_token');

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  const t = getToken();
  if (t) headers.Authorization = 'Bearer ' + t;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: form ? form : body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/auth')) {
    localStorage.removeItem('gea_token');
    localStorage.removeItem('gea_user');
    window.location.href = '/login';
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

export const fmtCLP = (n) => '$ ' + Math.round(n ?? 0).toLocaleString('es-CL');
export const fmtKg = (n) => (n == null ? '—' : Math.round(n).toLocaleString('es-CL'));
export const fmtM = (n) => '$ ' + (n ?? 0).toLocaleString('es-CL') + ' M';
