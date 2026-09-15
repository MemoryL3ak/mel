// Panel de control: el flujo físico del material del mes (patios → La Negra
// → Lampa), la serie diaria y lo urgente según el rol de quien entra.
import { Router } from 'express';
import { supa, q, ah, hoy, semanaISO, fmtFecha } from '../supa.js';
import { auth } from '../auth.js';
import { contrato, venceElPrecio } from '../contrato.js';

const r = Router();

r.get('/panel', auth(), ah(async (req, res) => {
  const { anio, semana } = semanaISO();
  const mes = hoy().slice(0, 7);
  const hace14 = new Date(Date.now() - 13 * 86400000);
  const desde14 = `${hace14.getFullYear()}-${String(hace14.getMonth() + 1).padStart(2, '0')}-${String(hace14.getDate()).padStart(2, '0')}`;

  const [transito, observados, trasladosTr, prog, eps, cuad, actividad, despMes, trasMes, desp14, cats, precios, cfg] = await Promise.all([
    q(supa.from('despachos').select('id, guia, fecha').eq('estado', 'en_transito').order('id')),
    q(supa.from('despachos').select('id, guia, obs_recepcion').eq('estado', 'observado').order('id')),
    q(supa.from('traslados').select('id, guia').eq('estado', 'en_transito')),
    q(supa.from('programa').select('estado, ton_estimadas, ton_reales').eq('anio', anio).eq('semana', semana)),
    q(supa.from('estados_pago').select('*').order('periodo', { ascending: false }).limit(6)),
    q(supa.from('cuadraturas').select('anio, semana, estado').order('id', { ascending: false }).limit(1)),
    q(supa.from('auditoria').select('*').order('id', { ascending: false }).limit(6)),
    q(supa.from('despachos').select('fecha, kg_origen, kg_destino, valor').gte('fecha', mes + '-01')),
    q(supa.from('traslados').select('fecha, kg, kg_lampa, cert_folio').gte('fecha', mes + '-01')),
    q(supa.from('despachos').select('fecha, kg_origen').gte('fecha', desde14)),
    q(supa.from('categorias').select('id, nombre').eq('activo', true)),
    q(supa.from('precios').select('categoria_id, precio_kg, vigente_desde').order('vigente_desde', { ascending: false })),
    contrato(),
  ]);

  // Flujo físico del mes: cuánto salió de patios, cuánto validó La Negra,
  // cuánto quedó dispuesto en Lampa con certificado.
  const flujo = {
    kg_patios: despMes.reduce((a, d) => a + Number(d.kg_origen), 0),
    guias: despMes.length,
    kg_lanegra: despMes.reduce((a, d) => a + Number(d.kg_destino ?? 0), 0),
    kg_lampa: trasMes.reduce((a, t) => a + Number(t.kg_lampa ?? 0), 0),
    certs: trasMes.filter((t) => t.cert_folio).length,
  };

  // Serie diaria (14 días): kg despachados desde patios.
  const porDia = {};
  for (const d of desp14) porDia[d.fecha] = (porDia[d.fecha] || 0) + Number(d.kg_origen);
  const serie14 = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(hace14.getTime() + i * 86400000);
    const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    return { dia: k.slice(8), kg: porDia[k] || 0 };
  });

  const rol = req.user.role;
  const pendientes = [];
  const epAbierto = eps.find((e) => ['generado', 'en_revision', 'con_ajustes', 'firmado', 'facturado', 'pagado'].includes(e.estado));

  // El destino incluye la pestaña exacta: el botón "Ir" tiene que dejar a la
  // persona donde está el botón que resuelve el pendiente, no en la pantalla.
  if (['vendor', 'ito', 'coordinador'].includes(rol) && transito.length) {
    pendientes.push({ tipo: 'info', tag: 'Recepción', destino: 'despachos?t=d2', texto: `${transito.length} despacho(s) en tránsito a La Negra por recepcionar` });
  }
  if (['ito', 'coordinador'].includes(rol)) {
    observados.forEach((d) => pendientes.push({ tipo: 'warn', tag: 'Observado', destino: 'despachos?t=d1&f=observado', texto: `Guía ${d.guia} con diferencia de peso por resolver` }));
    const ult = cuad[0];
    if (!ult || ult.anio !== anio || ult.semana !== semana) {
      pendientes.push({ tipo: 'info', tag: 'Cuadratura', destino: 'cuadratura', texto: `La cuadratura de la semana ${semana} aún no se cierra` });
    }
    // Vigencia de la tabla de precios: avisa antes de que haya que renegociar.
    const h = hoy();
    const vencidos = cats.filter((c) => {
      const vig = precios.find((p) => p.categoria_id === c.id && p.vigente_desde <= h);
      return vig && venceElPrecio(vig.vigente_desde, cfg.meses_vigencia_precio) < h;
    });
    if (vencidos.length) {
      pendientes.push({
        tipo: 'bad', tag: 'Precios', destino: 'valorizacion',
        texto: `${vencidos.length} precio(s) con vigencia vencida: ${vencidos.map((c) => c.nombre).join(', ')}`,
      });
    }
  }
  if (rol === 'coordinador' && epAbierto?.estado === 'en_revision') {
    pendientes.push({ tipo: 'warn', tag: 'Aprobación', destino: 'estados', texto: `${epAbierto.folio} espera su revisión y firma` });
  }
  // Plazo contractual: factura pagada en menos de 15 días.
  if (epAbierto?.estado === 'facturado' && epAbierto.factura_fecha && ['vendor', 'coordinador', 'ito'].includes(rol)) {
    const dias = Math.floor((new Date(hoy()) - new Date(epAbierto.factura_fecha)) / 86400000);
    const restan = 15 - dias;
    pendientes.push(restan >= 0
      ? { tipo: restan <= 3 ? 'warn' : 'info', tag: 'Pago 15 días', destino: 'estados', texto: `${epAbierto.folio} facturado hace ${dias} día(s): quedan ${restan} para el pago` }
      : { tipo: 'bad', tag: 'Plazo vencido', destino: 'estados', texto: `${epAbierto.folio}: el plazo de pago de 15 días venció hace ${-restan} día(s)` });
  }
  if (rol === 'vendor') {
    if (epAbierto?.estado === 'firmado') pendientes.push({ tipo: 'warn', tag: 'Factura', destino: 'estados', texto: `${epAbierto.folio} firmado: registre la factura de compra` });
    if (trasladosTr.length) pendientes.push({ tipo: 'info', tag: 'Lampa', destino: 'despachos?t=d3', texto: `${trasladosTr.length} traslado(s) en tránsito a Lampa por recepcionar` });
  }
  if (rol === 'coordinador' && epAbierto?.estado === 'pagado') {
    pendientes.push({ tipo: 'info', tag: 'Conciliación', destino: 'estados', texto: `${epAbierto.folio} pagado: revise la transferencia` });
  }
  if (['limpieza', 'coordinador'].includes(rol) && !prog.length) {
    pendientes.push({ tipo: 'info', tag: 'Programa', destino: 'programa', texto: `La semana ${semana} no tiene planificación de despachos` });
  }

  const ejec = prog.filter((p) => p.estado === 'ejecutado');
  res.json({
    flujo,
    serie14,
    kpis: {
      kg_mes: flujo.kg_lanegra,
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
