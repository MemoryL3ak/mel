-- ============================================================================
-- 0009_chatarra.sql · Puente del obsoleto no vendido hacia el flujo de chatarra
-- ============================================================================
-- Cuando una publicación cumple su plazo sin adjudicarse, el componente se
-- marcaba 'chatarra' y ahí terminaba todo: nadie quedaba notificado, no se
-- creaba registro en el programa de limpieza y la pieza no llegaba nunca a
-- pesarse ni despacharse. Quedaba con una etiqueta y en el limbo.
--
-- El puente no era una línea de código que faltara, sino una decisión: los dos
-- flujos no hablan el mismo idioma. Fase 1 mueve KILOS de una CATEGORÍA desde
-- un PATIO; Fase 2 vende UNA PIEZA con SKU ubicada en un sitio. Convertir lo
-- uno en lo otro exige clasificar y pesar la pieza, y eso lo hace una persona
-- mirándola, no el sistema.
--
-- Por eso el componente convertido cae en una bandeja de "pendiente de
-- clasificar". Al clasificarlo se le asigna patio, categoría y peso estimado, y
-- recién ahí se crea el registro en `programa` que manda a la cuadrilla a
-- buscarlo. `programa_id` distingue lo derivado de lo que sigue pendiente.
--
-- Aditiva: no altera datos existentes. Los componentes ya marcados 'chatarra'
-- quedan como pendientes de clasificar, que es justamente lo que son.
-- ============================================================================

alter table componentes add column if not exists chatarra_el      timestamptz;
alter table componentes add column if not exists chatarra_motivo  text;

-- Datos que Fase 1 exige y que el componente no tenía: se piden al clasificar.
alter table componentes add column if not exists patio_id         bigint references patios(id);
alter table componentes add column if not exists categoria_id     bigint references categorias(id);
alter table componentes add column if not exists peso_estimado_kg numeric(12,1);

-- Registro de Fase 1 que originó la derivación. Nulo = pendiente de clasificar.
alter table componentes add column if not exists programa_id      bigint references programa(id);
alter table componentes add column if not exists clasificado_el   timestamptz;
alter table componentes add column if not exists clasificado_por  text;

create index if not exists ix_componentes_chatarra
  on componentes(estado) where estado = 'chatarra';

-- Las ofertas de una publicación que se cierra sin adjudicar quedaban en
-- 'recibida' para siempre, y su oferente nunca recibía respuesta. Al convertir
-- se marcan 'descartada' y se les avisa por correo.
