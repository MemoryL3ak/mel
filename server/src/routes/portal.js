// Portal público de venta: consulta sin credenciales; ofertar requiere sesión de comprador.
import { Router } from 'express';
import { supa, q, ah, audit, hoy, diasDesde } from '../supa.js';
import { auth } from '../auth.js';

const r = Router();

r.get('/publicaciones', ah(async (_req, res) => {
  await supa.rpc('convertir_vencidos');
  const rows = (await q(
    supa.from('componentes').select('id, codigo, nombre, descripcion, valor_ref, publicado_el, tono')
      .eq('estado', 'publicado').order('publicado_el')
  )).map((c) => ({ ...c, dias_restantes: Math.max(0, 15 - diasDesde(c.publicado_el)) }));
  res.json(rows);
}));

r.post('/compradores', ah(async (req, res) => {
  const { razon_social, rut, email, telefono } = req.body || {};
  if (!razon_social || !rut || !email) return res.status(400).json({ error: 'Razón social, RUT y correo son obligatorios' });
  await q(supa.from('compradores').insert({ razon_social, rut, email, telefono: telefono || null }).select('id'));
  audit(razon_social, 'comprador', 'Solicitó registro de comprador (due diligence en proceso)', rut);
  res.status(201).json({ ok: true, mensaje: 'Solicitud recibida: la cuenta se habilita al aprobar la due diligence.' });
}));

r.post('/ofertas', auth('comprador'), ah(async (req, res) => {
  const { componente_id, monto, plazo_retiro, forma_pago, comentarios } = req.body || {};
  const c = await q(supa.from('componentes').select('*').eq('id', componente_id).eq('estado', 'publicado').maybeSingle());
  if (!c) return res.status(404).json({ error: 'La publicación no está disponible' });
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Indique el monto ofertado' });
  const compradorId = req.user.comprador_id;
  if (!compradorId) return res.status(403).json({ error: 'Su cuenta no está vinculada a un comprador habilitado' });
  await q(supa.from('ofertas').insert({
    componente_id, comprador_id: compradorId, monto,
    plazo_retiro: plazo_retiro || null, forma_pago: forma_pago || null, comentarios: comentarios || null, fecha: hoy(),
  }).select('id'));
  audit(req.user.name, req.user.role, 'Presentó oferta', c.codigo);
  res.status(201).json({ ok: true });
}));

// Estado de las ofertas del comprador autenticado
r.get('/mis-ofertas', auth('comprador'), ah(async (req, res) => {
  const rows = (await q(
    supa.from('ofertas').select('*, componentes(nombre, codigo, estado)')
      .eq('comprador_id', req.user.comprador_id || -1).order('fecha', { ascending: false })
  )).map((o) => ({
    ...o, componente: o.componentes?.nombre, codigo: o.componentes?.codigo,
    estado_componente: o.componentes?.estado, componentes: undefined,
  }));
  res.json(rows);
}));

export default r;
