-- 0006_review.sql — observaciones del review de MEL (sep-2026)
--
-- Migración ADITIVA y sin pérdida de datos: solo agrega columnas, amplía un
-- CHECK y renombra un tipo de folio. Aplicar en el SQL Editor de Supabase.
-- El servidor autodetecta cada pieza (server/src/esquema.js) y habilita la
-- función correspondiente; hasta entonces opera sin ella.

-- Obs 3 · Tara en el despacho de origen (MEL → La Negra).
-- El neto declarado sigue en kg_origen; el bruto se deriva (kg_origen + tara).
-- Es simétrico a la tara que ya se captura en la recepción de La Negra.
alter table despachos add column if not exists tara_origen_kg numeric(12,1);

-- Obs 5 · Respaldo del certificado de disposición final (CDF).
-- Cuenta cuántos documentos se adjuntaron a la recepción en Lampa: hoy el CDF
-- solo se folia; con esto se puede subir el documento físico.
alter table traslados add column if not exists cert_fotos int not null default 0;

-- Obs 9 · Doble control del cierre de cuadratura.
-- El ITO cierra la semana; el responsable de Lampa la confirma. confirmada_el
-- nulo = pendiente de Lampa; no nulo = doble firma completa.
alter table cuadraturas add column if not exists confirmada_por text;
alter table cuadraturas add column if not exists confirmada_el  timestamptz;

-- Obs 9 · Rol 'lampa' con login propio (responsable de disposición final).
-- El CHECK original de 0001 se llama users_role_check (nombre por convención de
-- Postgres para un CHECK en línea sobre la columna role).
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('limpieza','vendor','ito','coordinador','lampa'));

-- Obs 6 · El correlativo interno deja de llamarse "GD".
-- "GD" es la Guía de Despacho que emite el SII para MEL (se guarda en
-- despachos.guia_mel). El correlativo propio de la plataforma pasa a folio 'CI'
-- (código interno). Las guías ya emitidas conservan su folio GD-####; las
-- nuevas se emiten CI-####. next_folio() no cambia: solo el tipo.
update folios set tipo = 'CI' where tipo = 'GD';
