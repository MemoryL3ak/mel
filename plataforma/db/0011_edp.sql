-- ============================================================================
-- 0011_edp.sql · Respaldo de los descuentos del EDP y acumulado del año
-- ============================================================================
-- Las dos observaciones que MEL marcó como "PENDIENTE NUEVO":
--
--   1. Los descuentos del estado de pago se digitaban como glosa y monto, sin
--      ningún respaldo detrás. Quien revisa el EDP no tenía cómo verificar de
--      dónde sale un descuento.
--
--   2. El formato impreso trae el monto acumulado, pero acumulaba sobre toda
--      la serie del contrato sin reiniciar en enero. MEL lo necesita del año
--      en curso, y poder ajustarlo a mano cuando el arrastre del año anterior
--      no calza con su contabilidad.
--
-- Aditiva: no altera datos existentes.
-- ============================================================================

-- ─────────────── 1. Respaldo del descuento ───────────────
-- Foto, PDF o documento Word en evidencia/EPD/<descuento_id>/.
alter table ep_descuentos add column if not exists respaldos int not null default 0;

-- ─────────────── 2. Acumulado del año ───────────────
-- Ajuste manual del acumulado que se imprime. Nulo = se usa el calculado.
-- Se guarda por EDP y no en el contrato porque es el número de ESE documento:
-- corregirlo después no debe cambiar lo que ya se imprimió y se firmó.
alter table estados_pago add column if not exists acumulado_manual numeric(14,0);
alter table estados_pago add column if not exists acumulado_nota   text;
