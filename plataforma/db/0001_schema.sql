-- ============================================================
-- GEA · Plataforma de enajenación de activos — Minera Escondida
-- Fase 1: proceso de enajenación de chatarra
-- Ejecutar en el SQL Editor del proyecto Supabase (se reutiliza el de la
-- demo: este script ELIMINA el prototipo e instala el esquema oficial).
-- Re-ejecutable: borra y recrea todo desde cero.
-- ============================================================

-- Limpieza total: este proyecto reutiliza la base del prototipo demo.
-- Se eliminan TODAS las tablas del prototipo (incluido el portal de
-- obsoletos, que la Fase 2 reconstruirá sobre los flujos reales) y las
-- tablas propias, para instalar el esquema oficial desde cero.
drop table if exists
  -- prototipo demo
  historico_mensual, entregas, adjudicaciones, matriz_criterios, ofertas,
  componentes, compradores, documentos, pagos_vendor, descuentos,
  -- plataforma oficial (re-ejecución)
  auditoria, ep_descuentos, cuadraturas, traslados, despachos, programa,
  estados_pago, precios, folios, users, sitios, categorias, patios cascade;
drop function if exists convertir_vencidos();

-- ===================== maestros =====================

create table patios (
  id      bigint generated always as identity primary key,
  codigo  text not null unique,          -- HOP01 / LD01 / CLS01 / PC
  nombre  text not null,
  tipo    text not null default 'origen' check (tipo in ('origen','central')),
  activo  boolean not null default true
);

create table categorias (
  id     bigint generated always as identity primary key,
  nombre text not null unique,
  activo boolean not null default true
);

-- Tabla de precios del contrato, con vigencia histórica.
-- El precio aplicado a un despacho se CONGELA al momento de recepcionarlo.
create table precios (
  id            bigint generated always as identity primary key,
  categoria_id  bigint not null references categorias(id),
  precio_kg     numeric(12,2) not null check (precio_kg >= 0),
  vigente_desde date not null default current_date,
  creado_por    text
);
create index precios_vigencia_idx on precios (categoria_id, vigente_desde desc);

create table sitios (
  id     bigint generated always as identity primary key,
  codigo text not null unique,           -- LN (La Negra) / LP (Lampa)
  nombre text not null
);

create table users (
  id            bigint generated always as identity primary key,
  username      text not null unique,
  password_hash text not null,
  nombre        text not null,
  role          text not null check (role in ('limpieza','vendor','ito','coordinador')),
  activo        boolean not null default true,
  creado_el     timestamptz not null default now()
);

-- ===================== folios correlativos =====================
-- Función race-safe: un UPDATE atómico por tipo de documento.

create table folios (
  tipo   text primary key,               -- GD guía despacho MEL, GT guía traslado a Lampa, CDF certificado disposición final
  ultimo int not null default 0
);
insert into folios (tipo, ultimo) values ('GD', 1000), ('GT', 400), ('CDF', 100);

create or replace function next_folio(p_tipo text) returns text
language plpgsql
security definer set search_path = public
as $$
declare v int;
begin
  update folios set ultimo = ultimo + 1 where tipo = p_tipo returning ultimo into v;
  if v is null then
    raise exception 'tipo de folio desconocido: %', p_tipo;
  end if;
  return p_tipo || '-' || lpad(v::text, 4, '0');
end $$;

-- ===================== programa semanal de limpieza =====================
-- La empresa de limpieza envía la planificación semanal de despacho por tipo
-- de material; el cumplimiento se registra contra lo ejecutado.

create table programa (
  id            bigint generated always as identity primary key,
  anio          int  not null,
  semana        int  not null check (semana between 1 and 53),
  dia           text not null check (dia in ('Lun','Mar','Mié','Jue','Vie','Sáb')),
  fecha         date,
  patio_id      bigint not null references patios(id),
  categoria_id  bigint not null references categorias(id),
  ton_estimadas numeric(10,1) not null check (ton_estimadas > 0),
  ton_reales    numeric(10,1),
  estado        text not null default 'programado'
                check (estado in ('programado','ejecutado','reprogramado','cancelado')),
  observacion   text,
  creado_por    text,
  creado_el     timestamptz not null default now()
);
create index programa_semana_idx on programa (anio, semana);

-- ===================== estados de pago =====================
-- Ciclo según flujo: ITO genera al cierre de mes → Coordinador revisa
-- (¿EDP correcto? no → ajuste y corrección) → firma y envía → vendor factura
-- → vendor paga (<15 días) → Coordinador revisa la transferencia (concilia).

create table estados_pago (
  id             bigint generated always as identity primary key,
  folio          text not null unique,   -- EP-YYYY-MM
  periodo        text not null unique,   -- YYYY-MM
  bruto          numeric(14,0) not null default 0,
  descuentos     numeric(14,0) not null default 0,
  total          numeric(14,0) not null default 0,
  estado         text not null default 'generado'
                 check (estado in ('generado','en_revision','con_ajustes','firmado','facturado','pagado','conciliado')),
  observacion    text,                   -- obligatoria al devolver con ajustes
  factura_numero text,
  factura_fecha  date,
  pago_monto     numeric(14,0),
  pago_fecha     date,
  pago_ref       text,
  firmado_por    text,
  firmado_el     timestamptz,
  generado_por   text,
  generado_el    timestamptz not null default now()
);

create table ep_descuentos (
  id         bigint generated always as identity primary key,
  ep_id      bigint not null references estados_pago(id) on delete cascade,
  glosa      text not null,
  monto      numeric(14,0) not null check (monto > 0),
  creado_por text
);

-- ===================== despachos MEL → La Negra =====================

create table despachos (
  id                 bigint generated always as identity primary key,
  guia               text not null unique,        -- GD-#### (folio automático)
  fecha              date not null default current_date,
  patio_id           bigint not null references patios(id),
  categoria_id       bigint not null references categorias(id),
  kg_origen          numeric(12,1) not null check (kg_origen > 0),  -- pesaje báscula MEL
  fotos              int not null default 0,
  estado             text not null default 'en_transito'
                     check (estado in ('en_transito','recepcionado','observado')),
  -- recepción y pesaje en La Negra (vendor); puede reclasificar/reducir
  kg_destino         numeric(12,1),
  categoria_final_id bigint references categorias(id),
  obs_recepcion      text,
  recepcionado_por   text,
  recepcionado_el    timestamptz,
  -- valorización congelada al recepcionar
  precio_kg          numeric(12,2),
  valor              numeric(14,0),
  ep_id              bigint references estados_pago(id),
  creado_por         text,
  creado_el          timestamptz not null default now()
);
create index despachos_fecha_idx on despachos (fecha);
create index despachos_ep_idx on despachos (ep_id);

-- ===================== traslados La Negra → Lampa =====================
-- El vendor consolida y re-despacha; Lampa recibe, pesa y emite el
-- certificado de disposición final.

create table traslados (
  id               bigint generated always as identity primary key,
  guia             text not null unique,          -- GT-####
  fecha            date not null default current_date,
  categoria_id     bigint not null references categorias(id),
  kg               numeric(12,1) not null check (kg > 0),
  estado           text not null default 'en_transito'
                   check (estado in ('en_transito','recepcionado')),
  kg_lampa         numeric(12,1),
  cert_folio       text unique,                   -- CDF-#### al recepcionar en Lampa
  recepcionado_el  timestamptz,
  creado_por       text
);
create index traslados_fecha_idx on traslados (fecha);

-- ===================== cuadratura semanal (ITO) =====================
-- Snapshot inmutable de la cuadratura de movimientos de la semana
-- entre MEL, La Negra y Lampa, por categoría.

create table cuadraturas (
  id          bigint generated always as identity primary key,
  anio        int not null,
  semana      int not null,
  estado      text not null check (estado in ('cuadrada','con_diferencias')),
  detalle     jsonb not null,      -- [{categoria, kg_mel, kg_lanegra, kg_lampa, dif_pct}]
  observacion text,
  generada_por text,
  generada_el  timestamptz not null default now(),
  unique (anio, semana)
);

-- ===================== bitácora de auditoría =====================
-- Solo se inserta; nunca se edita ni se borra.

create table auditoria (
  id      bigint generated always as identity primary key,
  fecha   timestamptz not null default now(),
  usuario text not null,
  rol     text not null,
  accion  text not null,
  objeto  text
);
create index auditoria_fecha_idx on auditoria (id desc);

-- ===================== RLS =====================
-- El backend opera con la clave secreta (service role). Las políticas
-- protegen la base ante cualquier acceso directo con claves de menor
-- privilegio: por defecto, nadie ve nada sin un rol de aplicación.

create or replace function app_role() returns text
language sql stable as $$
  select coalesce(auth.jwt() ->> 'app_role', '')
$$;

alter table patios        enable row level security;
alter table categorias    enable row level security;
alter table precios       enable row level security;
alter table sitios        enable row level security;
alter table users         enable row level security;
alter table folios        enable row level security;
alter table programa      enable row level security;
alter table despachos     enable row level security;
alter table traslados     enable row level security;
alter table cuadraturas   enable row level security;
alter table estados_pago  enable row level security;
alter table ep_descuentos enable row level security;
alter table auditoria     enable row level security;

-- Maestros: lectura para cualquier rol interno.
create policy maestros_read_patios on patios for select
  using (app_role() in ('limpieza','vendor','ito','coordinador'));
create policy maestros_read_categorias on categorias for select
  using (app_role() in ('limpieza','vendor','ito','coordinador'));
create policy maestros_read_precios on precios for select
  using (app_role() in ('limpieza','vendor','ito','coordinador'));

-- Operación: cada tabla según el flujo del proceso.
create policy programa_rw on programa for all
  using (app_role() in ('limpieza','ito','coordinador'));
create policy despachos_read on despachos for select
  using (app_role() in ('limpieza','vendor','ito','coordinador'));
create policy despachos_insert on despachos for insert
  with check (app_role() in ('limpieza','ito','coordinador'));
create policy despachos_recepcion on despachos for update
  using (app_role() in ('vendor','ito','coordinador'));
create policy traslados_rw on traslados for all
  using (app_role() in ('vendor','ito','coordinador'));
create policy cuadraturas_rw on cuadraturas for all
  using (app_role() in ('ito','coordinador'));
create policy eps_read on estados_pago for select
  using (app_role() in ('vendor','ito','coordinador'));
create policy eps_write on estados_pago for update
  using (app_role() in ('vendor','ito','coordinador'));
create policy eps_insert on estados_pago for insert
  with check (app_role() in ('ito','coordinador'));
create policy ep_desc_rw on ep_descuentos for all
  using (app_role() in ('ito','coordinador'));

-- Auditoría: se agrega, jamás se modifica; solo la gestión la lee.
create policy auditoria_insert on auditoria for insert
  with check (app_role() in ('limpieza','vendor','ito','coordinador'));
create policy auditoria_read on auditoria for select
  using (app_role() in ('ito','coordinador'));
