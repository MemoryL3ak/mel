-- ============================================================
-- GEA · Seed de maestros — Fase 1 chatarra
-- Ejecutar después de 0001_schema.sql. Los usuarios se crean con
-- `npm run setup:users` (las contraseñas se cifran con bcrypt).
-- ============================================================

insert into patios (codigo, nombre, tipo) values
  ('HOP01', 'Patio HOP01',                     'origen'),
  ('LD01',  'Patio LD01',                      'origen'),
  ('CLS01', 'Patio CLS01',                     'origen'),
  ('PC',    'Patio central de clasificación',  'central');

insert into sitios (codigo, nombre) values
  ('LN', 'La Negra'),
  ('LP', 'Lampa');

-- Encabezado y firmas del estado de pago. Confirmar con MEL antes del go-live.
insert into contrato (id, numero, gerencia, glosa, mandante, contratista,
                      firma_mandante, firma_contratista)
values (1, '9100078390', 'GERENCIA W&L', 'ADJUDICACIÓN LICITACIÓN DE CHATARRA',
        'MINERA ESCONDIDA LIMITADA', 'SOCIEDAD DE PROCESAMIENTO IND. S.A.',
        'Cristian Barra T.', 'Rafael Ahumada');

insert into categorias (nombre) values
  ('Fierro pesado'),
  ('Fierro liviano / mixto'),
  ('Acero inoxidable'),
  ('Cables forrados'),
  ('Bronce'),
  ('Aluminio');

-- Tabla de precios del contrato ($/kg). Ajustar con los valores reales tras
-- la reunión R1 (levantamiento del proceso de chatarra).
--
-- Cada categoría trae su vigencia anterior además de la actual: el historial de
-- precios no se sobrescribe, se apila, y así la pantalla muestra la variación.
--
-- Las fechas van referidas al día de la carga, no fijas, para que el semáforo de
-- vigencia se vea funcionando desde el primer día. Con los 3 meses de vigencia
-- que fija el contrato quedan dos categorías vencidas (rojo), dos que vencen
-- dentro de 15 días (amarillo) y dos con plazo holgado (verde).
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
