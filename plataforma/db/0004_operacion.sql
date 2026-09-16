-- ============================================================
-- GEA · 0004 — Transporte, pesaje, anulación, USD y descuentos por ítem
-- ============================================================
-- Idempotente: se puede ejecutar más de una vez sin efecto adicional.
-- El servidor detecta qué partes están aplicadas y opera sin las que falten,
-- así un despliegue nunca queda roto esperando este SQL.

-- ---------- 1. Transporte de la guía de despacho ----------
-- Datos que exige la Res. Ex. N°154 del SII para las guías de despacho
-- electrónicas a contar del 1 de noviembre de 2026.
alter table despachos add column if not exists transportista     text;
alter table despachos add column if not exists transportista_rut text;
alter table despachos add column if not exists patente_tracto    text;
alter table despachos add column if not exists patente_rampla    text;

-- ---------- 2. Pesaje declarado en la recepción ----------
-- El ticket de la romana trae folio propio y la tara del camión vacío;
-- kg_destino sigue siendo el peso NETO del material.
alter table despachos add column if not exists ticket_numero text;
alter table despachos add column if not exists vale_numero   text;
alter table despachos add column if not exists tara_kg       numeric(12,1) check (tara_kg is null or tara_kg > 0);

-- ---------- 3. Anulación y reemplazo de guías ----------
-- Una guía no se borra: se anula con motivo y queda en el libro. El folio
-- se conserva consumido, igual que una guía de papel anulada.
alter table despachos add column if not exists anulada_el       timestamptz;
alter table despachos add column if not exists anulada_por      text;
alter table despachos add column if not exists motivo_anulacion text;
alter table despachos add column if not exists reemplazada_por  bigint references despachos(id);

alter table despachos drop constraint if exists despachos_estado_check;
alter table despachos add constraint despachos_estado_check
  check (estado in ('en_transito','recepcionado','observado','anulado'));

create index if not exists despachos_estado_idx on despachos (estado);

-- ---------- 4. Valorización en dólares ----------
-- Los precios del contrato pasan a expresarse en USD/kg. Las filas antiguas
-- en pesos conservan precio_kg y se siguen valorizando en CLP, para no
-- reescribir historia ya facturada.
alter table precios add column if not exists precio_usd numeric(12,4) check (precio_usd is null or precio_usd >= 0);
alter table precios alter column precio_kg drop not null;

-- Valor del dólar del día, guardado como historia consultable.
create table if not exists dolar (
  fecha     date primary key,
  valor     numeric(10,2) not null check (valor > 0),
  fuente    text not null default 'mindicador.cl',
  creado_el timestamptz not null default now()
);
alter table dolar enable row level security;
drop policy if exists dolar_read on dolar;
create policy dolar_read on dolar for select using (app_role() is not null);
drop policy if exists dolar_write on dolar;
create policy dolar_write on dolar for all using (app_role() in ('ito','coordinador'));

-- El despacho congela el precio USD y el dólar del día de su recepción:
-- una variación posterior del tipo de cambio no revaloriza lo ya recibido.
alter table despachos add column if not exists precio_usd numeric(12,4);
alter table despachos add column if not exists dolar      numeric(10,2);
alter table despachos add column if not exists valor_usd  numeric(14,4);

-- ---------- 5. Descuentos por ítem, aplicados en la recepción ----------
-- kg  → descuenta kilos antes de valorizar (humedad, material ajeno)
-- pct → descuenta un porcentaje del valor
-- usd → descuenta un monto fijo en dólares
create table if not exists despacho_descuentos (
  id          bigint generated always as identity primary key,
  despacho_id bigint not null references despachos(id) on delete cascade,
  tipo        text not null check (tipo in ('kg','pct','usd')),
  valor       numeric(14,4) not null check (valor > 0),
  glosa       text not null,
  creado_por  text,
  creado_el   timestamptz not null default now()
);
create index if not exists despacho_desc_idx on despacho_descuentos (despacho_id);
alter table despacho_descuentos enable row level security;
drop policy if exists desp_desc_read on despacho_descuentos;
create policy desp_desc_read on despacho_descuentos for select using (app_role() is not null);
drop policy if exists desp_desc_write on despacho_descuentos;
create policy desp_desc_write on despacho_descuentos for all
  using (app_role() in ('vendor','ito','coordinador'));
