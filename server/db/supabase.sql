-- ============================================================================
-- GEA · Gestión de Enajenación de Activos — esquema PostgreSQL para Supabase
-- Equivalente productivo del modelo SQLite del prototipo (server/src/db.js).
-- Ejecutar completo en el SQL Editor de Supabase. Es re-ejecutable: borra y
-- recrea las tablas del esquema public con datos de demostración.
-- ============================================================================

-- ---------- limpieza (permite re-ejecutar el script) ----------
drop function if exists convertir_vencidos();
drop table if exists auditoria, historico_mensual, entregas, adjudicaciones,
  matriz_criterios, ofertas, componentes, compradores, documentos,
  pagos_vendor, descuentos, estados_pago, despachos, programa,
  categorias, patios, users cascade;

-- ============================================================================
-- 1. ESQUEMA
-- ============================================================================

create table users (
  id            bigint generated always as identity primary key,
  username      text unique not null,
  password      text not null,          -- demo; en producción: Supabase Auth (auth.users) + tabla profiles
  name          text not null,
  role          text not null check (role in ('coordinador','ito','limpieza','vendor','adminventa','comprador')),
  comprador_id  bigint
);

create table patios (
  id     bigint generated always as identity primary key,
  nombre text not null
);

create table categorias (
  id        bigint generated always as identity primary key,
  nombre    text not null,
  precio_kg integer not null            -- CLP por kg, según contrato vigente
);

create table programa (
  id       bigint generated always as identity primary key,
  semana   integer not null,
  dia      text,
  fecha    date,
  patio_id bigint references patios(id),
  material text,
  est_ton  numeric(8,1),
  real_ton numeric(8,1),
  estado   text not null default 'programado' check (estado in ('programado','ejecutado','reprogramado')),
  empresa  text not null default 'Serlim Ltda.'
);

create table despachos (
  id           bigint generated always as identity primary key,
  guia         text unique not null,
  fecha        date not null,
  patio_id     bigint references patios(id),
  categoria_id bigint references categorias(id),
  kg_origen    numeric(10,1) not null,
  kg_destino   numeric(10,1),
  fotos        integer not null default 2,
  estado       text not null default 'en_transito' check (estado in ('en_transito','recepcionado','observado')),
  ep_id        bigint
);
create index despachos_fecha_idx on despachos(fecha);
create index despachos_ep_idx on despachos(ep_id);

create table estados_pago (
  id               bigint generated always as identity primary key,
  folio            text unique not null,
  periodo          text not null,       -- 'YYYY-MM'
  bruto            bigint not null default 0,
  total            bigint not null default 0,
  estado           text not null default 'en_aprobacion' check (estado in ('en_aprobacion','aprobado','rechazado')),
  observacion      text,
  aprobado_por     text,
  fecha_aprobacion date
);
alter table despachos add constraint despachos_ep_fk foreign key (ep_id) references estados_pago(id);

create table descuentos (
  id       bigint generated always as identity primary key,
  ep_id    bigint not null references estados_pago(id),
  concepto text not null,
  monto    bigint not null
);

create table pagos_vendor (
  id          bigint generated always as identity primary key,
  ep_id       bigint not null references estados_pago(id),
  fecha       date not null,
  monto       bigint not null,
  comprobante text
);

create table documentos (
  id          bigint generated always as identity primary key,
  archivo     text not null,
  tipo        text not null,
  hito        text not null,
  version     integer not null default 1,
  vencimiento date,
  ruta        text,                     -- en producción: ruta en Supabase Storage
  subido_por  text,
  fecha       date
);
create index documentos_tipo_idx on documentos(tipo);

create table compradores (
  id            bigint generated always as identity primary key,
  razon_social  text not null,
  rut           text,
  email         text,
  telefono      text,
  due_diligence text not null default 'en_revision' check (due_diligence in ('en_revision','aprobada','rechazada'))
);

create table componentes (
  id           bigint generated always as identity primary key,
  codigo       text unique not null,
  nombre       text not null,
  descripcion  text,
  patio_id     bigint references patios(id),
  sector       text,
  valor_ref    bigint not null,
  estado       text not null default 'planificado' check (estado in ('planificado','publicado','adjudicado','convertido')),
  publicado_el date,
  adjudicado_a bigint references compradores(id),
  tono         text not null default 'steel'
);

create table ofertas (
  id            bigint generated always as identity primary key,
  componente_id bigint not null references componentes(id),
  comprador_id  bigint not null references compradores(id),
  monto         bigint not null,
  plazo_retiro  text,
  forma_pago    text,
  comentarios   text,
  fecha         date not null default current_date,
  estado        text not null default 'recibida' check (estado in ('recibida','adjudicada','no_adjudicada'))
);
create index ofertas_componente_idx on ofertas(componente_id);

create table matriz_criterios (
  id     bigint generated always as identity primary key,
  nombre text not null,
  peso   integer not null               -- porcentaje; la suma debe ser 100
);

create table adjudicaciones (
  id            bigint generated always as identity primary key,
  componente_id bigint not null references componentes(id),
  oferta_id     bigint not null references ofertas(id),
  certificado   text unique not null,
  puntaje       numeric(4,2),
  fecha         date not null default current_date
);

create table entregas (
  id            bigint generated always as identity primary key,
  componente_id bigint not null references componentes(id),
  comprador_id  bigint not null references compradores(id),
  adjudicado_el date not null,
  estado        text not null default 'sin_coordinacion' check (estado in ('sin_coordinacion','agendada','entregada')),
  agenda        date
);

create table auditoria (
  id      bigint generated always as identity primary key,
  fecha   timestamptz not null default now(),
  usuario text,
  rol     text,
  accion  text not null,
  objeto  text
);

create table historico_mensual (
  mes           text primary key,       -- 'YYYY-MM'
  tonelaje      numeric(8,1),
  ing_chatarra  numeric(8,1),           -- millones CLP
  ing_obsoletos numeric(8,1)
);

-- ============================================================================
-- 2. REGLA CRÍTICA: conversión automática a chatarra (>15 días publicado)
--    Programable con pg_cron (extensión disponible en Supabase):
--    select cron.schedule('gea-convertir-vencidos', '0 * * * *', $$select convertir_vencidos()$$);
-- ============================================================================

create or replace function convertir_vencidos() returns integer
language plpgsql as $$
declare
  v record;
  n integer := 0;
begin
  for v in
    update componentes
       set estado = 'convertido'
     where estado = 'publicado'
       and publicado_el < current_date - 15
    returning id, codigo, nombre
  loop
    insert into documentos(archivo, tipo, hito, version, subido_por, fecha)
    values ('SCRAP-' || v.codigo || '.pdf', 'Baja del activo (scrap)', 'Conversión ' || v.nombre, 1, 'Sistema', current_date);
    insert into auditoria(usuario, rol, accion, objeto)
    values ('Sistema', '—', 'Conversión automática a chatarra (>15 días publicado)', v.codigo);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ============================================================================
-- 3. DATOS DE DEMOSTRACIÓN
--    Fechas relativas a current_date para que los estados demo (día 14 de 15,
--    conversión automática, vencimientos) se vean correctos cualquier día.
-- ============================================================================

insert into users (username, password, name, role, comprador_id) values
  ('coordinador', 'demo', 'R. Miranda',              'coordinador', null),
  ('ito',         'demo', 'C. Fuentes',              'ito',         null),
  ('limpieza',    'demo', 'Serlim Ltda.',            'limpieza',    null),
  ('vendor',      'demo', 'Metarec SpA',             'vendor',      null),
  ('adminventa',  'demo', 'P. Salinas',              'adminventa',  null),
  ('comprador',   'demo', 'Maestranza Andina Ltda.', 'comprador',   2);

insert into patios (nombre) values
  ('Los Colorados'), ('Patio 3500'), ('Laguna Seca'), ('Puerto Coloso');

insert into categorias (nombre, precio_kg) values
  ('Fierro pesado', 185), ('Fierro liviano / mixto', 120), ('Acero inoxidable', 650),
  ('Cables forrados', 2400), ('Bronce', 4200), ('Aluminio', 1150);

-- Programa de limpieza: semana 33 ejecutada, semana 34 en curso
insert into programa (semana, dia, fecha, patio_id, material, est_ton, real_ton, estado) values
  (33, 'Lun', current_date - 8, 1, 'Fierro pesado',          24, 25.2, 'ejecutado'),
  (33, 'Mié', current_date - 6, 2, 'Fierro liviano / mixto', 15, 14.3, 'ejecutado'),
  (33, 'Vie', current_date - 4, 3, 'Cables forrados',         5,  5.6, 'ejecutado'),
  (34, 'Lun', current_date - 1, 1, 'Fierro pesado',          22, 24.6, 'ejecutado'),
  (34, 'Lun', current_date - 1, 2, 'Fierro liviano / mixto', 14, 13.1, 'ejecutado'),
  (34, 'Mar', current_date,     3, 'Cables forrados',         6,  6.8, 'ejecutado'),
  (34, 'Mié', null,             4, 'Acero inoxidable',        4, null, 'programado'),
  (34, 'Jue', null,             1, 'Fierro pesado',          26, null, 'programado'),
  (34, 'Vie', null,             2, 'Fierro liviano / mixto', 16, null, 'reprogramado');

-- Despachos de julio 2026 (alimentan el EP-2026-07)
insert into despachos (guia, fecha, patio_id, categoria_id, kg_origen, fotos) values
  ('GD-4498', '2026-07-03', 1, 1, 29800, 3),
  ('GD-4499', '2026-07-05', 2, 1, 30400, 3),
  ('GD-4500', '2026-07-07', 1, 1, 28900, 3),
  ('GD-4501', '2026-07-09', 2, 1, 29100, 3),
  ('GD-4502', '2026-07-11', 1, 1, 30800, 3),
  ('GD-4503', '2026-07-13', 2, 1, 28400, 3),
  ('GD-4504', '2026-07-15', 1, 1, 31200, 3),
  ('GD-4505', '2026-07-17', 2, 1, 29600, 3),
  ('GD-4506', '2026-07-19', 1, 1, 27900, 3),
  ('GD-4507', '2026-07-21', 2, 1, 28900, 3),
  ('GD-4508', '2026-07-05', 2, 2, 30200, 3),
  ('GD-4509', '2026-07-10', 2, 2, 29400, 3),
  ('GD-4510', '2026-07-15', 2, 2, 31000, 3),
  ('GD-4511', '2026-07-20', 2, 2, 29400, 3),
  ('GD-4512', '2026-07-14', 4, 3,  7100, 3),
  ('GD-4513', '2026-07-21', 3, 4,  2100, 3),
  ('GD-4514', '2026-07-28', 3, 4,  1850, 3);

-- Recepción validada en destino (merma de báscula ~0,1%)
update despachos
   set kg_destino = round(kg_origen * 0.999),
       estado     = 'recepcionado'
 where fecha between '2026-07-01' and '2026-07-31';

-- Despachos del mes en curso
insert into despachos (guia, fecha, patio_id, categoria_id, kg_origen, kg_destino, fotos, estado) values
  ('GD-4526', current_date - 6, 2, 5,  1240,  1240, 2, 'recepcionado'),
  ('GD-4527', current_date - 5, 1, 1, 28040, 27410, 2, 'observado'),
  ('GD-4528', current_date - 4, 4, 3,  3910,  3905, 1, 'recepcionado'),
  ('GD-4529', current_date,     3, 4,  6790,  null, 3, 'en_transito'),
  ('GD-4530', current_date - 1, 2, 2, 13080, 13075, 2, 'recepcionado'),
  ('GD-4531', current_date - 1, 1, 1, 24600, 24580, 3, 'recepcionado');

-- Estados de pago históricos
insert into estados_pago (folio, periodo, bruto, total, estado, aprobado_por, fecha_aprobacion) values
  ('EP-2026-05', '2026-05', 64108900, 64108900, 'aprobado', 'R. Miranda', '2026-06-09'),
  ('EP-2026-06', '2026-06', 74210300, 73320300, 'aprobado', 'R. Miranda', '2026-07-08');

insert into descuentos (ep_id, concepto, monto)
values ((select id from estados_pago where folio = 'EP-2026-06'), 'Retiro no programado asumido por vendor', 890000);

insert into pagos_vendor (ep_id, fecha, monto, comprobante) values
  ((select id from estados_pago where folio = 'EP-2026-05'), '2026-06-24', 64108900, 'TRF-Metarec-0524.pdf'),
  ((select id from estados_pago where folio = 'EP-2026-06'), '2026-07-24', 43992180, 'TRF-Metarec-0612.pdf');

-- EP-2026-07: generado desde los despachos reales de julio, con descuento
insert into estados_pago (folio, periodo, bruto, total, estado)
select 'EP-2026-07', '2026-07', s.v, s.v - 1250000, 'en_aprobacion'
  from (select round(sum(d.kg_destino * c.precio_kg))::bigint as v
          from despachos d join categorias c on c.id = d.categoria_id
         where d.fecha between '2026-07-01' and '2026-07-31') s;

update despachos
   set ep_id = (select id from estados_pago where folio = 'EP-2026-07')
 where fecha between '2026-07-01' and '2026-07-31';

insert into descuentos (ep_id, concepto, monto)
values ((select id from estados_pago where folio = 'EP-2026-07'), 'Flete asumido por MEL (GD-4498)', 1250000);

-- Compradores
insert into compradores (razon_social, rut, email, telefono, due_diligence) values
  ('Ingemet SpA',             '76.412.880-1', 'contacto@ingemet.cl', '+56 55 249 1100', 'aprobada'),
  ('Maestranza Andina Ltda.', '77.902.334-5', 'ventas@mandina.cl',   '+56 55 283 7420', 'aprobada'),
  ('Comercial Recimet',       '76.118.442-K', 'ofertas@recimet.cl',  '+56 2 2896 5510', 'en_revision');

-- Componentes obsoletos (OBS-190 quedará convertido por la regla de 15 días)
insert into componentes (codigo, nombre, descripcion, patio_id, sector, valor_ref, estado, publicado_el, adjudicado_a, tono) values
  ('OBS-188', 'Repuestos chancador de pebbles', 'Lote de repuestos mayores, revestimientos y pernería', 2, 'Sector A-3',         7250000, 'adjudicado', current_date - 20, 2, 'violet'),
  ('OBS-190', 'Impulsor celda de flotación',    'Impulsor 300 m³ con desgaste de álabes',               1, 'Sector B-3',         4100000, 'publicado',  current_date - 16, null, 'green'),
  ('OBS-195', 'Reductor Falk 385',              'Reductor de velocidad, razón 25:1, carcasa completa',  3, 'Sector C-2',         9800000, 'adjudicado', current_date - 12, 1, 'copper'),
  ('OBS-198', 'Tolva CAEX Komatsu 930E',        'Capacidad 290 t, estructura completa, retiro en faena',2, 'Sector A-1',        45000000, 'publicado',  current_date - 14, null, 'copper'),
  ('OBS-201', 'Motor eléctrico 4.000 HP',       'WEG, 3.300 V, 50 Hz, usado, operativo al retiro de servicio', 1, 'Sector B-3 · Fila 2', 28500000, 'publicado', current_date - 6, null, 'steel'),
  ('OBS-203', 'Polines de correa (lote 120 u)', 'Ø 152 mm, correa transportadora overland, estado mixto',1, 'Sector B-1',        6400000, 'publicado',  current_date - 9, null, 'violet'),
  ('OBS-204', 'Neumáticos 63" usados (lote ×4)','Bridgestone 59/80R63, 40–55% de vida remanente',       2, 'Sector D-4',        12000000, 'publicado',  current_date - 2, null, 'green'),
  ('OBS-207', 'Transformador 23 kV',            'Transformador de poder seco, 23 kV / 4,16 kV',         3, 'Bodega 7',          18900000, 'planificado', null, null, 'steel');

-- Ofertas
insert into ofertas (componente_id, comprador_id, monto, plazo_retiro, forma_pago, fecha, estado) values
  ((select id from componentes where codigo='OBS-201'), 1, 33500000, '10 días hábiles', 'Transferencia 100%',  current_date,     'recibida'),
  ((select id from componentes where codigo='OBS-201'), 2, 31200000, '5 días hábiles',  'Transferencia 100%',  current_date - 2, 'recibida'),
  ((select id from componentes where codigo='OBS-201'), 3, 29000000, '15 días hábiles', '50% + 50% a 30 días', current_date - 3, 'recibida'),
  ((select id from componentes where codigo='OBS-198'), 2, 41000000, '10 días hábiles', 'Transferencia 100%',  current_date - 4, 'recibida'),
  ((select id from componentes where codigo='OBS-203'), 1,  5900000, '5 días hábiles',  'Transferencia 100%',  current_date - 5, 'recibida'),
  ((select id from componentes where codigo='OBS-203'), 2,  6100000, '10 días hábiles', 'Transferencia 100%',  current_date - 3, 'recibida'),
  ((select id from componentes where codigo='OBS-203'), 3,  5400000, '15 días hábiles', 'Transferencia 100%',  current_date - 1, 'recibida'),
  ((select id from componentes where codigo='OBS-195'), 1, 10200000, '10 días hábiles', 'Transferencia 100%',  current_date - 8, 'adjudicada'),
  ((select id from componentes where codigo='OBS-188'), 2,  7600000, '5 días hábiles',  'Transferencia 100%',  current_date - 16,'adjudicada');

insert into matriz_criterios (nombre, peso) values
  ('Precio ofertado', 50), ('Plazo de retiro', 20), ('Experiencia y due diligence', 20), ('Forma de pago', 10);

insert into adjudicaciones (componente_id, oferta_id, certificado, puntaje, fecha) values
  ((select id from componentes where codigo='OBS-195'),
   (select id from ofertas where componente_id=(select id from componentes where codigo='OBS-195') and estado='adjudicada'),
   'CA-2026-045', 9.10, current_date - 6),
  ((select id from componentes where codigo='OBS-188'),
   (select id from ofertas where componente_id=(select id from componentes where codigo='OBS-188') and estado='adjudicada'),
   'CA-2026-044', 8.70, current_date - 14);

insert into entregas (componente_id, comprador_id, adjudicado_el, estado, agenda) values
  ((select id from componentes where codigo='OBS-188'), 2, current_date - 14, 'sin_coordinacion', null),
  ((select id from componentes where codigo='OBS-195'), 1, current_date - 6,  'agendada',         current_date + 3);

-- Repositorio documental (metadatos de demo; las cargas nuevas usan Storage)
insert into documentos (archivo, tipo, hito, version, vencimiento, subido_por, fecha) values
  ('CTR-MEL-2025-114.pdf',  'Contrato con vendor',        'Contrato Metarec SpA',       3, '2026-12-31',      'R. Miranda',   '2025-12-20'),
  ('CTR-MEL-2025-089.pdf',  'Contrato limpieza patios',   'Contrato Serlim Ltda.',      2, '2027-06-30',      'R. Miranda',   '2025-11-02'),
  ('GD-4531.pdf',           'Guía de despacho',           'Despacho GD-4531',           1, null,              'Serlim Ltda.', current_date - 1),
  ('GV-2214.pdf',           'Guía de venta',              'Despacho GD-4529',           1, null,              'Metarec SpA',  current_date),
  ('EP-2026-07.pdf',        'Estado de pago',             'EP julio 2026',              2, null,              'C. Fuentes',   current_date - 2),
  ('DESC-2026-07.xlsx',     'Registro de descuentos',     'EP julio 2026',              1, null,              'C. Fuentes',   current_date - 2),
  ('FV-7781.pdf',           'Factura de venta',           'EP junio 2026',              1, null,              'Metarec SpA',  '2026-07-12'),
  ('TRF-Metarec-0612.pdf',  'Registro de pago vendor',    'EP junio 2026',              1, null,              'Metarec SpA',  '2026-07-24'),
  ('CDF-118.pdf',           'Certif. disposición final',  'Despachos julio',            1, current_date + 12, 'Metarec SpA',  '2026-07-30'),
  ('SCRAP-2026-031.pdf',    'Baja del activo (scrap)',    'Impulsor celda flotación',   1, null,              'R. Miranda',   current_date - 3);

-- Serie mensual 2026 (para paneles; el mes en curso se calcula en vivo)
insert into historico_mensual (mes, tonelaje, ing_chatarra, ing_obsoletos) values
  ('2026-01', 358, 58, 12), ('2026-02', 402, 66, 0),  ('2026-03', 371, 61, 45),
  ('2026-04', 415, 71, 28), ('2026-05', 389, 64, 95), ('2026-06', 428, 74, 31),
  ('2026-07', 441, 83, 120);

-- Bitácora inicial
insert into auditoria (usuario, rol, accion, objeto) values
  ('P. Salinas',   'adminventa', 'Publicó componente',                'OBS-201'),
  ('Serlim Ltda.', 'limpieza',   'Registró retiro con evidencia',     'GD-4531'),
  ('C. Fuentes',   'ito',        'Envió EP a aprobación',             'EP-2026-07'),
  ('Ingemet SpA',  'comprador',  'Presentó oferta',                   'OBS-201'),
  ('C. Fuentes',   'ito',        'Validó recepción',                  'GD-4531');

-- Aplicar la regla de 15 días sobre el seed (convierte OBS-190)
select convertir_vencidos() as componentes_convertidos;

-- ============================================================================
-- 4. ROW LEVEL SECURITY
--    Se habilita RLS en todas las tablas. El backend del prototipo se conecta
--    con la service_role key (omite RLS); las políticas de abajo son la base
--    para el acceso directo desde el cliente con Supabase Auth, usando un
--    custom claim `app_role` en el JWT. El set completo por rol/acción es
--    parte del alcance de la Fase 1.
-- ============================================================================

alter table users            enable row level security;
alter table patios           enable row level security;
alter table categorias       enable row level security;
alter table programa         enable row level security;
alter table despachos        enable row level security;
alter table estados_pago     enable row level security;
alter table descuentos       enable row level security;
alter table pagos_vendor     enable row level security;
alter table documentos       enable row level security;
alter table compradores      enable row level security;
alter table componentes      enable row level security;
alter table ofertas          enable row level security;
alter table matriz_criterios enable row level security;
alter table adjudicaciones   enable row level security;
alter table entregas         enable row level security;
alter table auditoria        enable row level security;
alter table historico_mensual enable row level security;

-- Helper: rol de aplicación desde el JWT (custom claim `app_role`)
create or replace function app_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'app_role', 'anon')
$$;

-- Portal público: cualquiera (incluido anon) ve solo componentes publicados
create policy portal_publicaciones on componentes
  for select using (estado = 'publicado' or app_role() in ('coordinador','adminventa'));

-- Estados de pago: los ven vendor, ITO y coordinador; solo el coordinador los modifica
create policy eps_lectura on estados_pago
  for select using (app_role() in ('vendor','ito','coordinador'));
create policy eps_aprobacion on estados_pago
  for update using (app_role() = 'coordinador');

-- Despachos: perfiles del proceso de chatarra
create policy despachos_lectura on despachos
  for select using (app_role() in ('limpieza','vendor','ito','coordinador'));
create policy despachos_registro on despachos
  for insert with check (app_role() in ('limpieza','ito','coordinador'));

-- Ofertas: el comprador ve solo las suyas; gestión ve todas
create policy ofertas_propias on ofertas
  for select using (
    app_role() in ('adminventa','coordinador')
    or comprador_id = nullif(auth.jwt() ->> 'comprador_id', '')::bigint
  );
create policy ofertas_presentar on ofertas
  for insert with check (app_role() = 'comprador');

-- Bitácora: inmutable — solo lectura para el coordinador, sin update/delete
create policy auditoria_lectura on auditoria
  for select using (app_role() = 'coordinador');
create policy auditoria_insercion on auditoria
  for insert with check (true);
