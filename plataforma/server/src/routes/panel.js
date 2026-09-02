// Panel de control: lo urgente primero, según el rol de quien entra.
import { Router } from 'express';
import { supa, q, ah, hoy, semanaISO, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

r.get('/panel', auth(), ah(async (req, res) => {
  const { anio, semana } = semanaISO();
  const mes = hoy().slice(0, 7);
  const [transito, observados, trasladosTr, prog, eps, cuad, actividad, despMes] = await Promise.all([
    q(supa.from('despachos').select('id, guia, fecha').eq('estado', 'en_transito').order('id')),
    q(supa.from('despachos').select('id, guia, obs_recepcion').eq('estado', 'observado').order('id')),
    q(supa.from('traslados').select('id, guia').eq('estado', 'en_transito')),
    q(supa.from('programa').select('estado, ton_estimadas, ton_reales').eq('anio', anio).eq('semana', semana)),
    q(supa.from('estados_pago').select('*').order('periodo', { ascending: false }).limit(6)),
    q(supa.from('cuadraturas').select('anio, semana, estado').order('id', { ascending: false }).limit(1)),
    q(supa.from('auditoria').select('*').order('id', { ascending: false }).limit(6)),
    q(supa.from('despachos').select('kg_destino, valor').gte('fecha', mes + '-01').not('kg_destino', 'is', null)),
  ]);

  const rol = req.user.role;
  const pendientes = [];
  const epAbierto = eps.find((e) => ['generado', 'en_revision', 'con_ajustes', 'firmado', 'facturado', 'pagado'].includes(e.estado));

  if (['vendor', 'ito', 'coordinador'].includes(rol) && transito.length) {
    pendientes.push({ tipo: 'info', tag: 'Recepción', destino: 'despachos', texto: `${transito.length} despacho(s) en tránsito a La Negra por recepcionar` });
  }
  if (['ito', 'coordinador'].includes(rol)) {
    observados.forEach((d) => pendientes.push({ tipo: 'warn', tag: 'Observado', destino: 'despachos', texto: `Guía ${d.guia} con diferencia de peso por resolver` }));
    const ult = cuad[0];
    if (!ult || ult.anio !== anio || ult.semana !== semana) {
      pendientes.push({ tipo: 'info', tag: 'Cuadratura', destino: 'cuadratura', texto: `La cuadratura de la semana ${semana} aún no se cierra` });
    }
  }
  if (rol === 'coordinador' && epAbierto?.estado === 'en_revision') {
    pendientes.push({ tipo: 'warn', tag: 'Aprobación', destino: 'estados', texto: `${epAbierto.folio} espera su revisión y firma` });
  }
  if (rol === 'vendor') {
    if (epAbierto?.estado === 'firmado') pendientes.push({ tipo: 'warn', tag: 'Factura', destino: 'estados', texto: `${epAbierto.folio} firmado: registre la factura de compra` });
    if (epAbierto?.estado === 'facturado') pendientes.push({ tipo: 'warn', tag: 'Pago', destino: 'estados', texto: `${epAbierto.folio} facturado: el pago debe registrarse antes de 15 días` });
    if (trasladosTr.length) pendientes.push({ tipo: 'info', tag: 'Lampa', destino: 'despachos', texto: `${trasladosTr.length} traslado(s) en tránsito a Lampa por recepcionar` });
  }
  if (rol === 'coordinador' && epAbierto?.estado === 'pagado') {
    pendientes.push({ tipo: 'info', tag: 'Conciliación', destino: 'estados', texto: `${epAbierto.folio} pagado: revise la transferencia` });
  }
  if (['limpieza', 'coordinador'].includes(rol) && !prog.length) {
    pendientes.push({ tipo: 'info', tag: 'Programa', destino: 'programa', texto: `La semana ${semana} no tiene planificación de despachos` });
  }

  const ejec = prog.filter((p) => p.estado === 'ejecutado');
  res.json({
    kpis: {
      kg_mes: despMes.reduce((a, d) => a + Number(d.kg_destino), 0),
      valor_mes: despMes.reduce((a, d) => a + Number(d.valor ?? 0), 0),
      en_transito: transito.length,
      programa: { ejecutadas: ejec.length, total: prog.length, semana },
      ep: epAbierto ? { folio: epAbierto.folio, estado: epAbierto.estado, total: Number(epAbierto.total) } : null,
    },
    pendientes: pendientes.slice(0, 6),
    actividad: actividad.map((a) => ({ ...a, fecha: fmtFecha(a.fecha) })),
  });
}));

export default r;
