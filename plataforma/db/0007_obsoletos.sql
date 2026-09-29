-- 0007_obsoletos.sql — Fase 2: venta de componentes obsoletos + portal público
--
-- Segundo proceso de negocio de la plataforma (F3 de la cotización): inventario
-- de componentes obsoletos, publicaciones con regla de 15 días, portal público
-- de consulta y oferta, y adjudicación con matriz de evaluación ponderada y
-- comisión de venta al vendor. Migración ADITIVA. Aplicar en el SQL Editor.

-- Roles nuevos: administrador de la plataforma de venta (opera obsoletos) y
-- comprador externo (registrado en el portal; reservado para acceso futuro).
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('limpieza','vendor','ito','coordinador','lampa','admin_venta','comprador'));

-- Comisión de venta al vendor por cada adjudicación de obsoletos (% del monto).
alter table contrato add column if not exists comision_vendor_pct numeric(5,2) not null default 0;

-- Folios de Fase 2: OBS (componente) y CA (certificado de adjudicación).
insert into folios (tipo, ultimo) values ('OBS', 0), ('CA', 0)
  on conflict (tipo) do nothing;

-- Sitio MEL para el inventario de obsoletos (los componentes se dan de baja en
-- faena MEL o en La Negra; Lampa no aplica a obsoletos).
insert into sitios (codigo, nombre) select 'MEL', 'MEL'
  where not exists (select 1 from sitios where codigo = 'MEL');

-- ===================== inventario de obsoletos =====================
create table if not exists componentes (
  id                bigint generated always as identity primary key,
  codigo            text not null unique,            -- OBS-#### (folio automático)
  nombre            text not null,
  especificaciones  text,
  sitio_id          bigint references sitios(id),
  ubicacion         text,                            -- sector / fila / bodega en terreno
  valor_referencial numeric(14,0),
  fotos             int not null default 0,          -- respaldos en bucket privado OBS/<id>/
  estado            text not null default 'planificado'
                    check (estado in ('planificado','publicado','adjudicado','entregado','chatarra')),
  creado_por        text,
  creado_el         timestamptz not null default now()
);

-- ===================== publicaciones (regla de 15 días) =====================
-- Sin adjudicar al cumplirse el plazo, el componente se convierte en chatarra
-- y pasa al flujo de enajenación (Fase 1).
create table if not exists publicaciones (
  id             bigint generated always as identity primary key,
  componente_id  bigint not null references componentes(id),
  publicado_el   date not null default current_date,
  plazo_dias     int not null default 15,
  oferta_minima  numeric(14,0),
  estado         text not null default 'activa'
                 check (estado in ('activa','adjudicada','convertida','cancelada')),
  cerrada_el     timestamptz,
  creado_por     text,
  creado_el      timestamptz not null default now()
);
create index if not exists publicaciones_estado_idx on publicaciones (estado);

-- ===================== compradores del portal =====================
-- Se registran en el portal público; pasan due diligence antes de poder ofertar.
create table if not exists compradores (
  id           bigint generated always as identity primary key,
  user_id      bigint references users(id),          -- cuenta de acceso (rol 'comprador'); se activa al aprobar la DD
  razon_social text not null,
  rut          text not null,
  email        text not null,
  telefono     text,
  dd_estado    text not null default 'pendiente'
               check (dd_estado in ('pendiente','aprobada','rechazada')),
  dd_nota      text,
  creado_el    timestamptz not null default now()
);
create unique index if not exists compradores_rut_idx on compradores (lower(rut));

-- ===================== ofertas =====================
create table if not exists ofertas (
  id             bigint generated always as identity primary key,
  publicacion_id bigint not null references publicaciones(id),
  comprador_id   bigint not null references compradores(id),
  monto          numeric(14,0) not null check (monto > 0),
  plazo_retiro   text,
  forma_pago     text,
  comentarios    text,
  estado         text not null default 'recibida'
                 check (estado in ('recibida','adjudicada','descartada')),
  creado_el      timestamptz not null default now()
);
create index if not exists ofertas_pub_idx on ofertas (publicacion_id);

-- ===================== matriz de evaluación =====================
create table if not exists criterios (
  id     bigint generated always as identity primary key,
  nombre text not null,
  peso   int not null check (peso between 0 and 100),
  orden  int not null default 0,
  activo boolean not null default true
);
insert into criterios (nombre, peso, orden)
select * from (values
  ('Precio ofertado', 50, 1),
  ('Plazo de retiro', 20, 2),
  ('Experiencia y due diligence', 20, 3),
  ('Forma de pago', 10, 4)
) as v(nombre, peso, orden)
where not exists (select 1 from criterios);

-- ===================== adjudicaciones =====================
-- La oferta ganadora, con la matriz de evaluación congelada y el flujo posterior
-- (certificado, pago, comisión al vendor, entrega).
create table if not exists adjudicaciones (
  id             bigint generated always as identity primary key,
  publicacion_id bigint not null references publicaciones(id),
  oferta_id      bigint not null references ofertas(id),
  comprador_id   bigint not null references compradores(id),
  cert_folio     text not null unique,               -- CA-####
  matriz         jsonb not null,                     -- snapshot: criterios, pesos, puntajes, totales
  monto          numeric(14,0) not null,
  comision_pct   numeric(5,2) not null default 0,
  comision_monto numeric(14,0) not null default 0,
  estado         text not null default 'adjudicada'
                 check (estado in ('adjudicada','pagada','entregada')),
  pago_el        timestamptz,
  pago_ref       text,
  guia_folio     text,
  entregado_el   timestamptz,
  creado_por     text,
  creado_el      timestamptz not null default now()
);

-- ===================== RLS =====================
-- El backend usa la clave de servicio (bypass de RLS); las políticas protegen
-- ante accesos directos con claves de menor privilegio. El portal público entra
-- por endpoints del backend, no por el cliente de Supabase.
alter table componentes    enable row level security;
alter table publicaciones  enable row level security;
alter table compradores    enable row level security;
alter table ofertas        enable row level security;
alter table criterios      enable row level security;
alter table adjudicaciones enable row level security;

create policy obs_componentes_rw on componentes for all
  using (app_role() in ('coordinador','admin_venta'));
create policy obs_publicaciones_rw on publicaciones for all
  using (app_role() in ('coordinador','admin_venta'));
create policy obs_compradores_rw on compradores for all
  using (app_role() in ('coordinador','admin_venta'));
create policy obs_ofertas_rw on ofertas for all
  using (app_role() in ('coordinador','admin_venta'));
create policy obs_criterios_rw on criterios for all
  using (app_role() in ('coordinador','admin_venta'));
create policy obs_adjudicaciones_rw on adjudicaciones for all
  using (app_role() in ('coordinador','admin_venta'));
