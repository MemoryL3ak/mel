import { Router } from 'express';
import { db, audit, hoy, diasDesde, convertirVencidos } from '../db.js';
import { auth } from '../auth.js';

const r = Router();
const GEST = ['adminventa', 'coordinador'];
const LIMITE_DIAS = 15;

function compView(c) {
  const ofertas = db.prepare('SELECT COUNT(*) AS n FROM ofertas WHERE componente_id=?').get(c.id).n;
  const comprador = c.adjudicado_a
    ? db.prepare('SELECT razon_social FROM compradores WHERE id=?').get(c.adjudicado_a)?.razon_social
    : null;
  return {
    ...c, n_ofertas: ofertas, comprador,
    dias_publicado: c.publicado_el ? diasDesde(c.publicado_el) : null,
    dias_limite: LIMITE_DIAS,
  };
}

r.get('/componentes', auth(...GEST), (_req, res) => {
  convertirVencidos();
  const rows = db.prepare(
    'SELECT c.*, p.nombre AS patio FROM componentes c LEFT JOIN patios p ON p.id=c.patio_id ORDER BY c.id DESC'
  ).all();
  res.json(rows.map(compView));
});

r.post('/componentes', auth(...GEST), (req, res) => {
  const { nombre, descripcion, patio_id, sector, valor_ref } = req.body || {};
  if (!nombre || !patio_id || !valor_ref) return res.status(400).json({ error: 'Nombre, patio y valor referencial son obligatorios' });
  const last = db.prepare("SELECT MAX(CAST(substr(codigo,5) AS INTEGER)) AS n FROM componentes").get().n || 200;
  const codigo = 'OBS-' + (last + 1);
  const tonos = ['steel', 'copper', 'green', 'violet'];
  db.prepare('INSERT INTO componentes(codigo,nombre,descripcion,patio_id,sector,valor_ref,tono) VALUES (?,?,?,?,?,?,?)')
    .run(codigo, nombre, descripcion || '', patio_id, sector || '', valor_ref, tonos[(last + 1) % 4]);
  audit(req.user.name, req.user.role, 'Ingresó componente al inventario', codigo);
  res.status(201).json({ ok: true, codigo });
});

r.post('/componentes/:id/publicar', auth(...GEST), (req, res) => {
  const c = db.prepare('SELECT * FROM componentes WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Componente no encontrado' });
  if (c.estado !== 'planificado') return res.status(409).json({ error: 'Solo se publican componentes planificados' });
  db.prepare("UPDATE componentes SET estado='publicado', publicado_el=? WHERE id=?").run(hoy(), c.id);
  audit(req.user.name, req.user.role, 'Publicó componente en el portal', c.codigo);
  res.json({ ok: true });
});

r.get('/componentes/:id/ofertas', auth(...GEST), (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, cb.razon_social, cb.due_diligence
    FROM ofertas o JOIN compradores cb ON cb.id=o.comprador_id
    WHERE o.componente_id=? ORDER BY o.monto DESC`).all(req.params.id);
  res.json(rows);
});

r.get('/matriz', auth(...GEST), (_req, res) => {
  res.json(db.prepare('SELECT * FROM matriz_criterios ORDER BY peso DESC').all());
});

r.post('/componentes/:id/adjudicar', auth(...GEST), (req, res) => {
  const { oferta_id, puntaje } = req.body || {};
  const c = db.prepare('SELECT * FROM componentes WHERE id=?').get(req.params.id);
  const o = db.prepare('SELECT * FROM ofertas WHERE id=? AND componente_id=?').get(oferta_id, req.params.id);
  if (!c || !o) return res.status(404).json({ error: 'Componente u oferta no encontrados' });
  if (c.estado !== 'publicado') return res.status(409).json({ error: 'El componente no está publicado' });
  const dd = db.prepare('SELECT due_diligence FROM compradores WHERE id=?').get(o.comprador_id).due_diligence;
  if (dd !== 'aprobada') return res.status(409).json({ error: 'El oferente no tiene la due diligence aprobada' });

  const last = db.prepare("SELECT MAX(CAST(substr(certificado,9) AS INTEGER)) AS n FROM adjudicaciones").get().n || 40;
  const cert = 'CA-2026-' + String(last + 1).padStart(3, '0');
  db.prepare("UPDATE componentes SET estado='adjudicado', adjudicado_a=? WHERE id=?").run(o.comprador_id, c.id);
  db.prepare("UPDATE ofertas SET estado=CASE WHEN id=? THEN 'adjudicada' ELSE 'no_adjudicada' END WHERE componente_id=?")
    .run(o.id, c.id);
  db.prepare('INSERT INTO adjudicaciones(componente_id,oferta_id,certificado,puntaje,fecha) VALUES (?,?,?,?,?)')
    .run(c.id, o.id, cert, puntaje || null, hoy());
  db.prepare('INSERT INTO entregas(componente_id,comprador_id,adjudicado_el) VALUES (?,?,?)').run(c.id, o.comprador_id, hoy());
  audit(req.user.name, req.user.role, `Adjudicó componente (certificado ${cert})`, c.codigo);
  const razon = db.prepare('SELECT razon_social FROM compradores WHERE id=?').get(o.comprador_id).razon_social;
  res.json({ ok: true, certificado: cert, comprador: razon, monto: o.monto, puntaje: puntaje || null });
});

/* ---------- pendientes de entrega ---------- */
r.get('/entregas', auth(...GEST), (_req, res) => {
  const rows = db.prepare(`
    SELECT e.*, c.nombre AS componente, c.codigo, cb.razon_social AS comprador
    FROM entregas e JOIN componentes c ON c.id=e.componente_id
    JOIN compradores cb ON cb.id=e.comprador_id
    WHERE e.estado != 'entregada' ORDER BY e.adjudicado_el`).all()
    .map((e) => ({ ...e, dias_espera: diasDesde(e.adjudicado_el) }));
  res.json(rows);
});

r.post('/entregas/:id/notificar', auth(...GEST), (req, res) => {
  const e = db.prepare('SELECT e.*, c.codigo FROM entregas e JOIN componentes c ON c.id=e.componente_id WHERE e.id=?')
    .get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Entrega no encontrada' });
  audit(req.user.name, req.user.role, 'Notificó al comprador retiro pendiente', e.codigo);
  res.json({ ok: true });
});

r.post('/entregas/:id/agendar', auth(...GEST), (req, res) => {
  const { fecha } = req.body || {};
  if (!fecha) return res.status(400).json({ error: 'Indique la fecha de retiro' });
  const e = db.prepare('SELECT e.*, c.codigo FROM entregas e JOIN componentes c ON c.id=e.componente_id WHERE e.id=?')
    .get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Entrega no encontrada' });
  db.prepare("UPDATE entregas SET estado='agendada', agenda=? WHERE id=?").run(fecha, e.id);
  audit(req.user.name, req.user.role, `Agendó retiro para ${fecha}`, e.codigo);
  res.json({ ok: true });
});

export default r;
