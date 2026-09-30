-- ============================================================================
-- 0010_ofertas.sql · Trazabilidad por cantidad, plazo ampliable y ofertas con
--                    moneda y datos del solicitante
-- ============================================================================
-- Cuatro cambios pedidos por MEL sobre el flujo de obsoletos:
--   1. Seguir la cantidad a lo largo del proceso, no solo la pieza.
--   2. Poder ampliar el plazo de una publicación en curso.
--   3. Pedirle más datos al oferente al presentar su oferta.
--   4. Aceptar ofertas en dólares o en pesos.
--
-- Aditiva: no altera datos existentes. Los componentes ya cargados quedan con
-- cantidad comprometida 1, y las ofertas existentes quedan en dólares.
-- ============================================================================

-- ─────────────────── 1. Trazabilidad por cantidad ───────────────────
-- El memo compromete una cantidad, el terreno encuentra otra, al showroom se
-- envía otra y allá se recibe otra. Hasta ahora el componente era una pieza
-- suelta sin cantidad, así que esas diferencias no existían en ninguna parte y
-- un faltante entre etapas no dejaba rastro.
alter table componentes add column if not exists cant_comprometida int not null default 1;
alter table componentes add column if not exists cant_encontrada   int;
alter table componentes add column if not exists cant_enviada      int;
alter table componentes add column if not exists cant_recibida     int;
alter table componentes add column if not exists enviado_el        timestamptz;
alter table componentes add column if not exists recibido_el       timestamptz;

alter table componentes drop constraint if exists componentes_cant_comprometida_check;
alter table componentes add constraint componentes_cant_comprometida_check
  check (cant_comprometida > 0);

-- ─────────────────── 2. Ampliación del plazo ───────────────────
-- Una publicación que va en el día 14 de 15 con ofertas en curso puede
-- necesitar más tiempo. Se guarda cuánto se amplió para que el plazo original
-- siga siendo legible en la bitácora.
alter table publicaciones add column if not exists plazo_ampliado_dias int not null default 0;
alter table publicaciones add column if not exists plazo_ampliado_el   timestamptz;

-- ─────────────────── 3 y 4. Ofertas ───────────────────
alter table ofertas add column if not exists moneda text not null default 'USD';
alter table ofertas drop constraint if exists ofertas_moneda_check;
alter table ofertas add constraint ofertas_moneda_check check (moneda in ('USD', 'CLP'));

-- El monto llevado a dólares, para que la matriz compare lo mismo. Se calcula
-- con el dólar del día de la oferta y se CONGELA junto al tipo de cambio usado:
-- el puntaje de una oferta no puede cambiar solo porque el dólar se movió.
alter table ofertas add column if not exists monto_usd numeric(14,2);
alter table ofertas add column if not exists dolar     numeric(10,2);

-- Datos del solicitante. La cuenta del comprador sigue siendo la que autoriza a
-- ofertar; esto identifica a quién representa esta oferta en particular, que
-- puede ser una persona natural o una empresa distinta.
alter table ofertas add column if not exists solicitante_tipo     text;
alter table ofertas add column if not exists solicitante_nombre   text;
alter table ofertas add column if not exists solicitante_rut      text;
alter table ofertas add column if not exists solicitante_telefono text;
alter table ofertas add column if not exists solicitante_email    text;
alter table ofertas add column if not exists empresa_rut          text;
alter table ofertas add column if not exists empresa_razon_social text;

alter table ofertas drop constraint if exists ofertas_solicitante_tipo_check;
alter table ofertas add constraint ofertas_solicitante_tipo_check
  check (solicitante_tipo is null or solicitante_tipo in ('persona', 'empresa'));

-- Todo lo ofertado hasta ahora fue en dólares.
update ofertas set monto_usd = monto where monto_usd is null;

-- ─────────────────── 5. Aviso de ofertas al equipo ───────────────────
-- Los usuarios internos entran con nombre de usuario ("coordinador"), no con
-- correo, así que no había ninguna dirección a la cual avisarles cuando entra
-- una oferta. El correo es opcional: quien no lo tenga cargado simplemente no
-- recibe el aviso, y el resto sí.
alter table users add column if not exists email text;

-- ─────────────────── 6. Comisión por intermediación ───────────────────
-- La nota que ve el oferente declara 6,5% más IVA sobre el valor ofertado. Se
-- toma del contrato para que no queden dos verdades distintas en la pantalla.
update contrato set comision_vendor_pct = 6.5 where coalesce(comision_vendor_pct, 0) = 0;
