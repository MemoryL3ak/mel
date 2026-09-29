-- ============================================================================
-- 0008_memos.sql · Memo de baja: el origen del inventario obsoleto
-- ============================================================================
-- En el proceso de enajenación, el flujo no arranca en la plataforma: arranca
-- cuando el área usuaria generadora emite un memo firmado con la lista de
-- componentes obsoletos. Hasta ahora los componentes se cargaban sueltos, sin
-- respaldo de quién autorizó dar de baja cada activo.
--
-- El memo cumple dos funciones:
--   1. Trazabilidad: cada componente apunta al documento firmado que lo autoriza.
--   2. Conciliación de terreno: el memo declara una lista esperada, y la empresa
--      de limpieza de patios confirma cuáles encontró. Sin esa lista no se puede
--      representar el "¿componentes encontrados? Sí / No" del diagrama, porque
--      un componente que nunca apareció simplemente no se ingresaba.
--
-- Lo carga el Coordinador Logístico MEL, que es quien recibe el memo del área
-- usuaria. No se crean cuentas para las áreas generadoras: el área emisora queda
-- registrada como dato del memo.
--
-- Aditiva: no altera datos existentes. Los componentes ya cargados quedan con
-- memo_id nulo y se muestran como "sin memo".
-- ============================================================================

create table if not exists memos (
  id            bigint generated always as identity primary key,
  folio         text not null unique,          -- MEMO-#### (correlativo interno)
  area_usuaria  text not null,                 -- área generadora que emite el memo
  emitido_por   text,                          -- quien firma
  referencia    text,                          -- n° o código del memo en el área
  fecha_memo    date not null,
  observaciones text,
  doc           int not null default 0,        -- PDF firmado en evidencia/MEMO/<id>/
  estado        text not null default 'recibido'
                check (estado in ('recibido', 'en_identificacion', 'cerrado')),
  creado_por    text,
  creado_el     timestamptz not null default now()
);

-- Cada componente cuelga del memo que lo autorizó.
alter table componentes add column if not exists memo_id bigint references memos(id);
create index if not exists ix_componentes_memo on componentes(memo_id);

-- Estados de terreno: un componente declarado en el memo puede no aparecer.
-- 'por_identificar' es donde nace cuando viene de un memo; 'no_encontrado' es
-- el lado NO del decisor del diagrama, que hasta ahora no tenía dónde caer.
alter table componentes drop constraint if exists componentes_estado_check;
alter table componentes add constraint componentes_estado_check
  check (estado in ('por_identificar', 'no_encontrado', 'planificado',
                    'publicado', 'adjudicado', 'entregado', 'chatarra'));

-- Motivo de por qué un componente del memo no se encontró en terreno.
alter table componentes add column if not exists nota_terreno text;

-- Folio del memo.
insert into folios (tipo, ultimo) values ('MEMO', 0)
  on conflict (tipo) do nothing;

-- ===================== RLS =====================
-- El backend usa la clave de servicio (bypass de RLS); las políticas protegen
-- ante accesos directos con claves de menor privilegio. El vendor puede leer el
-- memo (necesita saber el origen de lo que publica), pero cargarlo es de MEL:
-- esa separación se aplica en el backend, no acá.
alter table memos enable row level security;

create policy obs_memos_rw on memos for all
  using (app_role() in ('coordinador', 'admin_venta'));
