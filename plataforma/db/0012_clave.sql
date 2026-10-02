-- ============================================================================
-- 0012_clave.sql · Cambio de la contraseña inicial
-- ============================================================================
-- Las cuentas nacen con una contraseña generada que el coordinador entrega por
-- fuera de la plataforma (correo, mensaje). Esa clave la vio alguien más que su
-- dueño, así que debe poder reemplazarla por una propia al entrar.
--
-- `clave_inicial` marca que la contraseña vigente es la entregada y todavía no
-- la cambió su dueño. Se enciende al crear la cuenta y al restablecerla, y se
-- apaga sola cuando la persona la cambia.
--
-- Aditiva. Las cuentas que ya existen quedan marcadas: todas tienen hoy una
-- clave que fue entregada por un tercero.
-- ============================================================================

alter table users add column if not exists clave_inicial boolean not null default false;

update users set clave_inicial = true where role <> 'comprador';
