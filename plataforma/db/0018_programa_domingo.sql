-- ============================================================================
-- 0018_programa_domingo.sql · El programa de limpieza acepta el domingo
-- ============================================================================
-- La empresa de limpieza planifica retiros los siete días: la carga masiva de
-- la semana 43 (21-oct-2026) traía filas de domingo y el CHECK de `dia` (0001)
-- solo admitía de lunes a sábado. Se amplía la lista. El nombre del CHECK es el
-- que Postgres asigna por convención a una restricción sin nombre
-- (programa_dia_check), igual que en 0004 y 0006.
--
-- Aditiva: ninguna fila existente cambia. Aplicar ANTES de desplegar el código
-- que envía 'Dom'; si no, toda la carga que traiga un domingo falla con un
-- error de base (la inserción es atómica).
-- ============================================================================

alter table programa drop constraint if exists programa_dia_check;
alter table programa add constraint programa_dia_check
  check (dia in ('Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'));
