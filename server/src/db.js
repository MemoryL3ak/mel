// GEA — capa de datos. SQLite local (node:sqlite) como espejo del modelo
// productivo PostgreSQL+RLS descrito en la cotización (Sección 8).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'gea.sqlite');

if (process.argv.includes('--reset') && existsSync(DB_PATH)) {
  rmSync(DB_PATH);
  console.log('Base de datos eliminada; se recreará con datos de demostración.');
}
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL, comprador_id INTEGER
);
CREATE TABLE IF NOT EXISTS patios(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categorias(id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, precio_kg INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS programa(
  id INTEGER PRIMARY KEY, semana INTEGER, dia TEXT, fecha TEXT, patio_id INTEGER REFERENCES patios(id),
  material TEXT, est_ton REAL, real_ton REAL, estado TEXT DEFAULT 'programado', empresa TEXT DEFAULT 'Serlim Ltda.'
);
CREATE TABLE IF NOT EXISTS despachos(
  id INTEGER PRIMARY KEY, guia TEXT UNIQUE, fecha TEXT, patio_id INTEGER REFERENCES patios(id),
  categoria_id INTEGER REFERENCES categorias(id), kg_origen REAL, kg_destino REAL,
  fotos INTEGER DEFAULT 2, estado TEXT DEFAULT 'en_transito', ep_id INTEGER
);
CREATE TABLE IF NOT EXISTS estados_pago(
  id INTEGER PRIMARY KEY, folio TEXT UNIQUE, periodo TEXT, bruto INTEGER DEFAULT 0, total INTEGER DEFAULT 0,
  estado TEXT DEFAULT 'en_aprobacion', observacion TEXT, aprobado_por TEXT, fecha_aprobacion TEXT
);
CREATE TABLE IF NOT EXISTS descuentos(id INTEGER PRIMARY KEY, ep_id INTEGER, concepto TEXT, monto INTEGER);
CREATE TABLE IF NOT EXISTS pagos_vendor(id INTEGER PRIMARY KEY, ep_id INTEGER, fecha TEXT, monto INTEGER, comprobante TEXT);
CREATE TABLE IF NOT EXISTS documentos(
  id INTEGER PRIMARY KEY, archivo TEXT, tipo TEXT, hito TEXT, version INTEGER DEFAULT 1,
  vencimiento TEXT, ruta TEXT, subido_por TEXT, fecha TEXT
);
CREATE TABLE IF NOT EXISTS compradores(
  id INTEGER PRIMARY KEY, razon_social TEXT, rut TEXT, email TEXT, telefono TEXT,
  due_diligence TEXT DEFAULT 'en_revision'
);
CREATE TABLE IF NOT EXISTS componentes(
  id INTEGER PRIMARY KEY, codigo TEXT UNIQUE, nombre TEXT, descripcion TEXT,
  patio_id INTEGER REFERENCES patios(id), sector TEXT, valor_ref INTEGER,
  estado TEXT DEFAULT 'planificado', publicado_el TEXT, adjudicado_a INTEGER, tono TEXT DEFAULT 'steel'
);
CREATE TABLE IF NOT EXISTS ofertas(
  id INTEGER PRIMARY KEY, componente_id INTEGER, comprador_id INTEGER, monto INTEGER,
  plazo_retiro TEXT, forma_pago TEXT, comentarios TEXT, fecha TEXT, estado TEXT DEFAULT 'recibida'
);
CREATE TABLE IF NOT EXISTS matriz_criterios(id INTEGER PRIMARY KEY, nombre TEXT, peso INTEGER);
CREATE TABLE IF NOT EXISTS adjudicaciones(
  id INTEGER PRIMARY KEY, componente_id INTEGER, oferta_id INTEGER, certificado TEXT, puntaje REAL, fecha TEXT
);
CREATE TABLE IF NOT EXISTS entregas(
  id INTEGER PRIMARY KEY, componente_id INTEGER, comprador_id INTEGER,
  adjudicado_el TEXT, estado TEXT DEFAULT 'sin_coordinacion', agenda TEXT
);
CREATE TABLE IF NOT EXISTS auditoria(
  id INTEGER PRIMARY KEY, fecha TEXT DEFAULT (datetime('now','localtime')),
  usuario TEXT, rol TEXT, accion TEXT, objeto TEXT
);
CREATE TABLE IF NOT EXISTS historico_mensual(mes TEXT PRIMARY KEY, tonelaje REAL, ing_chatarra REAL, ing_obsoletos REAL);
`);

export function audit(usuario, rol, accion, objeto) {
  db.prepare('INSERT INTO auditoria(usuario,rol,accion,objeto) VALUES (?,?,?,?)').run(usuario, rol, accion, objeto);
}

const iso = (d) => d.toISOString().slice(0, 10);
export const hoy = () => iso(new Date());
export function diasDesde(fecha) {
  return Math.floor((Date.now() - new Date(fecha + 'T00:00:00').getTime()) / 86400000);
}
function hace(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return iso(d);
}

// ---------- seed ----------
const vacio = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
if (vacio) seed();

function seed() {
  const ins = (sql, rows) => {
    const st = db.prepare(sql);
    rows.forEach((r) => st.run(...r));
  };

  ins('INSERT INTO users(username,password,name,role,comprador_id) VALUES (?,?,?,?,?)', [
    ['coordinador', 'demo', 'R. Miranda', 'coordinador', null],
    ['ito', 'demo', 'C. Fuentes', 'ito', null],
    ['limpieza', 'demo', 'Serlim Ltda.', 'limpieza', null],
    ['vendor', 'demo', 'Metarec SpA', 'vendor', null],
    ['adminventa', 'demo', 'P. Salinas', 'adminventa', null],
    ['comprador', 'demo', 'Maestranza Andina Ltda.', 'comprador', 2],
  ]);

  ins('INSERT INTO patios(nombre) VALUES (?)', [
    ['Los Colorados'], ['Patio 3500'], ['Laguna Seca'], ['Puerto Coloso'],
  ]);

  ins('INSERT INTO categorias(nombre,precio_kg) VALUES (?,?)', [
    ['Fierro pesado', 185], ['Fierro liviano / mixto', 120], ['Acero inoxidable', 650],
    ['Cables forrados', 2400], ['Bronce', 4200], ['Aluminio', 1150],
  ]);

  // Programa de limpieza: semana pasada ejecutada + semana actual en curso
  ins('INSERT INTO programa(semana,dia,fecha,patio_id,material,est_ton,real_ton,estado) VALUES (?,?,?,?,?,?,?,?)', [
    [33, 'Lun', hace(8), 1, 'Fierro pesado', 24, 25.2, 'ejecutado'],
    [33, 'Mié', hace(6), 2, 'Fierro liviano / mixto', 15, 14.3, 'ejecutado'],
    [33, 'Vie', hace(4), 3, 'Cables forrados', 5, 5.6, 'ejecutado'],
    [34, 'Lun', hace(1), 1, 'Fierro pesado', 22, 24.6, 'ejecutado'],
    [34, 'Lun', hace(1), 2, 'Fierro liviano / mixto', 14, 13.1, 'ejecutado'],
    [34, 'Mar', hace(0), 3, 'Cables forrados', 6, 6.8, 'ejecutado'],
    [34, 'Mié', null, 4, 'Acero inoxidable', 4, null, 'programado'],
    [34, 'Jue', null, 1, 'Fierro pesado', 26, null, 'programado'],
    [34, 'Vie', null, 2, 'Fierro liviano / mixto', 16, null, 'reprogramado'],
  ]);

  // Despachos de julio (alimentan EP-2026-07) — guías GD-4498..GD-4514
  const julio = [];
  const fp = [29800, 30400, 28900, 29100, 30800, 28400, 31200, 29600, 27900, 28900]; // fierro pesado
  const fl = [30200, 29400, 31000, 29400]; // fierro liviano
  fp.forEach((kg, i) => julio.push([`GD-${4498 + i}`, `2026-07-${String(3 + i * 2).padStart(2, '0')}`, (i % 2) + 1, 1, kg]));
  fl.forEach((kg, i) => julio.push([`GD-${4508 + i}`, `2026-07-${String(5 + i * 5).padStart(2, '0')}`, 2, 2, kg]));
  julio.push(['GD-4512', '2026-07-14', 4, 3, 7100]);   // inox
  julio.push(['GD-4513', '2026-07-21', 3, 4, 2100]);   // cables
  julio.push(['GD-4514', '2026-07-28', 3, 4, 1850]);   // cables
  ins('INSERT INTO despachos(guia,fecha,patio_id,categoria_id,kg_origen,kg_destino,fotos,estado) VALUES (?,?,?,?,?,?,3,?)',
    julio.map(([g, f, p, c, kg]) => [g, f, p, c, kg, Math.round(kg * 0.999), 'recepcionado']));

  // Despachos de agosto (período abierto)
  ins('INSERT INTO despachos(guia,fecha,patio_id,categoria_id,kg_origen,kg_destino,fotos,estado) VALUES (?,?,?,?,?,?,?,?)', [
    ['GD-4526', hace(6), 2, 5, 1240, 1240, 2, 'recepcionado'],
    ['GD-4527', hace(5), 1, 1, 28040, 27410, 2, 'observado'],
    ['GD-4528', hace(4), 4, 3, 3910, 3905, 1, 'recepcionado'],
    ['GD-4529', hace(0), 3, 4, 6790, null, 3, 'en_transito'],
    ['GD-4530', hace(1), 2, 2, 13080, 13075, 2, 'recepcionado'],
    ['GD-4531', hace(1), 1, 1, 24600, 24580, 3, 'recepcionado'],
  ]);

  // Estados de pago: mayo/junio históricos, julio en aprobación (calculado desde sus despachos)
  ins('INSERT INTO estados_pago(folio,periodo,bruto,total,estado,aprobado_por,fecha_aprobacion) VALUES (?,?,?,?,?,?,?)', [
    ['EP-2026-05', '2026-05', 64108900, 64108900, 'aprobado', 'R. Miranda', '2026-06-09'],
    ['EP-2026-06', '2026-06', 74210300, 73320300, 'aprobado', 'R. Miranda', '2026-07-08'],
  ]);
  ins('INSERT INTO descuentos(ep_id,concepto,monto) VALUES (?,?,?)', [
    [2, 'Retiro no programado asumido por vendor', 890000],
  ]);
  ins('INSERT INTO pagos_vendor(ep_id,fecha,monto,comprobante) VALUES (?,?,?,?)', [
    [1, '2026-06-24', 64108900, 'TRF-Metarec-0524.pdf'],
    [2, '2026-07-24', 43992180, 'TRF-Metarec-0612.pdf'],
  ]);

  // EP julio: se genera desde los despachos reales del período
  const epJulio = generarEP('2026-07', { name: 'C. Fuentes', role: 'ito' });
  db.prepare('INSERT INTO descuentos(ep_id,concepto,monto) VALUES (?,?,?)')
    .run(epJulio.id, 'Flete asumido por MEL (GD-4498)', 1250000);
  recalcularEP(epJulio.id);

  // Compradores
  ins('INSERT INTO compradores(razon_social,rut,email,telefono,due_diligence) VALUES (?,?,?,?,?)', [
    ['Ingemet SpA', '76.412.880-1', 'contacto@ingemet.cl', '+56 55 249 1100', 'aprobada'],
    ['Maestranza Andina Ltda.', '77.902.334-5', 'ventas@mandina.cl', '+56 55 283 7420', 'aprobada'],
    ['Comercial Recimet', '76.118.442-K', 'ofertas@recimet.cl', '+56 2 2896 5510', 'en_revision'],
  ]);

  // Componentes obsoletos
  ins('INSERT INTO componentes(codigo,nombre,descripcion,patio_id,sector,valor_ref,estado,publicado_el,tono) VALUES (?,?,?,?,?,?,?,?,?)', [
    ['OBS-188', 'Repuestos chancador de pebbles', 'Lote de repuestos mayores, revestimientos y pernería', 2, 'Sector A-3', 7250000, 'adjudicado', hace(20), 'violet'],
    ['OBS-190', 'Impulsor celda de flotación', 'Impulsor 300 m³ con desgaste de álabes', 1, 'Sector B-3', 4100000, 'publicado', hace(16), 'green'],
    ['OBS-195', 'Reductor Falk 385', 'Reductor de velocidad, razón 25:1, carcasa completa', 3, 'Sector C-2', 9800000, 'adjudicado', hace(12), 'copper'],
    ['OBS-198', 'Tolva CAEX Komatsu 930E', 'Capacidad 290 t, estructura completa, retiro en faena', 2, 'Sector A-1', 45000000, 'publicado', hace(14), 'copper'],
    ['OBS-201', 'Motor eléctrico 4.000 HP', 'WEG, 3.300 V, 50 Hz, usado, operativo al retiro de servicio', 1, 'Sector B-3 · Fila 2', 28500000, 'publicado', hace(6), 'steel'],
    ['OBS-203', 'Polines de correa (lote 120 u)', 'Ø 152 mm, correa transportadora overland, estado mixto', 1, 'Sector B-1', 6400000, 'publicado', hace(9), 'violet'],
    ['OBS-204', 'Neumáticos 63" usados (lote ×4)', 'Bridgestone 59/80R63, 40–55% de vida remanente', 2, 'Sector D-4', 12000000, 'publicado', hace(2), 'green'],
    ['OBS-207', 'Transformador 23 kV', 'Transformador de poder seco, 23 kV / 4,16 kV', 3, 'Bodega 7', 18900000, 'planificado', null, 'steel'],
  ]);
  db.prepare("UPDATE componentes SET adjudicado_a=2 WHERE codigo='OBS-188'").run();
  db.prepare("UPDATE componentes SET adjudicado_a=1 WHERE codigo='OBS-195'").run();

  // Ofertas
  ins('INSERT INTO ofertas(componente_id,comprador_id,monto,plazo_retiro,forma_pago,fecha,estado) VALUES (?,?,?,?,?,?,?)', [
    [5, 1, 33500000, '10 días hábiles', 'Transferencia 100%', hace(0), 'recibida'],
    [5, 2, 31200000, '5 días hábiles', 'Transferencia 100%', hace(2), 'recibida'],
    [5, 3, 29000000, '15 días hábiles', '50% + 50% a 30 días', hace(3), 'recibida'],
    [4, 2, 41000000, '10 días hábiles', 'Transferencia 100%', hace(4), 'recibida'],
    [6, 1, 5900000, '5 días hábiles', 'Transferencia 100%', hace(5), 'recibida'],
    [6, 2, 6100000, '10 días hábiles', 'Transferencia 100%', hace(3), 'recibida'],
    [6, 3, 5400000, '15 días hábiles', 'Transferencia 100%', hace(1), 'recibida'],
    [3, 1, 10200000, '10 días hábiles', 'Transferencia 100%', hace(8), 'adjudicada'],
    [1, 2, 7600000, '5 días hábiles', 'Transferencia 100%', hace(16), 'adjudicada'],
  ]);

  ins('INSERT INTO matriz_criterios(nombre,peso) VALUES (?,?)', [
    ['Precio ofertado', 50], ['Plazo de retiro', 20], ['Experiencia y due diligence', 20], ['Forma de pago', 10],
  ]);

  ins('INSERT INTO adjudicaciones(componente_id,oferta_id,certificado,puntaje,fecha) VALUES (?,?,?,?,?)', [
    [3, 8, 'CA-2026-045', 9.1, hace(6)],
    [1, 9, 'CA-2026-044', 8.7, hace(14)],
  ]);
  ins('INSERT INTO entregas(componente_id,comprador_id,adjudicado_el,estado,agenda) VALUES (?,?,?,?,?)', [
    [1, 2, hace(14), 'sin_coordinacion', null],
    [3, 1, hace(6), 'agendada', hace(-3)],
  ]);

  // Repositorio documental (metadatos de demostración; las cargas nuevas guardan archivo real)
  ins('INSERT INTO documentos(archivo,tipo,hito,version,vencimiento,subido_por,fecha) VALUES (?,?,?,?,?,?,?)', [
    ['CTR-MEL-2025-114.pdf', 'Contrato con vendor', 'Contrato Metarec SpA', 3, '2026-12-31', 'R. Miranda', '2025-12-20'],
    ['CTR-MEL-2025-089.pdf', 'Contrato limpieza patios', 'Contrato Serlim Ltda.', 2, '2027-06-30', 'R. Miranda', '2025-11-02'],
    ['GD-4531.pdf', 'Guía de despacho', 'Despacho GD-4531', 1, null, 'Serlim Ltda.', hace(1)],
    ['GV-2214.pdf', 'Guía de venta', 'Despacho GD-4529', 1, null, 'Metarec SpA', hace(0)],
    ['EP-2026-07.pdf', 'Estado de pago', 'EP julio 2026', 2, null, 'C. Fuentes', hace(2)],
    ['DESC-2026-07.xlsx', 'Registro de descuentos', 'EP julio 2026', 1, null, 'C. Fuentes', hace(2)],
    ['FV-7781.pdf', 'Factura de venta', 'EP junio 2026', 1, null, 'Metarec SpA', '2026-07-12'],
    ['TRF-Metarec-0612.pdf', 'Registro de pago vendor', 'EP junio 2026', 1, null, 'Metarec SpA', '2026-07-24'],
    ['CDF-118.pdf', 'Certif. disposición final', 'Despachos julio', 1, hace(-12), 'Metarec SpA', '2026-07-30'],
    ['SCRAP-2026-031.pdf', 'Baja del activo (scrap)', 'Impulsor celda flotación', 1, null, 'R. Miranda', hace(3)],
  ]);

  // Serie mensual 2026 (para paneles; el mes en curso se calcula en vivo)
  ins('INSERT INTO historico_mensual(mes,tonelaje,ing_chatarra,ing_obsoletos) VALUES (?,?,?,?)', [
    ['2026-01', 358, 58, 12], ['2026-02', 402, 66, 0], ['2026-03', 371, 61, 45],
    ['2026-04', 415, 71, 28], ['2026-05', 389, 64, 95], ['2026-06', 428, 74, 31],
    ['2026-07', 441, 83, 120],
  ]);

  // Bitácora inicial
  const eventos = [
    ['P. Salinas', 'adminventa', 'Publicó componente', 'OBS-201'],
    ['Serlim Ltda.', 'limpieza', 'Registró retiro con evidencia', 'GD-4531'],
    ['C. Fuentes', 'ito', 'Envió EP a aprobación', 'EP-2026-07'],
    ['Ingemet SpA', 'comprador', 'Presentó oferta', 'OBS-201'],
    ['C. Fuentes', 'ito', 'Validó recepción', 'GD-4531'],
  ];
  eventos.forEach((e) => audit(...e));

  console.log('Base de datos creada con datos de demostración en', DB_PATH);
}

// ---------- lógica de estados de pago ----------
export function generarEP(periodo, user) {
  const pend = db.prepare(
    "SELECT d.*, c.precio_kg FROM despachos d JOIN categorias c ON c.id=d.categoria_id " +
    "WHERE d.ep_id IS NULL AND d.estado IN ('recepcionado','observado') AND substr(d.fecha,1,7)=?"
  ).all(periodo);
  if (!pend.length) return null;
  const folio = 'EP-' + periodo.replace('-', '-');
  const bruto = Math.round(pend.reduce((s, d) => s + d.kg_destino * d.precio_kg, 0));
  db.prepare('INSERT INTO estados_pago(folio,periodo,bruto,total,estado) VALUES (?,?,?,?,?)')
    .run(folio, periodo, bruto, bruto, 'en_aprobacion');
  const ep = db.prepare('SELECT * FROM estados_pago WHERE folio=?').get(folio);
  const upd = db.prepare('UPDATE despachos SET ep_id=? WHERE id=?');
  pend.forEach((d) => upd.run(ep.id, d.id));
  if (user) audit(user.name, user.role, 'Generó estado de pago', folio);
  return ep;
}

export function recalcularEP(epId) {
  const desc = db.prepare('SELECT COALESCE(SUM(monto),0) AS s FROM descuentos WHERE ep_id=?').get(epId).s;
  const ep = db.prepare('SELECT bruto FROM estados_pago WHERE id=?').get(epId);
  db.prepare('UPDATE estados_pago SET total=? WHERE id=?').run(ep.bruto - desc, epId);
}

// ---------- regla crítica: conversión automática a chatarra (>15 días) ----------
export function convertirVencidos() {
  const vencidos = db.prepare("SELECT * FROM componentes WHERE estado='publicado'").all()
    .filter((c) => diasDesde(c.publicado_el) > 15);
  vencidos.forEach((c) => {
    db.prepare("UPDATE componentes SET estado='convertido' WHERE id=?").run(c.id);
    db.prepare('INSERT INTO documentos(archivo,tipo,hito,version,subido_por,fecha) VALUES (?,?,?,1,?,?)')
      .run(`SCRAP-${c.codigo}.pdf`, 'Baja del activo (scrap)', `Conversión ${c.nombre}`, 'Sistema', hoy());
    audit('Sistema', '—', 'Conversión automática a chatarra (>15 días publicado)', c.codigo);
  });
  return vencidos.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log('Listo.');
}
