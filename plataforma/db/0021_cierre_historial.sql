-- ============================================================================
-- 0021_cierre_historial.sql · Ajuste de cierre en kilos e historial de guías
-- ============================================================================
-- Pedidos de MEL (24-nov-2026):
--
-- 1. Al cerrar el estado de pago hay que poder cuadrar los KILOS del período,
--    no solo el monto. Hasta ahora un descuento del EP era solo en pesos. Cada
--    línea de descuento puede llevar ahora kilos:
--      · kg > 0 → kilos que se restan de lo valorizado
--      · kg < 0 → kilos que se suman
--    y puede ser solo de kilos (monto 0), por eso el monto deja de exigirse
--    mayor que cero. Una línea sin kilos ni monto no tiene sentido y se rechaza.
--
-- 2. Historial de guías anteriores a la plataforma (la planilla «HISTORIA
--    CHATARRA» de MEL): una fila por línea de la planilla, tal como viene. No se
--    mezcla con las guías reales: no entra a despachos, cuadraturas ni estados
--    de pago; alimenta los indicadores y se consulta en su propia pestaña.
--    `periodo` es el período del EDP en que se cobró ('AAAA-MM', el mes en que
--    cierra), que es como la plataforma nombra sus períodos.
--
-- Aditiva: ninguna fila existente cambia.
-- ============================================================================

-- ---------- 1. Kilos en los descuentos / ajustes del EP ----------
alter table ep_descuentos add column if not exists kg numeric(14,1);
alter table ep_descuentos drop constraint if exists ep_descuentos_monto_check;
alter table ep_descuentos add constraint ep_descuentos_monto_check check (monto >= 0);
alter table ep_descuentos drop constraint if exists ep_descuentos_algo_check;
alter table ep_descuentos add constraint ep_descuentos_algo_check
  check (monto > 0 or coalesce(kg, 0) <> 0);

-- ---------- 2. Historial de guías ----------
create table if not exists historial_guias (
  id             bigint generated always as identity primary key,
  anio           int  not null,
  periodo        text not null,            -- 'AAAA-MM' del EDP en que se cobró
  edp_numero     int,
  periodo_texto  text,                     -- como viene en la planilla: '21-01 al 20-02'
  fecha          date not null,
  gde            text not null,            -- N° de la guía de venta
  estado_emision text,
  gd_anulada     text,
  tipo_guia      text,
  categoria      text,                     -- descripción tal como viene
  categoria_id   bigint references categorias(id),
  patio          text,
  dolar          numeric(10,2),
  kg             numeric(14,1),
  usd_tm         numeric(14,4),
  precio_clp_tm  numeric(14,0),
  valor          numeric(14,0),
  origen         text,                     -- archivo del que se cargó
  cargado_por    text,
  cargado_el     timestamptz not null default now()
);
create index if not exists historial_guias_periodo_idx on historial_guias (anio, periodo);
create index if not exists historial_guias_gde_idx on historial_guias (gde);

alter table historial_guias enable row level security;
drop policy if exists historial_guias_read on historial_guias;
create policy historial_guias_read on historial_guias for select
  using (app_role() in ('ito', 'coordinador'));
drop policy if exists historial_guias_write on historial_guias;
create policy historial_guias_write on historial_guias for all
  using (app_role() = 'coordinador');
