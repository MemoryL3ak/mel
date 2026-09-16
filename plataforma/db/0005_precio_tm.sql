-- ============================================================
-- GEA · 0005 — Precio en USD por tonelada y alternativa con/sin madera
-- ============================================================
-- Idempotente: se puede ejecutar más de una vez sin efecto adicional.
--
-- Dos correcciones sobre 0004, que asumió USD/kg y un precio único:
--
-- 1. El contrato se expresa en USD por TONELADA MÉTRICA, no por kilo.
--    Guardarlo dividido entre mil no era equivalente: con cuatro decimales,
--    184,07 USD/TM quedaba en 0,1841 USD/kg, que de vuelta son 184,10. La
--    plataforma no podía reproducir la cifra del contrato. Ahora se guarda
--    en la unidad del contrato y la conversión ocurre al valorizar.
--
-- 2. Cada material tiene dos precios: Alternativa A (sin madera) y
--    Alternativa B (con madera). Cuál se aplica se decide en la recepción,
--    según cómo llegue la carga, y queda congelado con la guía.

-- ---------- 1. Precios del contrato ----------
alter table precios add column if not exists precio_usd_tm        numeric(12,4) check (precio_usd_tm        is null or precio_usd_tm        >= 0);
alter table precios add column if not exists precio_usd_tm_madera numeric(12,4) check (precio_usd_tm_madera is null or precio_usd_tm_madera >= 0);

comment on column precios.precio_usd_tm        is 'Alternativa A — USD por tonelada métrica, sin madera';
comment on column precios.precio_usd_tm_madera is 'Alternativa B — USD por tonelada métrica, con madera';

-- ---------- 2. Alternativa aplicada en la recepción ----------
-- null = la guía se valorizó antes de que existiera la distinción.
alter table despachos add column if not exists con_madera    boolean;
alter table despachos add column if not exists precio_usd_tm numeric(12,4);

comment on column despachos.con_madera    is 'true = la carga llegó con madera: se aplicó la Alternativa B';
comment on column despachos.precio_usd_tm is 'Precio congelado en USD/TM al momento de la recepción';
