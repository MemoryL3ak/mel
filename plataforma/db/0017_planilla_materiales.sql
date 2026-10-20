-- ============================================================================
-- 0017_planilla_materiales.sql · Importación de la planilla de materiales
-- ============================================================================
-- MEL lleva su inventario de obsoletos en una planilla propia (una fila por
-- material SAP, con cantidad, bodega, valor contable y el seguimiento en
-- terreno). La plataforma pasa a importarla tal cual, y para eso el componente
-- guarda lo que la planilla trae y la plataforma no tenía:
--
--   · valor contable SAP en pesos (precio unitario y monto), distinto del
--     valor referencial de venta en USD;
--   · área, sub-área, planta y datos SAP (storage location, MRP);
--   · el estado tal como lo escribe la planilla y la cantidad no encontrada
--     (la encontrada, enviada y recibida existen desde 0010);
--   · guías GD y GV, fechas de encontrado y de último despacho, responsable
--     del conteo y si SAP ya tiene ficha técnica.
--
-- Puerto Coloso entra como sitio: la planta B521 guarda sus materiales ahí.
--
-- Aditiva: no altera datos existentes.
-- ============================================================================

alter table componentes add column if not exists precio_unitario_clp numeric(14,0);
alter table componentes add column if not exists monto_clp           numeric(14,0);
alter table componentes add column if not exists area                text;
alter table componentes add column if not exists subarea             text;
alter table componentes add column if not exists planta              text;
alter table componentes add column if not exists storage_location    text;
alter table componentes add column if not exists mrp_controller      text;
alter table componentes add column if not exists mrp_type            text;
alter table componentes add column if not exists estado_planilla     text;
alter table componentes add column if not exists cant_no_encontrada  int;
alter table componentes add column if not exists guias_gd            text;
alter table componentes add column if not exists guias_gv            text;
alter table componentes add column if not exists encontrado_el       date;
alter table componentes add column if not exists despachado_el       date;
alter table componentes add column if not exists responsable_terreno text;
alter table componentes add column if not exists ficha_sap           boolean;
alter table componentes add column if not exists importado_el        timestamptz;

insert into sitios (codigo, nombre) select 'COL', 'Puerto Coloso'
  where not exists (select 1 from sitios where codigo = 'COL');
