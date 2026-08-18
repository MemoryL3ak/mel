import { Router } from 'express';
import { db, audit, generarEP, recalcularEP, hoy } from '../db.js';
import { auth } from '../auth.js';

const r = Router();
const OPER = ['limpieza', 'ito', 'coordinador'];
const LECT = ['limpieza', 'vendor', 'ito', 'coordinador'];

/* ---------- maestros ---------- */
r.get('/maestros', auth(), (_req, res) => {
  res.json({
    patios: db.prepare('SELECT * FROM patios').all(),
    categorias: db.prepare('SELECT * FROM categorias ORDER BY nombre').all(),
  });
});

/* ---------- programa de limpieza ---------- */
r.get('/programa', auth(...OPER), (req, res) => {
  const rows = db.prepare(
    'SELECT p.*, pa.nombre AS patio FROM programa p JOIN patios pa ON pa.id=p.patio_id ORDER BY p.semana DESC, p.id'
  ).all();
  const semanas = [...new Set(rows.map((x) => x.semana))];
  res.json({ semanas, rows });
});

r.post('/programa/:id/ejecutar', auth(...OPER), (req, res) => {
  const { real_ton } = req.body || {};
  if (!real_ton || real_ton <= 0) return res.status(400).json({ error: 'Indique el tonelaje real retirado' });
  db.prepare("UPDATE programa SET real_ton=?, estado='ejecutado', fecha=COALESCE(fecha,?) WHERE id=?")
    .run(real_ton, hoy(), req.params.id);
  audit(req.user.name, req.user.role, 'Registró ejecución de retiro programado', 'PRG-' + req.params.id);
  res.json({ ok: true });
});

/* ---------- despachos y recepciones ---------- */
const DESP_SQL = `SELECT d.*, pa.nombre AS patio, c.nombre AS categoria, c.precio_kg,
  ROUND(COALESCE(d.kg_destino, d.kg_origen) * c.precio_kg) AS valor,
  ep.folio AS ep_folio
  FROM despachos d
  JOIN patios pa ON pa.id=d.patio_id
  JOIN categorias c ON c.id=d.categoria_id
  LEFT JOIN estados_pago ep ON ep.id=d.ep_id`;

r.get('/despachos', auth(...LECT), (_req, res) => {
  res.json(db.prepare(DESP_SQL + ' ORDER BY d.fecha DESC, d.id DESC LIMIT 60').all());
});

r.get('/despachos/:id', auth(...LECT), (req, res) => {
  const d = db.prepare(DESP_SQL + ' WHERE d.id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Despacho no encontrado' });
  res.json(d);
});

r.post('/despachos', auth(...OPER), (req, res) => {
  const { patio_id, categoria_id, kg_origen, fotos = 2 } = req.body || {};
  if (!patio_id || !categoria_id || !kg_origen) return res.status(400).json({ error: 'Patio, categoría y peso son obligatorios' });
  const last = db.prepare("SELECT MAX(CAST(substr(guia,4) AS INTEGER)) AS n FROM despachos").get().n || 4500;
  const guia = 'GD-' + (last + 1);
  db.prepare('INSERT INTO despachos(guia,fecha,patio_id,categoria_id,kg_origen,fotos) VALUES (?,?,?,?,?,?)')
    .run(guia, hoy(), patio_id, categoria_id, kg_origen, fotos);
  audit(req.user.name, req.user.role, 'Registró retiro con evidencia', guia);
  res.status(201).json(db.prepare(DESP_SQL + ' WHERE d.guia=?').get(guia));
});

r.post('/despachos/:id/recepcionar', auth('ito', 'coordinador', 'vendor'), (req, res) => {
  const { kg_destino } = req.body || {};
  const d = db.prepare('SELECT * FROM despachos WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Despacho no encontrado' });
  if (!kg_destino || kg_destino <= 0) return res.status(400).json({ error: 'Indique el peso validado en destino' });
  const dif = Math.abs(kg_destino - d.kg_origen) / d.kg_origen;
  const estado = dif > 0.02 ? 'observado' : 'recepcionado';
  db.prepare('UPDATE despachos SET kg_destino=?, estado=? WHERE id=?').run(kg_destino, estado, d.id);
  audit(req.user.name, req.user.role, estado === 'observado' ? 'Recepción observada (dif. de peso >2%)' : 'Validó recepción', d.guia);
  res.json({ ok: true, estado });
});

/* ---------- valorización ---------- */
r.get('/valorizacion', auth('vendor', 'ito', 'coordinador'), (_req, res) => {
  const categorias = db.prepare('SELECT * FROM categorias ORDER BY precio_kg DESC').all();
  const mes = hoy().slice(0, 7);
  const resumen = db.prepare(`
    SELECT c.nombre, c.precio_kg,
      COALESCE(SUM(COALESCE(d.kg_destino,d.kg_origen)),0) AS kg,
      ROUND(COALESCE(SUM(COALESCE(d.kg_destino,d.kg_origen)*c.precio_kg),0)) AS valor
    FROM categorias c
    LEFT JOIN despachos d ON d.categoria_id=c.id AND substr(d.fecha,1,7)=?
    GROUP BY c.id ORDER BY valor DESC`).all(mes);
  res.json({ contrato: 'CTR-MEL-2025-114', vendor: 'Metarec SpA', vigencia: '2026-12-31', mes, categorias, resumen });
});

/* ---------- estados de pago ---------- */
function epView(ep) {
  const desc = db.prepare('SELECT * FROM descuentos WHERE ep_id=?').all(ep.id);
  const pagos = db.prepare('SELECT * FROM pagos_vendor WHERE ep_id=? ORDER BY fecha').all(ep.id);
  const pagado = pagos.reduce((s, p) => s + p.monto, 0);
  const nDesp = db.prepare('SELECT COUNT(*) AS n FROM despachos WHERE ep_id=?').get(ep.id).n;
  const lineas = db.prepare(`
    SELECT c.nombre, COUNT(*) AS n, SUM(d.kg_destino) AS kg, ROUND(SUM(d.kg_destino*c.precio_kg)) AS monto
    FROM despachos d JOIN categorias c ON c.id=d.categoria_id
    WHERE d.ep_id=? GROUP BY c.id ORDER BY monto DESC`).all(ep.id);
  return {
    ...ep, descuentos: desc, pagos, pagado, n_despachos: nDesp, lineas,
    conciliacion: ep.estado !== 'aprobado' ? null : pagado >= ep.total ? 'conciliado' : pagado > 0 ? 'parcial' : 'pendiente',
    pct_pagado: ep.total ? Math.round((pagado / ep.total) * 100) : 0,
  };
}

r.get('/eps', auth('vendor', 'ito', 'coordinador'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM estados_pago ORDER BY periodo DESC').all().map(epView));
});

r.post('/eps/generar', auth('ito', 'coordinador'), (req, res) => {
  const periodo = (req.body && req.body.periodo) || hoy().slice(0, 7);
  if (db.prepare('SELECT 1 FROM estados_pago WHERE periodo=?').get(periodo))
    return res.status(409).json({ error: `Ya existe un estado de pago para el período ${periodo}` });
  const ep = generarEP(periodo, req.user);
  if (!ep) return res.status(400).json({ error: 'No hay despachos recepcionados sin EP en ese período' });
  res.status(201).json(epView(ep));
});

r.post('/eps/:id/descuentos', auth('ito', 'coordinador'), (req, res) => {
  const { concepto, monto } = req.body || {};
  if (!concepto || !monto) return res.status(400).json({ error: 'Concepto y monto son obligatorios' });
  db.prepare('INSERT INTO descuentos(ep_id,concepto,monto) VALUES (?,?,?)').run(req.params.id, concepto, monto);
  recalcularEP(req.params.id);
  const ep = db.prepare('SELECT * FROM estados_pago WHERE id=?').get(req.params.id);
  audit(req.user.name, req.user.role, `Registró descuento: ${concepto}`, ep.folio);
  res.json(epView(ep));
});

r.post('/eps/:id/aprobar', auth('coordinador'), (req, res) => {
  const ep = db.prepare('SELECT * FROM estados_pago WHERE id=?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  if (ep.estado !== 'en_aprobacion') return res.status(409).json({ error: 'El EP no está en aprobación' });
  db.prepare("UPDATE estados_pago SET estado='aprobado', aprobado_por=?, fecha_aprobacion=? WHERE id=?")
    .run(req.user.name, hoy(), ep.id);
  audit(req.user.name, req.user.role, 'Aprobó estado de pago', ep.folio);
  res.json(epView(db.prepare('SELECT * FROM estados_pago WHERE id=?').get(ep.id)));
});

r.post('/eps/:id/rechazar', auth('coordinador'), (req, res) => {
  const { observacion } = req.body || {};
  if (!observacion || !observacion.trim())
    return res.status(400).json({ error: 'La observación es obligatoria para rechazar' });
  const ep = db.prepare('SELECT * FROM estados_pago WHERE id=?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  db.prepare("UPDATE estados_pago SET estado='rechazado', observacion=? WHERE id=?").run(observacion.trim(), ep.id);
  audit(req.user.name, req.user.role, `Rechazó EP con observación: "${observacion.trim()}"`, ep.folio);
  res.json(epView(db.prepare('SELECT * FROM estados_pago WHERE id=?').get(ep.id)));
});

r.post('/eps/:id/pagos', auth('vendor', 'ito', 'coordinador'), (req, res) => {
  const { monto, comprobante } = req.body || {};
  const ep = db.prepare('SELECT * FROM estados_pago WHERE id=?').get(req.params.id);
  if (!ep) return res.status(404).json({ error: 'EP no encontrado' });
  if (ep.estado !== 'aprobado') return res.status(409).json({ error: 'Solo se concilian pagos de EP aprobados' });
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Indique el monto transferido' });
  db.prepare('INSERT INTO pagos_vendor(ep_id,fecha,monto,comprobante) VALUES (?,?,?,?)')
    .run(ep.id, hoy(), monto, comprobante || null);
  audit(req.user.name, req.user.role, `Registró pago recibido ($${monto.toLocaleString('es-CL')})`, ep.folio);
  res.json(epView(ep));
});

export default r;
