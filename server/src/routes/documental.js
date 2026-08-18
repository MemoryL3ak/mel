import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, audit, hoy, diasDesde } from '../db.js';
import { auth } from '../auth.js';

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

r.get('/documentos', auth(...ROLES_DOC), (req, res) => {
  const rows = db.prepare('SELECT * FROM documentos ORDER BY fecha DESC, id DESC').all()
    .map((d) => ({ ...d, estado: estadoDoc(d) }));
  const tipos = [...new Set(rows.map((d) => d.tipo))];
  res.json({ tipos, rows });
});

r.post('/documentos', auth(...ROLES_DOC), upload.single('archivo'), (req, res) => {
  const { tipo, hito, vencimiento } = req.body || {};
  if (!req.file) return res.status(400).json({ error: 'Adjunte el archivo a cargar' });
  if (!tipo || !hito) return res.status(400).json({ error: 'Tipo documental e hito vinculado son obligatorios' });
  const prev = db.prepare('SELECT MAX(version) AS v FROM documentos WHERE archivo=? AND hito=?')
    .get(req.file.originalname, hito).v || 0;
  db.prepare('INSERT INTO documentos(archivo,tipo,hito,version,vencimiento,ruta,subido_por,fecha) VALUES (?,?,?,?,?,?,?,?)')
    .run(req.file.originalname, tipo, hito, prev + 1, vencimiento || null, req.file.filename, req.user.name, hoy());
  audit(req.user.name, req.user.role, `Cargó documento (v${prev + 1})`, req.file.originalname);
  res.status(201).json({ ok: true, version: prev + 1 });
});

r.get('/documentos/:id/descargar', auth(...ROLES_DOC), (req, res) => {
  const d = db.prepare('SELECT * FROM documentos WHERE id=?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Documento no encontrado' });
  if (!d.ruta) return res.status(404).json({ error: 'Documento de demostración sin archivo físico' });
  res.download(path.join(UP_DIR, d.ruta), d.archivo);
});

export default r;
