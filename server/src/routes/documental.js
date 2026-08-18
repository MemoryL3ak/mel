import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supa, q, ah, audit, hoy, diasDesde } from '../supa.js';
import { auth } from '../auth.js';

// Prototipo: los archivos quedan en disco local; en producción van a Supabase Storage.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UP_DIR = path.join(__dirname, '..', '..', 'uploads');
mkdirSync(UP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UP_DIR,
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\-]/g, '_')),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const r = Router();
const ROLES_DOC = ['limpieza', 'vendor', 'ito', 'coordinador', 'adminventa'];

// Estado derivado del vencimiento: vigente / por vencer (<30 días) / vencido
function estadoDoc(d) {
  if (!d.vencimiento) return 'vigente';
  const dias = -diasDesde(d.vencimiento);
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'por_vencer';
  return 'vigente';
}

r.get('/documentos', auth(...ROLES_DOC), ah(async (_req, res) => {
  const rows = (await q(
    supa.from('documentos').select('*').order('fecha', { ascending: false }).order('id', { ascending: false })
  )).map((d) => ({ ...d, estado: estadoDoc(d) }));
  res.json({ tipos: [...new Set(rows.map((d) => d.tipo))], rows });
}));

r.post('/documentos', auth(...ROLES_DOC), upload.single('archivo'), ah(async (req, res) => {
  const { tipo, hito, vencimiento } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'Adjunte el archivo a cargar' });
  if (!tipo || !hito) return res.status(400).json({ error: 'Tipo documental e hito vinculado son obligatorios' });
  const prev = await q(
    supa.from('documentos').select('version').eq('archivo', req.file.originalname).eq('hito', hito)
      .order('version', { ascending: false }).limit(1)
  );
  const version = (prev[0]?.version || 0) + 1;
  await q(supa.from('documentos').insert({
    archivo: req.file.originalname, tipo, hito, version,
    vencimiento: vencimiento || null, ruta: req.file.filename, subido_por: req.user.name, fecha: hoy(),
  }).select('id'));
  audit(req.user.name, req.user.role, `Cargó documento (v${version})`, req.file.originalname);
  res.status(201).json({ ok: true, version });
}));

r.get('/documentos/:id/descargar', auth(...ROLES_DOC), ah(async (req, res) => {
  const d = await q(supa.from('documentos').select('*').eq('id', req.params.id).maybeSingle());
  if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
  if (!d.ruta) return res.status(404).json({ error: 'Documento de demostración sin archivo físico' });
  res.download(path.join(UP_DIR, d.ruta), d.archivo);
}));

export default r;
