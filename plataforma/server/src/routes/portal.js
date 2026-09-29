// Portal público de venta de obsoletos.
// - Consulta de publicaciones: sin credenciales.
// - Registro: crea una cuenta de comprador (rol 'comprador', inactiva) que se
//   habilita cuando el administrador aprueba la due diligence.
// - Ofertar: requiere iniciar sesión (cuenta habilitada). El comprador entra
//   con su correo y contraseña por el mismo /auth/login.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supa, q, ah, hoy, audit } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { enviarCorreo, plantilla } from '../mail.js';

const r = Router();
const num = (v) => (v == null ? null : Number(v));
const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);
const limpiarRut = (v) => String(v || '').replace(/[.\s]/g, '').toUpperCase().trim();
const usd = (n) => 'US$ ' + Number(n).toLocaleString('en-US');

// El nombre en el bucket es un timestamp (ficha-1790628116137.pdf), inútil para
// el comprador: se le muestra el tipo de documento en su lugar.
const TIPO_FICHA = {
  pdf: 'Documento PDF', xls: 'Planilla Excel', xlsx: 'Planilla Excel', csv: 'Planilla CSV',
  png: 'Imagen', jpg: 'Imagen', jpeg: 'Imagen', webp: 'Imagen',
};

// Adjuntos del componente con URL firmada (1 h): las fotos de la galería y la
// ficha técnica. El nombre en el bucket distingue foto-… de ficha-….
async function adjuntosDe(componenteId) {
  try {
    const carpeta = `OBS/${componenteId}`;
    const { data: lista } = await supa.storage.from('evidencia').list(carpeta);
    if (!lista?.length) return { fotos: [], ficha: null };
    const { data: firmadas } = await supa.storage.from('evidencia')
      .createSignedUrls(lista.map((f) => `${carpeta}/${f.name}`), 3600);
    const fotos = [];
    let ficha = null;
    (firmadas ?? []).forEach((f, i) => {
      if (!f.signedUrl) return;
      const nombre = lista[i].name;
      if (nombre.startsWith('ficha-')) {
        const ext = (nombre.split('.').pop() || '').toLowerCase();
        ficha ??= { url: f.signedUrl, tipo: TIPO_FICHA[ext] ?? 'Documento' };
      } else if (nombre.startsWith('foto-')) fotos.push(f.signedUrl);
    });
    return { fotos, ficha };
  } catch { return { fotos: [], ficha: null }; }
}

// La portada es la primera foto; la ficha técnica nunca hace de portada.
const fotoPortada = async (id) => (await adjuntosDe(id)).fotos[0] ?? null;

// Publicaciones vigentes: acceso público, solo lectura.
r.get('/portal/publicaciones', ah(async (_req, res) => {
  if (!tiene.obsoletos) return res.json([]);
  const pubs = await q(supa.from('publicaciones').select('*').eq('estado', 'activa').order('publicado_el'));
  const vivas = pubs.filter((p) => diasDesde(p.publicado_el) < p.plazo_dias);
  if (!vivas.length) return res.json([]);
  const comps = new Map((await q(supa.from('componentes').select('*').in('id', vivas.map((p) => p.componente_id)))).map((c) => [c.id, c]));
  const sitios = new Map((await q(supa.from('sitios').select('id,nombre'))).map((s) => [s.id, s.nombre]));
  res.json(await Promise.all(vivas.map(async (p) => {
    const c = comps.get(p.componente_id);
    return {
      id: p.id, componente: c?.nombre ?? '—', codigo: c?.codigo ?? null,
      especificaciones: c?.especificaciones ?? null, sitio: sitios.get(c?.sitio_id) ?? null,
      oferta_minima: num(p.oferta_minima), dias_restantes: p.plazo_dias - diasDesde(p.publicado_el),
      foto: c?.fotos > 0 ? await fotoPortada(c.id) : null,
    };
  })));
}));

// Detalle público de una publicación vigente: galería, ficha técnica y datos
// del componente. La selección es explícita para no filtrar `valor_referencial`,
// que es el valor interno de MEL y no debe verlo un comprador.
r.get('/portal/publicaciones/:id', ah(async (req, res) => {
  if (!tiene.obsoletos) return res.status(404).json({ error: 'Publicación no encontrada' });
  // Endpoint público: un id basura llega por cualquier crawler y no debe
  // convertirse en un 500 al consultarlo contra la base.
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'Publicación no encontrada' });
  const p = await q(supa.from('publicaciones').select('*').eq('id', id).maybeSingle());
  if (!p || p.estado !== 'activa') return res.status(404).json({ error: 'Publicación no encontrada' });
  const dia = diasDesde(p.publicado_el);
  if (dia >= p.plazo_dias) return res.status(410).json({ error: 'Esta publicación ya cerró su plazo de ofertas.' });

  const c = await q(supa.from('componentes')
    .select('id,codigo,nombre,especificaciones,sitio_id,ubicacion,fotos')
    .eq('id', p.componente_id).maybeSingle());
  const sitio = c?.sitio_id
    ? await q(supa.from('sitios').select('nombre').eq('id', c.sitio_id).maybeSingle())
    : null;
  const { fotos, ficha } = c?.fotos > 0 ? await adjuntosDe(c.id) : { fotos: [], ficha: null };

  res.json({
    id: p.id, componente: c?.nombre ?? '—', codigo: c?.codigo ?? null,
    especificaciones: c?.especificaciones ?? null,
    sitio: sitio?.nombre ?? null, ubicacion: c?.ubicacion ?? null,
    oferta_minima: num(p.oferta_minima), publicado_el: p.publicado_el,
    plazo_dias: p.plazo_dias, dias_restantes: p.plazo_dias - dia,
    fotos, ficha,
  });
}));

// Registro de comprador: crea la cuenta (inactiva) + el registro con DD pendiente.
r.post('/portal/registro', ah(async (req, res) => {
  if (!tiene.obsoletos) return res.status(503).json({ error: 'El portal aún no está disponible' });
  const razon_social = (req.body?.razon_social || '').trim();
  const rut = limpiarRut(req.body?.rut);
  const email = (req.body?.email || '').trim().toLowerCase();
  const telefono = (req.body?.telefono || '').trim() || null;
  const password = String(req.body?.password || '');
  if (!razon_social) return res.status(400).json({ error: 'La razón social es obligatoria' });
  if (rut.length < 8) return res.status(400).json({ error: 'Ingrese un RUT válido' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Ingrese un correo de contacto válido' });
  if (password.length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

  const porRut = await q(supa.from('compradores').select('id,dd_estado').ilike('rut', rut));
  if (porRut.length) {
    return res.status(409).json({
      error: porRut[0].dd_estado === 'aprobada'
        ? 'Este RUT ya está registrado y habilitado para ofertar.'
        : 'Este RUT ya tiene un registro en curso; su due diligence está en revisión.',
    });
  }
  const porEmail = await q(supa.from('users').select('id').eq('username', email));
  if (porEmail.length) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });

  // Cuenta inactiva: no puede iniciar sesión hasta que se apruebe la DD.
  const user = await q(supa.from('users').insert({
    username: email, nombre: razon_social, role: 'comprador',
    password_hash: await bcrypt.hash(password, 10), activo: false,
  }).select('id').single());
  await q(supa.from('compradores').insert({ user_id: user.id, razon_social, rut, email, telefono }).select('id').single());

  await audit(razon_social, 'comprador', 'Se registró en el portal', rut);
  enviarCorreo({
    to: email, subject: 'Registro recibido · Venta de obsoletos MEL',
    html: plantilla({
      titulo: 'Recibimos su registro',
      cuerpo: `Gracias por registrar a <b>${razon_social}</b>. Su solicitud pasará por verificación y due diligence. Le avisaremos por este medio cuando su cuenta quede habilitada para presentar ofertas.`,
    }),
  });
  res.json({ ok: true, mensaje: 'Registro recibido. Le avisaremos cuando su due diligence esté aprobada y pueda iniciar sesión para ofertar.' });
}));

// Datos de la cuenta del comprador autenticado (para saber si puede ofertar).
r.get('/portal/mi-cuenta', auth('comprador'), ah(async (req, res) => {
  const c = await q(supa.from('compradores').select('*').eq('user_id', req.user.sub).maybeSingle());
  if (!c) return res.status(404).json({ error: 'Cuenta de comprador no encontrada' });
  res.json({ razon_social: c.razon_social, rut: c.rut, email: c.email, dd_estado: c.dd_estado });
}));

// Ofertas del comprador autenticado.
r.get('/portal/mis-ofertas', auth('comprador'), ah(async (req, res) => {
  const c = await q(supa.from('compradores').select('id').eq('user_id', req.user.sub).maybeSingle());
  if (!c) return res.json([]);
  const ofertas = await q(supa.from('ofertas').select('*').eq('comprador_id', c.id).order('id', { ascending: false }));
  if (!ofertas.length) return res.json([]);
  const pubs = new Map((await q(supa.from('publicaciones').select('id,componente_id,estado'))).map((p) => [p.id, p]));
  const comps = new Map((await q(supa.from('componentes').select('id,nombre,codigo'))).map((x) => [x.id, x]));
  res.json(ofertas.map((o) => {
    const comp = comps.get(pubs.get(o.publicacion_id)?.componente_id);
    return {
      id: o.id, componente: comp?.nombre ?? '—', codigo: comp?.codigo ?? null,
      monto: num(o.monto), plazo_retiro: o.plazo_retiro, forma_pago: o.forma_pago, estado: o.estado,
    };
  }));
}));

// Presentación de oferta: exige cuenta de comprador habilitada (DD aprobada).
r.post('/portal/ofertas', auth('comprador'), ah(async (req, res) => {
  if (!tiene.obsoletos) return res.status(503).json({ error: 'El portal aún no está disponible' });
  const comprador = await q(supa.from('compradores').select('*').eq('user_id', req.user.sub).maybeSingle());
  if (!comprador) return res.status(404).json({ error: 'Cuenta de comprador no encontrada' });
  if (comprador.dd_estado !== 'aprobada') {
    return res.status(403).json({ error: 'Su due diligence aún no está aprobada; no puede ofertar todavía.' });
  }
  // La columna es numeric(14,0): dólares enteros, sin centavos. Se redondea acá
  // y no en el cliente, para que el monto guardado no dependa de que el
  // navegador haya mandado bien la cifra.
  const monto = Math.round(Number(req.body?.monto));
  const publicacion_id = Number(req.body?.publicacion_id);
  if (!publicacion_id) return res.status(400).json({ error: 'Publicación inválida' });
  if (!(monto > 0)) return res.status(400).json({ error: 'Ingrese el monto de su oferta' });

  const p = await q(supa.from('publicaciones').select('*').eq('id', publicacion_id).maybeSingle());
  if (!p || p.estado !== 'activa' || diasDesde(p.publicado_el) >= p.plazo_dias) {
    return res.status(409).json({ error: 'La publicación ya no está recibiendo ofertas.' });
  }
  if (p.oferta_minima != null && monto < Number(p.oferta_minima)) {
    return res.status(400).json({ error: `La oferta mínima de esta publicación es ${usd(p.oferta_minima)}.` });
  }

  await q(supa.from('ofertas').insert({
    publicacion_id, comprador_id: comprador.id, monto,
    plazo_retiro: (req.body?.plazo_retiro || '').trim() || null,
    forma_pago: (req.body?.forma_pago || '').trim() || null,
    comentarios: (req.body?.comentarios || '').trim() || null,
  }).select('id').single());
  await audit(comprador.razon_social, 'comprador', 'Presentó oferta', `publicación ${publicacion_id} · ${usd(monto)}`);
  const comp = await q(supa.from('componentes').select('nombre').eq('id', p.componente_id).maybeSingle());
  enviarCorreo({
    to: comprador.email, subject: 'Oferta recibida · Venta de obsoletos MEL',
    html: plantilla({
      titulo: 'Su oferta quedó registrada',
      cuerpo: `Registramos su oferta de <b>${usd(monto)}</b> por <b>${comp?.nombre ?? 'el componente'}</b>. Será evaluada junto a las demás según la matriz de adjudicación. Le informaremos el resultado.`,
    }),
  });
  res.json({ ok: true, mensaje: 'Oferta registrada. Recibirá confirmación por correo.' });
}));

export default r;
