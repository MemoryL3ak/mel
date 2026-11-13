-- ============================================================================
-- 0020_venta_manual.sql · Ofertas ingresadas a mano y guía de traslado
-- ============================================================================
-- Observaciones de MEL (nov-2026, segunda lista):
--
-- 1. Mientras GEA no esté conectada con la plataforma de venta de Soproin y
--    los compradores no oferten por el portal público, las ofertas llegan por
--    otra vía (correo, plataforma de venta) y la administración las ingresa a
--    mano para poder adjudicar y vender con todos sus respaldos. Cada oferta
--    guarda quién la ingresó (`ingresada_por`; nulo = la presentó el comprador
--    en el portal) y la fecha en que se recibió (`recibida_el`).
--
-- 2. El movimiento de un componente (por ejemplo cuando baja de MEL a La
--    Negra) puede llevar adjunta su guía de despacho. En el repositorio
--    documental queda con un tipo propio, vinculado al componente, para no
--    confundirla con la guía de la venta, que se vincula a la adjudicación.
--
-- Aditiva: ninguna fila existente cambia. Sin esta migración la plataforma
-- igual ingresa ofertas a mano (queda en la bitácora quién lo hizo) y guarda
-- la guía del movimiento con el tipo «Guía de despacho».
-- ============================================================================

alter table ofertas add column if not exists ingresada_por text;
alter table ofertas add column if not exists recibida_el   date;

comment on column ofertas.ingresada_por is 'Usuario interno que ingresó la oferta a mano; nulo si la presentó el comprador en el portal';
comment on column ofertas.recibida_el   is 'Fecha en que se recibió la oferta ingresada a mano';

insert into doc_tipos (codigo, proceso, nombre, descripcion, hito, vence, vigencia_meses, aviso_dias,
                       roles_carga, roles_ver, exigible_en, responsable, orden) values
  ('ob_guia_traslado', 'obsoletos', 'Guía de traslado del componente',
   'Guía de despacho con que el componente se mueve dentro del proceso, por ejemplo de MEL a La Negra.',
   'componente', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Coordinador Logístico MEL', 225)
on conflict (codigo) do nothing;
