// Suite E2E de la Fase 3 (repositorio documental). Levanta el servidor en un
// puerto de prueba, recorre la API real contra Supabase y elimina todo lo que
// crea. Ejecutar con: npm run test:documental  (requiere server/.env y la
// migración db/0015_documental.sql aplicada).
//
// Las sesiones se firman con el JWT_SECRET del .env en vez de iniciar sesión:
// así la prueba no depende de las contraseñas de las cuentas reales.
//
// Alcance: catálogo y visibilidad por perfil, carga con vencimiento, versiones
// inmutables (reemplazo y acumulación), URLs firmadas, corrección, anulación,
// pendientes, ajuste del catálogo y el registro desde los flujos existentes.
// Los documentos de prueba vencen lejos: un "por vencer" real dispararía el
// aviso por correo al coordinador si el barrido corriera en ese momento.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import jwt from 'jsonwebtoken';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.TEST_PORT || 4198);
const B = `http://localhost:${PORT}/api`;

const dotenv = Object.fromEntries(
  readFileSync(join(raiz, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const SUPA = dotenv.SUPABASE_URL, KEY = dotenv.SUPABASE_SECRET_KEY;
const sesion = (role) => jwt.sign(
  { sub: 0, username: `prueba.${role}`, name: `Prueba documental (${role})`, role, app_role: role },
  dotenv.JWT_SECRET, { expiresIn: '15m' });

let pasan = 0, fallan = 0;
const ok = (cond, nombre, detalle = '') => {
  if (cond) { pasan++; console.log(`  ✓ ${nombre}`); }
  else { fallan++; console.error(`  ✗ ${nombre}${detalle ? ' — ' + detalle : ''}`); }
};

async function api(path, { method = 'GET', role, body, form } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: {
      ...(form ? {} : body ? { 'Content-Type': 'application/json' } : {}),
      ...(role ? { Authorization: `Bearer ${sesion(role)}` } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const rest = (path, init = {}) => fetch(`${SUPA}/rest/v1${path}`, {
  ...init,
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mNkYPj/n4GBgYGJgYEBAB4TAgL5s2//AAAAAElFTkSuQmCC', 'base64');
const formulario = (campos, archivos = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  for (const [nombre, buf, tipo] of archivos) fd.append('archivos', new Blob([buf], { type: tipo }), nombre);
  return fd;
};
const enDias = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Lo creado, para eliminarlo al final pase lo que pase.
const creados = new Set();
let folioPrevio = null;
let tipoOriginal = null;

async function limpiar() {
  for (const id of creados) {
    const vers = await rest(`/documento_versiones?documento_id=eq.${id}&select=archivos`).then((r) => r.json()).catch(() => []);
    const rutas = vers.flatMap((v) => v.archivos ?? []).filter((a) => a.bucket === 'documentos').map((a) => a.path);
    if (rutas.length) {
      await fetch(`${SUPA}/storage/v1/object/documentos`, {
        method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: rutas }),
      });
    }
    await rest(`/documentos?id=eq.${id}`, { method: 'DELETE' });
  }
  // El folio vuelve a donde estaba, para que el primer documento real no
  // nazca con un salto de numeración por culpa de la prueba.
  if (folioPrevio != null) {
    await rest('/folios?tipo=eq.DOC', { method: 'PATCH', body: JSON.stringify({ ultimo: folioPrevio }) });
  }
  if (tipoOriginal) {
    const { codigo, responsable, aviso_dias } = tipoOriginal;
    await rest(`/doc_tipos?codigo=eq.${codigo}`, { method: 'PATCH', body: JSON.stringify({ responsable, aviso_dias }) });
  }
  // La prueba corre contra la base de producción: sus entradas de bitácora son
  // de sesiones ficticias y no deben quedar mezcladas con la operación real.
  await rest(`/auditoria?usuario=like.${encodeURIComponent('Prueba documental*')}`, { method: 'DELETE' });
}

// ---------- arranque del servidor de prueba ----------
const server = spawn(process.execPath, [join(raiz, 'src', 'index.js')], {
  cwd: raiz, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'inherit'],
});
server.on('error', (e) => { console.error('No se pudo iniciar el servidor de prueba:', e.message); process.exit(1); });
let listo = false;
for (let i = 0; i < 40 && !listo; i++) {
  try { listo = (await fetch(`${B}/health`).then((r) => r.json())).ok === true; }
  catch { await new Promise((r) => setTimeout(r, 500)); }
}
if (!listo) { console.error(`El servidor de prueba no respondió en el puerto ${PORT}`); server.kill(); process.exit(1); }

try {
  folioPrevio = (await rest('/folios?tipo=eq.DOC&select=ultimo').then((r) => r.json()))[0]?.ultimo ?? null;

  console.log('\nCatálogo y visibilidad por perfil');
  const cat = await api('/documentos/tipos', { role: 'coordinador' });
  if (cat.status === 503) throw new Error(cat.data.error);
  ok(cat.status === 200 && cat.data.tipos.length === 23, 'el coordinador ve los 23 tipos (9 + 14)', `vio ${cat.data.tipos?.length}`);
  ok(cat.data.tipos.filter((t) => t.proceso === 'chatarra').length === 9, '9 tipos de chatarra');
  ok(cat.data.hitos?.estado_pago?.estados?.facturado === 'Facturado', 'el catálogo de hitos llega con sus estados');
  const vend = await api('/documentos/tipos', { role: 'vendor' });
  ok(vend.status === 200 && vend.data.tipos.every((t) => t.proceso === 'chatarra'), 'el vendor no ve tipos de obsoletos');
  const adm = await api('/documentos/tipos', { role: 'admin_venta' });
  ok(adm.status === 200 && adm.data.tipos.length && adm.data.tipos.every((t) => t.proceso === 'obsoletos'), 'el adm. de venta solo ve obsoletos');
  ok((await api('/documentos', { role: 'comprador' })).status === 403, 'el comprador externo no entra al repositorio');

  console.log('\nCarga con vencimiento');
  const sinFecha = await api('/documentos', { method: 'POST', role: 'coordinador',
    form: formulario({ tipo: 'ch_contrato', ref_id: '1' }, [['contrato.pdf', PDF, 'application/pdf']]) });
  ok(sinFecha.status === 400 && /vencimiento/.test(sinFecha.data.error), 'un tipo que vence exige la fecha');
  const sinArchivo = await api('/documentos', { method: 'POST', role: 'coordinador',
    form: formulario({ tipo: 'ch_contrato', ref_id: '1', vence_el: enDias(400) }) });
  ok(sinArchivo.status === 400, 'sin archivos → 400');
  const formato = await api('/documentos', { method: 'POST', role: 'coordinador',
    form: formulario({ tipo: 'ch_contrato', ref_id: '1', vence_el: enDias(400) }, [['virus.exe', PDF, 'application/x-msdownload']]) });
  ok(formato.status === 400 && /Formato no admitido/.test(formato.data.error), 'formato no admitido → 400 con mensaje claro');
  const ajeno = await api('/documentos', { method: 'POST', role: 'vendor',
    form: formulario({ tipo: 'ch_contrato', ref_id: '1', vence_el: enDias(400) }, [['c.pdf', PDF, 'application/pdf']]) });
  ok(ajeno.status === 403, 'el vendor no carga el contrato (solo lo consulta)');

  const c1 = await api('/documentos', { method: 'POST', role: 'coordinador',
    form: formulario({ tipo: 'ch_contrato', ref_id: '1', vence_el: enDias(400), titulo: 'Contrato de prueba E2E' },
      [['Contrato año 2026.pdf', PDF, 'application/pdf']]) });
  if (c1.data.id) creados.add(c1.data.id);
  ok(c1.status === 200 && /^DOC-\d{4}$/.test(c1.data.folio), 'contrato cargado con folio DOC', JSON.stringify(c1.data));
  const id = c1.data.id;

  console.log('\nVisibilidad del documento');
  const lv = await api('/documentos', { role: 'vendor' });
  ok(lv.data.some?.((d) => d.id === id), 'el vendor lo ve (perfil de consulta)');
  ok((await api(`/documentos/${id}`, { role: 'limpieza' })).status === 404, 'limpieza no lo ve → 404');
  const det = await api(`/documentos/${id}`, { role: 'coordinador' });
  ok(det.data.venc?.clave === 'vigente' && det.data.versiones?.length === 1, 'detalle: vigente con una versión');
  ok(det.data.versiones?.[0]?.archivos?.[0]?.nombre === 'Contrato año 2026.pdf', 'el nombre con tilde y eñe se conserva');

  console.log('\nVersiones');
  ok((await api(`/documentos/${id}/versiones`, { method: 'POST', role: 'vendor',
    form: formulario({ nota: 'x', vence_el: enDias(400) }, [['c.pdf', PDF, 'application/pdf']]) })).status === 403,
  'el vendor no versiona el contrato');
  ok((await api(`/documentos/${id}/versiones`, { method: 'POST', role: 'coordinador',
    form: formulario({ vence_el: enDias(500) }, [['c.pdf', PDF, 'application/pdf']]) })).status === 400,
  'una versión nueva exige decir qué cambia');
  const v2 = await api(`/documentos/${id}/versiones`, { method: 'POST', role: 'coordinador',
    form: formulario({ nota: 'Renovación', vence_el: enDias(500) }, [['renovado.pdf', PDF, 'application/pdf']]) });
  ok(v2.status === 200 && v2.data.version_actual === 2 && v2.data.vence_el === enDias(500), 'versión 2 reemplaza y mueve el vencimiento');
  const v3 = await api(`/documentos/${id}/versiones`, { method: 'POST', role: 'coordinador',
    form: formulario({ nota: 'Anexo', vence_el: enDias(500), conservar: '1' }, [['anexo.png', PNG, 'image/png']]) });
  ok(v3.status === 200 && v3.data.version_actual === 3, 'versión 3 con conservar');
  const det3 = await api(`/documentos/${id}`, { role: 'coordinador' });
  const porV = Object.fromEntries((det3.data.versiones ?? []).map((v) => [v.version, v.archivos.length]));
  ok(porV[1] === 1 && porV[2] === 1 && porV[3] === 2, 'las versiones anteriores quedan intactas; la 3 suma el anexo', JSON.stringify(porV));
  const firm = await api(`/documentos/${id}/versiones/1`, { role: 'vendor' });
  const url = firm.data.archivos?.[0]?.url;
  ok(!!url && (await fetch(url)).status === 200, 'la versión 1 se descarga con URL firmada');

  console.log('\nCorrección y anulación');
  const corr = await api(`/documentos/${id}`, { method: 'PATCH', role: 'coordinador', body: { vence_el: enDias(450) } });
  ok(corr.status === 200 && corr.data.vence_el === enDias(450), 'el vencimiento se corrige sin versión nueva');
  ok((await api(`/documentos/${id}`, { method: 'PATCH', role: 'coordinador', body: { vence_el: enDias(450) } })).status === 400,
    'sin cambios → 400');
  ok((await api(`/documentos/${id}/anular`, { method: 'POST', role: 'ito', body: { motivo: 'x' } })).status === 403,
    'el ITO no anula');
  ok((await api(`/documentos/${id}/anular`, { method: 'POST', role: 'coordinador', body: {} })).status === 400,
    'anular exige motivo');
  ok((await api(`/documentos/${id}/anular`, { method: 'POST', role: 'coordinador', body: { motivo: 'Prueba E2E' } })).status === 200,
    'el coordinador anula con motivo');
  ok((await api(`/documentos/${id}/versiones`, { method: 'POST', role: 'coordinador',
    form: formulario({ nota: 'x', vence_el: enDias(500) }, [['c.pdf', PDF, 'application/pdf']]) })).status === 409,
  'un documento anulado no admite versiones');

  console.log('\nPendientes y catálogo');
  const pend = await api('/documentos/pendientes', { role: 'coordinador' });
  ok(pend.status === 200 && Array.isArray(pend.data), 'pendientes responde');
  ok(pend.data.some((p) => p.tipo === 'ch_contrato'), 'con el contrato anulado, el contrato vuelve a figurar como pendiente');
  const pv = await api('/documentos/pendientes', { role: 'vendor' });
  ok(pv.data.every((p) => p.proceso === 'chatarra'), 'el vendor solo ve pendientes de chatarra');

  tipoOriginal = cat.data.tipos.find((t) => t.codigo === 'ch_factura');
  ok((await api('/documentos/tipos/ch_factura', { method: 'PATCH', role: 'ito', body: { aviso_dias: 10 } })).status === 403,
    'solo el coordinador ajusta el catálogo');
  ok((await api('/documentos/tipos/ch_factura', { method: 'PATCH', role: 'coordinador', body: { roles_carga: ['vendor'] } })).status === 400,
    'el coordinador no puede quedar fuera de la carga');
  ok((await api('/documentos/tipos/ch_factura', { method: 'PATCH', role: 'coordinador', body: { exigible_en: ['inventado'] } })).status === 400,
    'la exigibilidad solo acepta estados del hito');
  const aj = await api('/documentos/tipos/ch_factura', { method: 'PATCH', role: 'coordinador', body: { responsable: 'Prueba E2E', aviso_dias: 10 } });
  ok(aj.status === 200 && aj.data.aviso_dias === 10, 'el coordinador ajusta responsable y aviso');

  console.log('\nRegistro desde los flujos existentes');
  // Mismo camino que usan la guía, el CDF y el acta: archivos ya subidos a
  // 'evidencia' que se registran como documento del hito. Dos tandas sobre el
  // mismo hito completan el documento en una versión nueva.
  const { detectarEsquema } = await import('../src/esquema.js');
  const { registrarArchivos, vencimiento } = await import('../src/documental.js');
  await detectarEsquema();
  const quien = { name: 'Prueba documental (flujo)', role: 'coordinador' };
  const r1 = await registrarArchivos({ tipo: 'ch_contrato', hito: 'contrato', refId: 1, quien,
    archivos: [{ bucket: 'evidencia', path: 'PRUEBA/no-existe-1.pdf', nombre: 'a.pdf', mime: 'application/pdf', bytes: 10 }] });
  if (r1) creados.add(r1);
  const r2 = await registrarArchivos({ tipo: 'ch_contrato', hito: 'contrato', refId: 1, quien,
    archivos: [{ bucket: 'evidencia', path: 'PRUEBA/no-existe-2.pdf', nombre: 'b.pdf', mime: 'application/pdf', bytes: 10 }] });
  ok(r1 && r1 === r2, 'la segunda tanda va al mismo documento');
  const dr = await api(`/documentos/${r1}`, { role: 'coordinador' });
  ok(dr.data.version_actual === 2 && dr.data.versiones?.[0]?.archivos?.length === 2, 'y crea una versión con ambas tandas');
  ok(dr.data.venc?.clave === 'sin_fecha', 'un contrato registrado sin fecha queda marcado «sin fecha»');

  console.log('\nCálculo de vencimientos');
  const t60 = { vence: true, aviso_dias: 60 };
  ok(vencimiento({ vence_el: enDias(10) }, t60).clave === 'por_vencer', 'a 10 días con aviso de 60 → por vencer');
  ok(vencimiento({ vence_el: enDias(61) }, t60).clave === 'vigente', 'a 61 días → vigente');
  ok(vencimiento({ vence_el: enDias(0) }, t60).clave === 'por_vencer', 'vence hoy → por vencer, no vencido');
  ok(vencimiento({ vence_el: enDias(-1) }, t60).clave === 'vencido', 'ayer → vencido');
  ok(vencimiento({ vence_el: null }, { vence: false }).clave === 'no_vence', 'tipo sin vencimiento → no vence');
} catch (e) {
  fallan++;
  console.error('  ✗ excepción no controlada —', e.message);
} finally {
  await limpiar();
  server.kill();
}

console.log(`\n${pasan} pruebas OK · ${fallan} fallidas · datos de prueba eliminados\n`);
process.exit(fallan ? 1 : 0);
