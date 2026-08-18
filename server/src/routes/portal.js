// Portal público de venta: consulta sin credenciales; ofertar requiere sesión de comprador.
import { Router } from 'express';
import { db, audit, hoy, diasDesde, convertirVencidos } from '../db.js';
import { auth } from '../auth.js';

const r = Router();

r.get('/publicaciones', (_req, res) => {
  convertirVencidos();
  const rows = db.prepare(`
    SELECT c.id, c.codigo, c.nombre, c.descripcion, c.valor_ref, c.publicado_el, c.tono
    FROM componentes c WHERE c.estado='publicado' ORDER BY c.publicado_el`).all()
    .map((c) => ({ ...c, dias_restantes: Math.max(0, 15 - diasDesde(c.publicado_el)) }));
  res.json(rows);
});

r.post('/compradores', (req, res) => {
  const { razon_social, rut, email, telefono } = req.body || {};
  if (!razon_social || !rut || !email) return res.status(400).json({ error: 'Razón social, RUT y correo son obligatorios' });
  db.prepare('INSERT INTO compradores(razon_social,rut,email,telefono) VALUES (?,?,?,?)')
    .run(razon_social, rut, email, telefono || null);
  audit(razon_social, 'comprador', 'Solicitó registro de comprador (due diligence en proceso)', rut);
  res.status(201).json({ ok: true, mensaje: 'Solicitud recibida: la cuenta se habilita al aprobar la due diligence.' });
});

r.post('/ofertas', auth('comprador'), (req, res) => {
  const { componente_id, monto, plazo_retiro, forma_pago, comentarios } = req.body || {};
  const c = db.prepare("SELECT * FROM componentes WHERE id=? AND estado='publicado'").get(componente_id);
  if (!c) return res.status(404).json({ error: 'La publicación no está disponible' });
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Indique el monto ofertado' });
  const compradorId = req.user.comprador_id;
  if (!compradorId) return res.status(403).json({ error: 'Su cuenta no está vinculada a un comprador habilitado' });
  db.prepare('INSERT INTO ofertas(componente_id,comprador_id,monto,plazo_retiro,forma_pago,comentarios,fecha) VALUES (?,?,?,?,?,?,?)')
    .run(componente_id, compradorId, monto, plazo_retiro || null, forma_pago || null, comentarios || null, hoy());
  audit(req.user.name, req.user.role, 'Presentó oferta', c.codigo);
  res.status(201).json({ ok: true });
});

// Estado de las ofertas del comprador autenticado
r.get('/mis-ofertas', auth('comprador'), (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, c.nombre AS componente, c.codigo, c.estado AS estado_componente
    FROM ofertas o JOIN componentes c ON c.id=o.componente_id
    WHERE o.comprador_id=? ORDER BY o.fecha DESC`).all(req.user.comprador_id || -1);
  res.json(rows);
});

export default r;
