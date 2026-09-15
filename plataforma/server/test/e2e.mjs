// Suite E2E de la Fase 1 (chatarra). Levanta el servidor en un puerto de
// prueba, recorre la API real contra Supabase y limpia todos los datos que
// crea. Ejecutar con: npm test  (requiere server/.env configurado).
//
// Alcance: autenticación, RBAC, cadena física MEL→La Negra→Lampa, evidencia
// fotográfica, precio congelado, carga masiva atómica y gestión de cuentas.
// El ciclo del estado de pago no se ejercita aquí porque generar un EP
// absorbería despachos reales del período (se validó manualmente en QA).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
// Ojo al elegir puerto: fetch bloquea los "bad ports" del estándar (4190 incluido).
const PORT = Number(process.env.TEST_PORT || 4199);
const B = `http://localhost:${PORT}/api`;

// Credenciales de servicio para la limpieza final (misma fuente que el server).
const dotenv = Object.fromEntries(
  readFileSync(join(raiz, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const SUPA = dotenv.SUPABASE_URL, KEY = dotenv.SUPABASE_SECRET_KEY;

let pasan = 0, fallan = 0;
const ok = (cond, nombre, detalle = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${nombre}`); }
  else { fallan++; console.error(`  ✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); };
};

async function api(path, { method = 'GET', token, body, form } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(form ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, headers: res.headers, data: await res.json().catch(() => ({})) };
}
const login = async (u, p = 'gea2026') => (await api('/auth/login', { method: 'POST', body: { username: u, password: p } }));

// PNG mínimo válido (2x2) para la evidencia.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPj/n4GBgYGJgYEBAB4TAgL5s2//AAAAAElFTkSuQmCC', 'base64');

// Registro de lo creado, para eliminarlo al final pase lo que pase.
const creado = { despachoId: null, trasladoId: null, userId: null, precioId: null, programaSemana: null };

async function limpiar() {
  const del = (path, body) => fetch(`${SUPA}${path}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (creado.despachoId) {
    await del(`/storage/v1/object/evidencia`, {
      prefixes: [`GD/${creado.despachoId}/guia-1.png`, `GD/${creado.despachoId}/bascula-1.png`,
        `GD/${creado.despachoId}/recepcion-1.png`],
    });
    await del(`/rest/v1/despachos?id=eq.${creado.despachoId}`);
  }
  if (creado.trasladoId) await del(`/rest/v1/traslados?id=eq.${creado.trasladoId}`);
  if (creado.userId) await del(`/rest/v1/users?id=eq.${creado.userId}`);
  if (creado.precioId) await del(`/rest/v1/precios?id=eq.${creado.precioId}`);
  if (creado.programaSemana) await del(`/rest/v1/programa?anio=eq.${creado.programaSemana[0]}&semana=eq.${creado.programaSemana[1]}`);
}

// ---------- arranque del servidor de prueba ----------
const server = spawn(process.execPath, [join(raiz, 'src', 'index.js')], {
  cwd: raiz, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'],
});
server.on('error', (e) => { console.error('No se pudo iniciar el servidor de prueba:', e.message); process.exit(1); });
let listo = false, ultimoError = '';
for (let i = 0; i < 30 && !listo; i++) {
  try {
    const h = await fetch(`${B}/health`).then((r) => r.json());
    listo = h.ok === true;
  } catch (e) {
    ultimoError = e.cause?.message || e.message;
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!listo) {
  console.error(`El servidor de prueba no respondió en el puerto ${PORT} (${ultimoError})`);
  server.kill(); process.exit(1);
}

try {
  console.log('\nAutenticación y cabeceras');
  const salud = await fetch(`${B}/health`);
  ok(salud.headers.get('x-content-type-options') === 'nosniff', 'cabeceras de seguridad activas (helmet)');

  const rc = await login('coordinador'); const tc = rc.data.token;
  const rl = await login('limpieza'); const tl = rl.data.token;
  const rv = await login('vendor'); const tv = rv.data.token;
  const ri = await login('ito'); const ti = ri.data.token;
  ok(tc && tl && tv && ti, 'login correcto para los 4 perfiles');

  const mala = await login('coordinador', 'incorrecta');
  ok(mala.status === 401, 'clave incorrecta → 401');
  ok(!!mala.headers.get('ratelimit-policy') || !!mala.headers.get('ratelimit'), 'límite de intentos activo en el login');
  const fantasma = await login('no-existe', 'x');
  ok(fantasma.status === 401 && fantasma.data.error === mala.data.error,
    'usuario inexistente → misma respuesta (sin filtrar cuentas)');

  console.log('\nRBAC: cada rol solo lo suyo');
  ok((await api('/precios', { method: 'POST', token: tl, body: { categoria_id: 1, precio_kg: 1 } })).status === 403, 'limpieza no puede cambiar precios');
  ok((await api('/eps', { token: tl })).status === 403, 'limpieza no ve estados de pago');
  ok((await api('/usuarios', { token: ti })).status === 403, 'ITO no administra cuentas');
  ok((await api('/despachos', { method: 'POST', token: tv, form: new FormData() })).status === 403, 'vendor no crea despachos MEL');
  ok((await api('/eps', { method: 'GET' })).status === 401, 'sin token → 401');

  console.log('\nCadena física con evidencia');
  const fd = new FormData();
  fd.set('patio_id', '1'); fd.set('categoria_id', '1'); fd.set('kg_origen', '5000');
  fd.append('guia', new Blob([PNG], { type: 'image/png' }), 'guia.png');
  fd.append('bascula', new Blob([PNG], { type: 'image/png' }), 'ticket.png');
  const d = await api('/despachos', { method: 'POST', token: tl, form: fd });
  creado.despachoId = d.data.id;
  ok(d.status === 200 && /^GD-\d+$/.test(d.data.guia) && d.data.estado === 'en_transito', `despacho creado con folio (${d.data.guia})`);

  const ev = await api(`/despachos/${d.data.id}/evidencia`, { token: tl });
  const etiquetas = (ev.data.archivos ?? []).map((a) => a.etiqueta).sort();
  ok(ev.data.archivos?.length === 2, 'los dos respaldos quedaron adjuntos');
  ok(etiquetas.join(' | ') === 'Guía de despacho | Ticket de báscula MEL',
    'cada respaldo vuelve etiquetado por tipo', etiquetas.join(' | '));
  const foto = ev.data.archivos?.length ? await fetch(ev.data.archivos[0].url) : { status: 0 };
  ok(foto.status === 200, 'respaldo descargable (URL firmada válida)');

  // La recepción es una declaración propia del vendor, con su propio ticket.
  const fdRec = new FormData();
  fdRec.set('kg_destino', '4800');
  fdRec.append('recepcion', new Blob([PNG], { type: 'image/png' }), 'romana-ln.png');
  const rec = await api(`/despachos/${d.data.id}/recepcionar`, { method: 'POST', token: tv, form: fdRec });
  ok(rec.data.estado === 'observado', 'diferencia de peso 4% → queda observado');
  const ev2 = await api(`/despachos/${d.data.id}/evidencia`, { token: tv });
  ok((ev2.data.archivos ?? []).some((a) => a.etiqueta === 'Ticket de báscula La Negra'),
    'el ticket de báscula de La Negra queda adjunto a la guía');
  const precioCongelado = rec.data.precio_kg;
  ok(precioCongelado > 0 && rec.data.valor === Math.round(4800 * precioCongelado), 'precio congelado y valor calculado');

  ok((await api(`/despachos/${d.data.id}/resolver`, { method: 'POST', token: ti, body: {} })).status === 400, 'resolver sin observación → rechazado');
  const resu = await api(`/despachos/${d.data.id}/resolver`, { method: 'POST', token: ti, body: { observacion: 'Merma verificada en báscula (prueba E2E)' } });
  ok(resu.data.estado === 'recepcionado', 'ITO resuelve el observado con observación');

  const nuevoPrecio = await api('/precios', { method: 'POST', token: tc, body: { categoria_id: 1, precio_kg: precioCongelado + 500 } });
  creado.precioId = nuevoPrecio.data.id;
  const despues = (await api('/despachos', { token: tc })).data.find((x) => x.id === d.data.id);
  ok(despues.precio_kg === precioCongelado, 'cambio de precio no altera guías ya valorizadas');

  const tr = await api('/traslados', { method: 'POST', token: tv, body: { categoria_id: 1, kg: 4800 } });
  creado.trasladoId = tr.data.id;
  ok(/^GT-\d+$/.test(tr.data.guia), `traslado a Lampa con folio (${tr.data.guia})`);
  const lampa = await api(`/traslados/${tr.data.id}/recepcionar`, { method: 'POST', token: tv, body: { kg_lampa: 4795 } });
  ok(/^CDF-\d+$/.test(lampa.data.cert_folio), `Lampa emite certificado de disposición final (${lampa.data.cert_folio})`);
  ok((await api(`/traslados/${tr.data.id}/recepcionar`, { method: 'POST', token: tv, body: { kg_lampa: 1 } })).status === 409, 'doble recepción del traslado → rechazada');

  console.log('\nCarga masiva atómica del programa');
  const SEM = [2031, 15]; creado.programaSemana = SEM;
  const malo = await api('/programa/masivo', { method: 'POST', token: tl, body: {
    anio: SEM[0], semana: SEM[1],
    filas: [{ dia: 'Lun', patio_id: 1, categoria_id: 1, ton_estimadas: 10 }, { dia: 'Lun', patio_id: 999, categoria_id: 1, ton_estimadas: 5 }],
  } });
  const trasFallo = await api(`/programa?anio=${SEM[0]}&semana=${SEM[1]}`, { token: tl });
  ok(malo.status === 400 && trasFallo.data.rows.length === 0, 'carga con una fila inválida → no entra ninguna (atómica)');
  const bueno = await api('/programa/masivo', { method: 'POST', token: tl, body: {
    anio: SEM[0], semana: SEM[1],
    filas: [{ dia: 'Lun', patio_id: 1, categoria_id: 1, ton_estimadas: 10 }, { dia: 'Mar', patio_id: 2, categoria_id: 2, ton_estimadas: 8 }],
  } });
  ok(bueno.status === 200 && bueno.data.length === 2, 'carga válida inserta las 2 actividades');

  console.log('\nGestión de cuentas');
  const nu = await api('/usuarios', { method: 'POST', token: tc, body: { username: 'e2e.prueba', nombre: 'Cuenta de prueba E2E', role: 'limpieza' } });
  creado.userId = nu.data.user?.id;
  ok(nu.status === 200 && nu.data.password?.length >= 10, 'cuenta creada con clave generada');
  ok((await login('e2e.prueba', nu.data.password)).status === 200, 'la cuenta nueva puede entrar');
  await api(`/usuarios/${nu.data.user.id}`, { method: 'PATCH', token: tc, body: { activo: false } });
  ok((await login('e2e.prueba', nu.data.password)).status === 401, 'cuenta desactivada no puede entrar');
  const yo = (await api('/usuarios', { token: tc })).data.find((u) => u.username === 'coordinador');
  ok((await api(`/usuarios/${yo.id}`, { method: 'PATCH', token: tc, body: { activo: false } })).status !== 200, 'auto-desactivación bloqueada');

  console.log('\nAuditoría');
  const bitacora = (await api('/auditoria', { token: tc })).data;
  const lista = Array.isArray(bitacora) ? bitacora : bitacora.rows ?? [];
  ok(lista.some((a) => (a.objeto || '').includes(d.data.guia)), 'las acciones de la prueba quedaron en la bitácora');
} catch (e) {
  fallan++;
  console.error('  ✗ excepción no controlada —', e.message);
} finally {
  await limpiar();
  server.kill();
}

console.log(`\n${pasan} pruebas OK · ${fallan} fallidas · datos de prueba eliminados\n`);
process.exit(fallan ? 1 : 0);
