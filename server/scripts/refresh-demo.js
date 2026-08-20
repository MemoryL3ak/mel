// Restaura el estado canónico de la demo re-anclando las fechas relativas a hoy.
// Uso: npm run demo:refresh (ideal la mañana de una presentación o tras ensayar).
// No toca el esquema: solo datos. Para un reset total, re-ejecutar server/db/supabase.sql.
import { supa, q } from '../src/supa.js';

// Fecha local (no UTC): así "hace 14 días" coincide con lo que la interfaz calcula
const d = (n) => {
  const t = new Date();
  t.setDate(t.getDate() + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};

// 1. Componentes: estados y fechas canónicas (OBS-198 en día 14; OBS-190 convertido)
const COMPONENTES = [
  ['OBS-188', 'adjudicado', -20, 2], ['OBS-190', 'convertido', -16, null],
  ['OBS-195', 'adjudicado', -12, 1], ['OBS-198', 'publicado', -14, null],
  ['OBS-201', 'publicado', -6, null], ['OBS-203', 'publicado', -9, null],
  ['OBS-204', 'publicado', -2, null], ['OBS-207', 'planificado', null, null],
];
for (const [codigo, estado, off, adj] of COMPONENTES) {
  await q(supa.from('componentes').update({ estado, publicado_el: off === null ? null : d(off), adjudicado_a: adj })
    .eq('codigo', codigo).select('id'));
}
const ids = Object.fromEntries((await q(supa.from('componentes').select('id,codigo'))).map((c) => [c.codigo, c.id]));

// 2. Ofertas: eliminar las de ensayo, restaurar estados y fechas del seed
const SEED_OFERTAS = [
  ['OBS-201', 1, 33500000, 0, 'recibida'], ['OBS-201', 2, 31200000, -2, 'recibida'], ['OBS-201', 3, 29000000, -3, 'recibida'],
  ['OBS-198', 2, 41000000, -4, 'recibida'], ['OBS-203', 1, 5900000, -5, 'recibida'], ['OBS-203', 2, 6100000, -3, 'recibida'],
  ['OBS-203', 3, 5400000, -1, 'recibida'], ['OBS-195', 1, 10200000, -8, 'adjudicada'], ['OBS-188', 2, 7600000, -16, 'adjudicada'],
];
const ofertas = await q(supa.from('ofertas').select('*'));
const seedDe = (o) => SEED_OFERTAS.find(([c, cb, m]) => ids[c] === o.componente_id && cb === o.comprador_id && m === o.monto);
const extraOfertas = ofertas.filter((o) => !seedDe(o)).map((o) => o.id);
if (extraOfertas.length) await q(supa.from('ofertas').delete().in('id', extraOfertas).select('id'));
for (const o of ofertas.filter(seedDe)) {
  const [, , , off, estado] = seedDe(o);
  await q(supa.from('ofertas').update({ fecha: d(off), estado }).eq('id', o.id).select('id'));
}

// 3. Adjudicaciones: conservar solo las dos del seed
await q(supa.from('adjudicaciones').delete().not('certificado', 'in', '("CA-2026-044","CA-2026-045")').select('id'));
await q(supa.from('adjudicaciones').update({ fecha: d(-14) }).eq('certificado', 'CA-2026-044').select('id'));
await q(supa.from('adjudicaciones').update({ fecha: d(-6) }).eq('certificado', 'CA-2026-045').select('id'));

// 4. Entregas: solo las dos del seed, con sus estados
await q(supa.from('entregas').delete().not('componente_id', 'in', `(${ids['OBS-188']},${ids['OBS-195']})`).select('id'));
await q(supa.from('entregas').update({ adjudicado_el: d(-14), estado: 'sin_coordinacion', agenda: null })
  .eq('componente_id', ids['OBS-188']).select('id'));
await q(supa.from('entregas').update({ adjudicado_el: d(-6), estado: 'agendada', agenda: d(3) })
  .eq('componente_id', ids['OBS-195']).select('id'));

// 5. Compradores: due diligence canónica; eliminar registros de ensayo
await q(supa.from('compradores').update({ due_diligence: 'aprobada' }).in('id', [1, 2]).select('id'));
await q(supa.from('compradores').update({ due_diligence: 'en_revision' }).eq('id', 3).select('id'));
const extraComp = (await q(supa.from('compradores').select('id'))).filter((c) => c.id > 3).map((c) => c.id);
if (extraComp.length) await q(supa.from('compradores').delete().in('id', extraComp).select('id'));

// 6. EP-2026-07 de vuelta a "en aprobación", sin pagos y solo con su descuento de seed
const [ep7] = await q(supa.from('estados_pago').select('*').eq('folio', 'EP-2026-07'));
if (ep7) {
  await q(supa.from('pagos_vendor').delete().eq('ep_id', ep7.id).select('id'));
  const descs = await q(supa.from('descuentos').select('*').eq('ep_id', ep7.id));
  const extraDesc = descs.filter((x) => !(x.monto === 1250000 && x.concepto.startsWith('Flete'))).map((x) => x.id);
  if (extraDesc.length) await q(supa.from('descuentos').delete().in('id', extraDesc).select('id'));
  await q(supa.from('estados_pago').update({
    estado: 'en_aprobacion', aprobado_por: null, fecha_aprobacion: null, observacion: null, total: ep7.bruto - 1250000,
  }).eq('id', ep7.id).select('id'));
}
// EP-2026-06: conservar solo el pago parcial del seed
const [ep6] = await q(supa.from('estados_pago').select('id').eq('folio', 'EP-2026-06'));
const pagos6 = await q(supa.from('pagos_vendor').select('*').eq('ep_id', ep6.id));
const extraPagos = pagos6.filter((p) => p.monto !== 43992180).map((p) => p.id);
if (extraPagos.length) await q(supa.from('pagos_vendor').delete().in('id', extraPagos).select('id'));

// 7. Despachos: eliminar los de ensayo (posteriores a GD-4531, sin EP) y re-anclar el mes en curso
const desp = await q(supa.from('despachos').select('id,guia,ep_id'));
const ensayo = desp.filter((x) => parseInt(x.guia.slice(3)) > 4531 && !x.ep_id).map((x) => x.id);
if (ensayo.length) await q(supa.from('despachos').delete().in('id', ensayo).select('id'));
const FECHAS_MES = { 'GD-4526': -6, 'GD-4527': -5, 'GD-4528': -4, 'GD-4529': 0, 'GD-4530': -1, 'GD-4531': -1 };
for (const [guia, off] of Object.entries(FECHAS_MES)) {
  await q(supa.from('despachos').update({ fecha: d(off) }).eq('guia', guia).select('id'));
}
await q(supa.from('despachos').update({ estado: 'en_transito', kg_destino: null }).eq('guia', 'GD-4529').select('id'));

// 8. Programa semana 34: estados canónicos (3 ejecutados, 2 programados, 1 reprogramado)
const prg = await q(supa.from('programa').select('id').eq('semana', 34).order('id'));
const CANON_PRG = [
  { fecha: d(-1), estado: 'ejecutado', real_ton: 24.6 }, { fecha: d(-1), estado: 'ejecutado', real_ton: 13.1 },
  { fecha: d(0), estado: 'ejecutado', real_ton: 6.8 }, { fecha: null, estado: 'programado', real_ton: null },
  { fecha: null, estado: 'programado', real_ton: null }, { fecha: null, estado: 'reprogramado', real_ton: null },
];
for (let i = 0; i < Math.min(prg.length, CANON_PRG.length); i++) {
  await q(supa.from('programa').update(CANON_PRG[i]).eq('id', prg[i].id).select('id'));
}

// 9. Documentos: vencimiento del CDF, fechas relativas, y limpiar scraps/cargas de ensayo
await q(supa.from('documentos').update({ vencimiento: d(12) }).eq('archivo', 'CDF-118.pdf').select('id'));
const docs = await q(supa.from('documentos').select('id,archivo,ruta'));
const scrapExtra = docs.filter((x) => /^SCRAP-OBS-/.test(x.archivo) && x.archivo !== 'SCRAP-OBS-190.pdf').map((x) => x.id);
const subidosEnsayo = docs.filter((x) => x.ruta).map((x) => x.id); // cargas de prueba (los del seed no tienen archivo físico)
const borrarDocs = [...new Set([...scrapExtra, ...subidosEnsayo])];
if (borrarDocs.length) await q(supa.from('documentos').delete().in('id', borrarDocs).select('id'));
const FECHAS_DOC = { 'GD-4531.pdf': -1, 'GV-2214.pdf': 0, 'EP-2026-07.pdf': -2, 'DESC-2026-07.xlsx': -2, 'SCRAP-2026-031.pdf': -3, 'SCRAP-OBS-190.pdf': -1 };
for (const [archivo, off] of Object.entries(FECHAS_DOC)) {
  await q(supa.from('documentos').update({ fecha: d(off) }).eq('archivo', archivo).select('id'));
}

// 10. Bitácora: re-sembrar los cinco eventos canónicos
await q(supa.from('auditoria').delete().gte('id', 0).select('id'));
const EVENTOS = [
  ['P. Salinas', 'adminventa', 'Publicó componente', 'OBS-201'],
  ['Serlim Ltda.', 'limpieza', 'Registró retiro con evidencia', 'GD-4531'],
  ['C. Fuentes', 'ito', 'Envió EP a aprobación', 'EP-2026-07'],
  ['Ingemet SpA', 'comprador', 'Presentó oferta', 'OBS-201'],
  ['C. Fuentes', 'ito', 'Validó recepción', 'GD-4531'],
];
for (const [usuario, rol, accion, objeto] of EVENTOS) {
  await q(supa.from('auditoria').insert({ usuario, rol, accion, objeto }).select('id'));
}

console.log('Demo restaurada: fechas re-ancladas a hoy y estados canónicos (EP en aprobación, tolva en día 14, OBS-190 convertido).');
process.exit(0);
