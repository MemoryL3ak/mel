-- ============================================================================
-- 0016_despacho_pendiente.sql · Despacho de un obsoleto, pendiente de guía
-- ============================================================================
-- Cuando un obsoleto no vendido se deriva a chatarra, la plataforma crea su
-- despacho a La Negra con el patio, la categoría, el peso estimado y la fecha
-- de retiro. En ese momento la pieza todavía no sale del patio: no hay N° de
-- guía de despacho MEL, ni pesaje de báscula, ni respaldos. El despacho nace
-- 'pendiente_guia' y pasa a 'en_transito' cuando se completa la guía; recién
-- entonces La Negra puede recepcionarlo y se valoriza.
--
-- Aditiva: amplía los estados permitidos y agrega el patio La Negra. Ningún
-- despacho existente cambia.
-- ============================================================================

alter table despachos drop constraint if exists despachos_estado_check;
alter table despachos add constraint despachos_estado_check
  check (estado in ('pendiente_guia', 'en_transito', 'recepcionado', 'observado', 'anulado'));

-- La Negra como patio de origen: un obsoleto que ya está en La Negra se deriva
-- a chatarra desde ahí. Mismo código que el sitio La Negra de obsoletos.
-- (Se agregó también directo en la base el 14-oct-2026; on conflict lo salta.)
insert into patios (codigo, nombre, tipo) values ('LN', 'La Negra', 'origen')
  on conflict (codigo) do nothing;
