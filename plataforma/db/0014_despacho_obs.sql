-- ============================================================================
-- 0014_despacho_obs.sql · Observaciones del despacho
-- ============================================================================
-- La recepción en La Negra tenía su campo de observaciones (`obs_recepcion`)
-- desde el principio, pero el despacho no: quien carga en el patio no tenía
-- dónde dejar constancia de lo que vio —material mezclado, una carga parcial,
-- un camión que salió con otra patente— y esa información terminaba por
-- teléfono o se perdía.
--
-- Aditiva: no altera datos existentes.
-- ============================================================================

alter table despachos add column if not exists observacion text;
