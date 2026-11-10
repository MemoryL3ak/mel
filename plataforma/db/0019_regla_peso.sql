-- ============================================================================
-- 0019_regla_peso.sql · Peso que rige según contrato, fecha de recepción
-- ============================================================================
-- Observaciones de MEL (nov-2026):
--
-- 1. Cuando el pesaje de MEL (báscula de origen) y el de La Negra (báscula
--    del vendor) difieren, el contrato dice cuál de los dos se valoriza:
--      · diferencia ≤ 3 %            → rige el peso de MEL
--      · diferencia > 3 % y < 5 %    → MEL y Lampa lo acuerdan a mano
--      · diferencia ≥ 5 %            → rige el peso de La Negra (Lampa)
--    Hasta ahora la plataforma valorizaba SIEMPRE el peso de La Negra y
--    marcaba observada toda diferencia sobre 2 %. Ahora cada recepción guarda
--    el peso que rige (`kg_contrato`, el que se valoriza) y por qué regla
--    (`regla_peso`). Los dos pesajes físicos (`kg_origen`, `kg_destino`) se
--    conservan tal cual: la regla elige, no corrige.
--      · 'mel'       → rige MEL (≤ tolerancia MEL)
--      · 'lampa'     → rige La Negra (≥ tolerancia Lampa)
--      · 'pendiente' → en la franja intermedia, esperando el acuerdo; mientras
--                      tanto se valoriza provisionalmente el peso de La Negra
--                      y la guía queda observada
--      · 'acuerdo'   → peso fijado a mano por el ITO de MEL o el auditor de
--                      Lampa, con justificación en la bitácora
--    Las tolerancias viven en `contrato`, editables desde Valorización.
--
-- 2. La recepción (en La Negra y en Lampa) registra la fecha en que ocurrió,
--    digitada del ticket, además de la marca de tiempo del sistema.
--
-- Aditiva: ninguna fila existente cambia. Las recepciones anteriores quedan
-- con `kg_contrato` nulo y el servidor sigue valorizando `kg_destino` para
-- ellas (`coalesce(kg_contrato, kg_destino)`).
-- ============================================================================

alter table despachos add column if not exists kg_contrato numeric(12,1)
  check (kg_contrato is null or kg_contrato > 0);
alter table despachos add column if not exists regla_peso text
  check (regla_peso is null or regla_peso in ('mel', 'lampa', 'pendiente', 'acuerdo'));
alter table despachos add column if not exists fecha_recepcion date;

alter table traslados add column if not exists fecha_recepcion date;

-- Tolerancias del contrato (en %). Por defecto las del contrato vigente.
alter table contrato add column if not exists tol_mel_pct   numeric(5,2) not null default 3
  check (tol_mel_pct >= 0);
alter table contrato add column if not exists tol_lampa_pct numeric(5,2) not null default 5
  check (tol_lampa_pct >= 0);
