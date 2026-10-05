// Portal público de venta de obsoletos.
// - Consulta de publicaciones: sin credenciales.
// - Registro: crea una cuenta de comprador (rol 'comprador') que puede entrar
//   de inmediato, aunque su due diligence siga en revisión.
// - Ofertar: exige sesión Y due diligence aprobada. Entrar y ofertar son cosas
//   distintas: lo primero deja ver el catálogo y el estado de la solicitud.
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supa, q, ah, hoy, audit } from '../supa.js';
import { auth } from '../auth.js';
import { tiene } from '../esquema.js';
import { valorDolar } from '../dolar.js';
import { enviarCorreo, plantilla } from '../mail.js';
import { contrato } from '../contrato.js';

const r = Router();
const num = (v) => (v == null ? null : Number(v));
const diasDesde = (fecha) =>
  Math.floor((new Date(hoy() + 'T12:00:00') - new Date(fecha + 'T12:00:00')) / 86400000);
const limpiarRut = (v) => String(v || '').replace(/[.\s]/g, '').toUpperCase().trim();
const usd = (n) => 'US$ ' + Number(n).toLocaleString('en-US');
const clp = (n) => '$ ' + Number(n).toLocaleString('es-CL');
const montoTxt = (monto, moneda) => (moneda === 'CLP' ? clp(monto) : usd(monto));

// Nota que el oferente debe leer antes de ofertar. El porcentaje sale del
// contrato, no de un literal: la pantalla y la comision que se calcula al
// adjudicar no pueden decir cosas distintas.
const notaOferta = (pct) =>
  'Por requerimiento del cliente mandante, se podrá solicitar información contable o legal '
  + 'adicional de su empresa para validar la solvencia de la oferta antes de la adjudicación '
  + 'definitiva del activo. Además, se informa que esta oferta está sujeta a comisión por '
  + `intermediación en venta de ${pct}% más IVA sobre el valor ofertado, como también se `
  + 'informa que los valores ofertados son más IVA. El monto de la comisión debe ser cancelado '
  + 'antes del retiro o despacho de los componentes adjudicados.';

// Avisa al equipo interno que entro una oferta. Solo a quienes tengan correo
// cargado: el usuario interno entra con nombre de usuario, no con direccion.
async function avisarEquipo(asunto, cuerpo) {
  if (!tiene.user_email) return;
  try {
    const equipo = await q(supa.from('users').select('nombre,email')
      .in('role', ['coordinador', 'admin_venta']).eq('activo', true));
    for (const u of equipo) {
      if (!u.email) continue;
      enviarCorreo({ to: u.email, subject: asunto, html: plantilla({ titulo: asunto, cuerpo }) });
    }
  } catch (e) { console.error('[GEA] aviso de oferta al equipo:', e.message); }
}

// Plazo vigente: el original mas lo que se haya ampliado durante la publicacion.
const plazoTotal = (p) => Number(p.plazo_dias) + Number(p.plazo_ampliado_dias ?? 0);

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
  const vivas = pubs.filter((p) => diasDesde(p.publicado_el) < plazoTotal(p));
  if (!vivas.length) return res.json([]);
  const comps = new Map((await q(supa.from('componentes').select('*').in('id', vivas.map((p) => p.componente_id)))).map((c) => [c.id, c]));
  const sitios = new Map((await q(supa.from('sitios').select('id,nombre'))).map((s) => [s.id, s.nombre]));
  res.json(await Promise.all(vivas.map(async (p) => {
    const c = comps.get(p.componente_id);
    return {
      id: p.id, componente: c?.nombre ?? '—', codigo: c?.codigo ?? null,
      especificaciones: c?.especificaciones ?? null, sitio: sitios.get(c?.sitio_id) ?? null,
      oferta_minima: num(p.oferta_minima), dias_restantes: plazoTotal(p) - diasDesde(p.publicado_el),
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
  if (dia >= plazoTotal(p)) return res.status(410).json({ error: 'Esta publicación ya cerró su plazo de ofertas.' });

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
    plazo_dias: plazoTotal(p), dias_restantes: plazoTotal(p) - dia,
    fotos, ficha,
    nota: notaOferta(Number((await contrato()).comision_vendor_pct ?? 0)),
  });
}));

// Registro de comprador: crea la cuenta + el registro con DD pendiente.
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

  // La cuenta nace ACTIVA: antes no podía ni iniciar sesión hasta que alguien
  // revisara su due diligence, así que el comprador se registraba y quedaba
  // mirando una puerta cerrada sin saber en qué iba su solicitud. Entrar y
  // ofertar son cosas distintas: lo segundo sigue exigiendo la DD aprobada,
  // y eso se valida en el endpoint de ofertas.
  const user = await q(supa.from('users').insert({
    username: email, nombre: razon_social, role: 'comprador',
    password_hash: await bcrypt.hash(password, 10), activo: true,
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
  res.json({ ok: true, mensaje: 'Registro recibido. Le avisaremos cuando su due diligence esté aprobada y pueda presentar ofertas. Ya puede iniciar sesión para ver las publicaciones y el estado de su solicitud.' });
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
      monto: num(o.monto), moneda: o.moneda ?? 'USD', monto_usd: num(o.monto_usd),
      plazo_retiro: o.plazo_retiro, forma_pago: o.forma_pago, estado: o.estado,
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
  // El monto se guarda sin decimales, en la moneda en que se ofertó.
  const monto = Math.round(Number(req.body?.monto));
  const publicacion_id = Number(req.body?.publicacion_id);
  const moneda = req.body?.moneda === 'CLP' ? 'CLP' : 'USD';
  if (!publicacion_id) return res.status(400).json({ error: 'Publicación inválida' });
  if (!(monto > 0)) return res.status(400).json({ error: 'Ingrese el monto de su oferta' });

  const p = await q(supa.from('publicaciones').select('*').eq('id', publicacion_id).maybeSingle());
  if (!p || p.estado !== 'activa' || diasDesde(p.publicado_el) >= plazoTotal(p)) {
    return res.status(409).json({ error: 'La publicación ya no está recibiendo ofertas.' });
  }

  // Todo se compara en dólares. La conversión usa el dólar del día de la oferta
  // y se congela junto al tipo de cambio: el puntaje de una oferta no puede
  // moverse después solo porque cambió el dólar.
  let monto_usd = monto;
  let cambio = null;
  if (moneda === 'CLP') {
    const d = tiene.ofertas_moneda ? await valorDolar(hoy()) : null;
    if (!d?.valor) {
      return res.status(503).json({ error: 'No hay tipo de cambio disponible para convertir una oferta en pesos. Ofrezca en dólares o intente más tarde.' });
    }
    cambio = d.valor;
    monto_usd = Math.round((monto / d.valor) * 100) / 100;
  }
  if (p.oferta_minima != null && monto_usd < Number(p.oferta_minima)) {
    return res.status(400).json({ error: `La oferta mínima de esta publicación es ${usd(p.oferta_minima)}.` });
  }

  // Quién presenta la oferta: puede ser una persona natural o una empresa, y no
  // necesariamente coincide con la razón social de la cuenta.
  const tipo = req.body?.solicitante_tipo === 'empresa' ? 'empresa' : 'persona';
  const sol = {
    solicitante_tipo: tipo,
    solicitante_nombre: (req.body?.solicitante_nombre || '').trim(),
    solicitante_rut: limpiarRut(req.body?.solicitante_rut),
    solicitante_telefono: (req.body?.solicitante_telefono || '').trim() || null,
    solicitante_email: (req.body?.solicitante_email || '').trim().toLowerCase() || null,
    empresa_rut: tipo === 'empresa' ? limpiarRut(req.body?.empresa_rut) : null,
    empresa_razon_social: tipo === 'empresa' ? (req.body?.empresa_razon_social || '').trim() : null,
  };
  if (tiene.ofertas_solicitante) {
    if (!sol.solicitante_nombre) return res.status(400).json({ error: 'Indique el nombre del solicitante' });
    if (sol.solicitante_rut.length < 8) return res.status(400).json({ error: 'Ingrese un RUT de solicitante válido' });
    if (!sol.solicitante_telefono) return res.status(400).json({ error: 'Indique un teléfono de contacto' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sol.solicitante_email || '')) {
      return res.status(400).json({ error: 'Ingrese un correo electrónico válido' });
    }
    if (tipo === 'empresa') {
      if (sol.empresa_rut.length < 8) return res.status(400).json({ error: 'Ingrese el RUT de la empresa' });
      if (!sol.empresa_razon_social) return res.status(400).json({ error: 'Indique la razón social de la empresa' });
    }
  }

  await q(supa.from('ofertas').insert({
    publicacion_id, comprador_id: comprador.id, monto,
    plazo_retiro: (req.body?.plazo_retiro || '').trim() || null,
    forma_pago: (req.body?.forma_pago || '').trim() || null,
    comentarios: (req.body?.comentarios || '').trim() || null,
    ...(tiene.ofertas_moneda ? { moneda, monto_usd, dolar: cambio } : {}),
    ...(tiene.ofertas_solicitante ? sol : {}),
  }).select('id').single());
  const enMoneda = montoTxt(monto, moneda);
  const equivalente = moneda === 'CLP' ? ` (${usd(monto_usd)} al dólar de ${cambio})` : '';
  await audit(comprador.razon_social, 'comprador', 'Presentó oferta',
    `publicación ${publicacion_id} · ${enMoneda}${equivalente}`);
  const comp = await q(supa.from('componentes').select('nombre,codigo').eq('id', p.componente_id).maybeSingle());
  const nota = notaOferta(Number((await contrato()).comision_vendor_pct ?? 0));

  // Confirmación al oferente, con la nota que aceptó al ofertar.
  enviarCorreo({
    to: sol.solicitante_email || comprador.email,
    subject: 'Oferta recibida · Venta de obsoletos MEL',
    html: plantilla({
      titulo: 'Su oferta quedó registrada',
      cuerpo: `Registramos su oferta de <b>${enMoneda}</b>${equivalente} por <b>${comp?.nombre ?? 'el componente'}</b>`
        + `${comp?.codigo ? ` (${comp.codigo})` : ''}. Será evaluada junto a las demás según la matriz de adjudicación, `
        + `y le informaremos el resultado.<br><br><b style="font-size:12px">Nota importante:</b> `
        + `<span style="font-size:12px;color:#665C50">${nota}</span>`,
    }),
  });

  // Y aviso al equipo: antes una oferta entraba sin que nadie se enterara hasta
  // que alguien abriera la pantalla por su cuenta.
  const quien = sol.empresa_razon_social || sol.solicitante_nombre || comprador.razon_social;
  await avisarEquipo('Nueva oferta recibida · Venta de obsoletos',
    `<b>${quien}</b> presentó una oferta de <b>${enMoneda}</b>${equivalente} por `
    + `<b>${comp?.nombre ?? 'un componente'}</b>${comp?.codigo ? ` (${comp.codigo})` : ''}. `
    + `Quedan ${plazoTotal(p) - diasDesde(p.publicado_el)} día(s) de plazo.`);

  res.json({ ok: true, mensaje: 'Oferta registrada. Recibirá confirmación por correo.' });
}));

export default r;
