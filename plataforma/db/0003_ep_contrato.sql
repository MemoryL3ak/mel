-- ============================================================
-- GEA · 0003 — Estado de pago en el formato del contrato,
-- número de la guía de MEL y descuentos del EP.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase, sobre la
-- base ya instalada. 0001_schema.sql ya incorpora todo esto para
-- instalaciones nuevas, así que no hace falta volver a correrlo.
-- Es idempotente: si se ejecuta dos veces no rompe nada.
-- ============================================================

-- ---------- 1. Guía de despacho de MEL (documento legal) ----------
alter table despachos add column if not exists guia_mel text;
create index if not exists despachos_guia_mel_idx on despachos (guia_mel);

-- ---------- 2. Descuentos del estado de pago ----------
alter table estados_pago add column if not exists descuentos numeric(14,0) not null default 0;

create table if not exists ep_descuentos (
  id         bigint generated always as identity primary key,
  ep_id      bigint not null references estados_pago(id) on delete cascade,
  glosa      text not null,
  monto      numeric(14,0) not null check (monto > 0),
  creado_por text
);
alter table ep_descuentos enable row level security;
drop policy if exists ep_desc_rw on ep_descuentos;
create policy ep_desc_rw on ep_descuentos for all
  using (app_role() in ('ito','coordinador'));

-- ---------- 3. Encabezado del EP según el formato del contrato ----------
alter table estados_pago add column if not exists numero        int;
alter table estados_pago add column if not exists revision      int not null default 0;
alter table estados_pago add column if not exists desde         date;
alter table estados_pago add column if not exists hasta         date;
alter table estados_pago add column if not exists presentado_el date;
alter table estados_pago add column if not exists anticipo      numeric(14,0) not null default 0;
alter table estados_pago add column if not exists no_afecto_iva numeric(14,0) not null default 0;

-- ---------- 4. Datos del contrato (fila única) ----------
-- Alimenta el encabezado y las firmas del estado de pago.
create table if not exists contrato (
  id                int primary key default 1 check (id = 1),
  numero            text,
  gerencia          text,
  glosa             text,
  mandante          text,
  contratista       text,
  firma_mandante    text,
  firma_contratista text,
  monto_original    numeric(14,0) not null default 0,
  modificaciones    numeric(14,0) not null default 0,
  iva_pct           numeric(5,2)  not null default 19,
  dia_corte         int not null default 20 check (dia_corte between 1 and 28),
  meses_vigencia_precio int not null default 3
);
alter table contrato enable row level security;
drop policy if exists contrato_read on contrato;
create policy contrato_read on contrato for select
  using (app_role() in ('limpieza','vendor','ito','coordinador'));
drop policy if exists contrato_write on contrato;
create policy contrato_write on contrato for all
  using (app_role() = 'coordinador');

insert into contrato (id, numero, gerencia, glosa, mandante, contratista,
                      firma_mandante, firma_contratista)
values (1, '9100078390', 'GERENCIA W&L', 'ADJUDICACIÓN LICITACIÓN DE CHATARRA',
        'MINERA ESCONDIDA LIMITADA', 'SOCIEDAD DE PROCESAMIENTO IND. S.A.',
        'Cristian Barra T.', 'Rafael Ahumada')
on conflict (id) do nothing;
