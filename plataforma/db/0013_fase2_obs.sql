-- ============================================================================
-- 0013_fase2_obs.sql · Observaciones del review de Fase 2
-- ============================================================================
--   · El acta firmada de entrega del producto al comprador no tenía dónde
--     guardarse: la entrega se registraba con un folio de guía y nada más.
--   · Un obsoleto que se va a chatarra se clasifica y entra al programa de
--     limpieza, pero de ahí a la guía y la valorización había que crear el
--     despacho a mano, sin ningún vínculo con el componente de origen.
--
-- Aditiva: no altera datos existentes.
-- ============================================================================

-- Acta de entrega firmada por el comprador, en evidencia/ENT/<adjudicacion>/.
alter table adjudicaciones add column if not exists entrega_docs int not null default 0;

-- Despacho de Fase 1 originado por un obsoleto no vendido. Permite seguir la
-- pieza desde el memo que la dio de baja hasta la guía con que se valorizó.
alter table despachos add column if not exists componente_id bigint references componentes(id);
create index if not exists ix_despachos_componente on despachos(componente_id);
