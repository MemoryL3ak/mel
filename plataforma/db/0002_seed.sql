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

-- Tabla de precios inicial del contrato ($/kg). Ajustar con los valores
-- reales tras la reunión R1 (levantamiento del proceso de chatarra).
insert into precios (categoria_id, precio_kg, vigente_desde, creado_por)
select c.id, p.precio, current_date, 'Carga inicial'
from categorias c
join (values
  ('Fierro pesado',           185.00),
  ('Fierro liviano / mixto',  120.00),
  ('Acero inoxidable',        650.00),
  ('Cables forrados',        2400.00),
  ('Bronce',                 4200.00),
  ('Aluminio',               1150.00)
) as p(nombre, precio) on p.nombre = c.nombre;
