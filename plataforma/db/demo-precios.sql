-- ============================================================
-- GEA · Vigencias de precio escalonadas (ambiente de demostración)
-- ============================================================
-- Deja el semáforo de la pantalla de Valorización con sus tres estados a la
-- vez: dos categorías vencidas (rojo), dos que vencen dentro de 15 días
-- (amarillo) y dos con plazo holgado (verde). Los precios actuales son los
-- mismos de la carga inicial; lo que cambia es desde cuándo rigen, y cada
-- categoría gana su vigencia anterior para que el historial muestre variación.
--
-- Equivale a `npm run demo:precios -- --confirmar` desde el servidor.
--
-- OJO: borra el historial de precios, que en la operación normal nunca se
-- sobrescribe. No correr en producción.
--
-- Los despachos ya recepcionados no se tocan: cada uno guarda su precio
-- congelado en despachos.precio_kg.

delete from precios;

insert into precios (categoria_id, precio_kg, vigente_desde, creado_por)
select c.id, p.precio, current_date - p.dias_atras, p.autor
from categorias c
join (values
  -- categoría                  precio   días atrás  quién la registró
  ('Fierro pesado',            172.00,  260, 'Carga inicial'),
  ('Fierro pesado',            185.00,  131, 'Coordinador Logístico MEL'),  -- vencido hace ~40 d
  ('Fierro liviano / mixto',   128.00,  260, 'Carga inicial'),
  ('Fierro liviano / mixto',   120.00,  122, 'Coordinador Logístico MEL'),  -- vencido hace ~31 d
  ('Acero inoxidable',         610.00,  250, 'Carga inicial'),
  ('Acero inoxidable',         650.00,   87, 'Coordinador Logístico MEL'),  -- vence en ~4 d
  ('Cables forrados',         2250.00,  250, 'Carga inicial'),
  ('Cables forrados',         2400.00,   82, 'Coordinador Logístico MEL'),  -- vence en ~9 d
  ('Bronce',                  3980.00,  240, 'Carga inicial'),
  ('Bronce',                  4200.00,   34, 'Coordinador Logístico MEL'),  -- vigente
  ('Aluminio',                1210.00,  240, 'Carga inicial'),
  ('Aluminio',                1150.00,   13, 'Coordinador Logístico MEL')   -- vigente
) as p(nombre, precio, dias_atras, autor) on p.nombre = c.nombre;
