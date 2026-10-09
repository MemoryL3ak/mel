-- ============================================================================
-- 0015_documental.sql · Fase 3 · Repositorio documental
-- ============================================================================
-- Hasta ahora cada pantalla guardaba sus archivos en su propia carpeta del
-- bucket (GD/, CDF/, EPD/, ENT/, MEMO/) sin versiones, sin vencimientos y sin
-- una vista que juntara todo. Esta migración agrega el repositorio que exige
-- la cotización: los 9 tipos documentales de chatarra y los 14 de obsoletos,
-- cada documento vinculado al hito del proceso que respalda, con versionado y
-- control de vencimientos.
--
--   doc_tipos            catálogo configurable: a qué hito se vincula cada
--                        tipo, quién lo carga, quién lo ve, si vence y en qué
--                        estados del hito pasa a ser exigible.
--   documentos           un documento vinculado a un hito (EP, guía, traslado,
--                        adjudicación…). Su vencimiento vigente vive aquí.
--   documento_versiones  cada carga es una versión nueva e inmutable: la
--                        anterior se conserva para siempre.
--
-- Los archivos van al bucket privado 'documentos' (lo crea el servidor al
-- arrancar). Los que ya existían en 'evidencia' se registran apuntando a su
-- ruta original, sin copiarlos: por eso cada archivo guarda su bucket.
--
-- Aditiva: no altera datos existentes.
-- ============================================================================

create table if not exists doc_tipos (
  codigo          text primary key,
  proceso         text not null check (proceso in ('chatarra', 'obsoletos')),
  nombre          text not null,
  descripcion     text,
  -- Entidad del proceso a la que se vincula el documento.
  hito            text not null check (hito in ('contrato', 'despacho', 'traslado', 'estado_pago',
                                                'memo', 'componente', 'comprador', 'publicacion',
                                                'adjudicacion')),
  vence           boolean not null default false,   -- exige fecha de vencimiento al cargar
  vigencia_meses  int check (vigencia_meses > 0),   -- propone el vencimiento al cargar
  aviso_dias      int not null default 30 check (aviso_dias between 1 and 365),
  roles_carga     text[] not null default '{}',     -- quién carga y versiona
  roles_ver       text[] not null default '{}',     -- quién más lo consulta
  -- Estados del hito en que el documento ya debería estar cargado. Vacío =
  -- nunca se exige; el documento es opcional.
  exigible_en     text[] not null default '{}',
  responsable     text,                             -- quién debe aportarlo (texto libre)
  orden           int not null default 0,
  activo          boolean not null default true
);

create table if not exists documentos (
  id              bigint generated always as identity primary key,
  folio           text not null unique,             -- DOC-####
  tipo            text not null references doc_tipos(codigo),
  hito            text not null,
  ref_id          bigint not null,                  -- id de la entidad del hito
  ref_label       text,                             -- "CI-1024 · GD MEL 4531", "EP-2026-09"…
  titulo          text not null,
  version_actual  int not null default 1,
  vence_el        date,                             -- vencimiento vigente
  estado          text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  anulado_motivo  text,
  anulado_por     text,
  anulado_el      timestamptz,
  -- Avisos de vencimiento ya enviados. Se limpian al cargar una versión nueva
  -- para que el próximo vencimiento vuelva a avisarse.
  aviso_por_vencer_el timestamptz,
  aviso_vencido_el    timestamptz,
  creado_por      text,
  creado_el       timestamptz not null default now(),
  actualizado_el  timestamptz not null default now()
);
create index if not exists ix_documentos_hito on documentos(hito, ref_id);
create index if not exists ix_documentos_tipo on documentos(tipo);
create index if not exists ix_documentos_vence on documentos(vence_el) where estado = 'vigente';

create table if not exists documento_versiones (
  id            bigint generated always as identity primary key,
  documento_id  bigint not null references documentos(id) on delete cascade,
  version       int not null,
  -- [{ bucket, path, nombre, mime, bytes }]: una versión puede tener varias
  -- páginas escaneadas o un PDF más sus anexos.
  archivos      jsonb not null default '[]',
  vence_el      date,                               -- vencimiento declarado en esta versión
  nota          text,                               -- qué cambia respecto de la anterior
  subido_por    text,
  subido_rol    text,
  subido_el     timestamptz not null default now(),
  unique (documento_id, version)
);

insert into folios (tipo, ultimo) values ('DOC', 0)
  on conflict (tipo) do nothing;

-- ===================== catálogo inicial =====================
-- Responsables, vencimientos y exigibilidad son una propuesta razonable para
-- arrancar: el coordinador los ajusta desde la pantalla "Tipos documentales"
-- sin tocar la base. on conflict do nothing: re-ejecutar no pisa lo ajustado.

insert into doc_tipos (codigo, proceso, nombre, descripcion, hito, vence, vigencia_meses, aviso_dias,
                       roles_carga, roles_ver, exigible_en, responsable, orden) values
  -- Proceso de chatarra (9)
  ('ch_contrato', 'chatarra', 'Contrato con vendor',
   'Contrato vigente de compra de chatarra y sus modificaciones.',
   'contrato', true, 12, 60, '{coordinador}', '{ito,vendor}', '{vigente}',
   'Coordinador Logístico MEL', 10),
  ('ch_guia_despacho', 'chatarra', 'Guía de despacho',
   'Guía que viaja con el camión desde el patio de MEL a La Negra.',
   'despacho', false, null, 30, '{limpieza,ito,coordinador}', '{vendor,lampa}',
   '{en_transito,recepcionado,observado}', 'Empresa de limpieza de patios', 20),
  ('ch_guia_venta', 'chatarra', 'Guía de venta',
   'Guía de venta del material asociada al despacho.',
   'despacho', false, null, 30, '{vendor,ito,coordinador}', '{lampa}', '{}',
   'Empresa vendor de chatarra', 30),
  ('ch_estado_pago', 'chatarra', 'Estado de pago firmado',
   'Formulario del estado de pago con las firmas del mandante y el contratista.',
   'estado_pago', false, null, 30, '{ito,coordinador}', '{vendor}',
   '{firmado,facturado,pagado,conciliado}', 'Coordinador Logístico MEL', 40),
  ('ch_descuentos', 'chatarra', 'Registro de descuentos',
   'Respaldo de los descuentos aplicados en el estado de pago.',
   'estado_pago', false, null, 30, '{ito,coordinador}', '{vendor}', '{}',
   'ITO', 50),
  ('ch_factura', 'chatarra', 'Factura de venta',
   'Factura emitida contra el estado de pago firmado.',
   'estado_pago', false, null, 30, '{vendor,coordinador}', '{ito}',
   '{facturado,pagado,conciliado}', 'Empresa vendor de chatarra', 60),
  ('ch_pago', 'chatarra', 'Registro de pago del vendor',
   'Comprobante de la transferencia del vendor a MEL.',
   'estado_pago', false, null, 30, '{vendor,coordinador}', '{ito}',
   '{pagado,conciliado}', 'Empresa vendor de chatarra', 70),
  ('ch_cdf', 'chatarra', 'Certificado de disposición final',
   'Certificado que emite Lampa al recibir el material en destino final.',
   'traslado', false, null, 30, '{vendor,lampa,coordinador}', '{ito}',
   '{recepcionado}', 'Responsable de Lampa', 80),
  ('ch_baja_scrap', 'chatarra', 'Comprobante de baja del activo (scrap)',
   'Baja contable del activo que se enajenó como chatarra.',
   'despacho', false, null, 30, '{coordinador}', '{ito}', '{}',
   'Coordinador Logístico MEL', 90),
  -- Proceso de componentes obsoletos (14)
  ('ob_memo', 'obsoletos', 'Memo firmado',
   'Memo del área usuaria que autoriza la baja de los componentes.',
   'memo', false, null, 30, '{coordinador}', '{admin_venta}',
   '{recibido,en_identificacion,cerrado}', 'Área usuaria generadora (lo carga el coordinador)', 110),
  ('ob_due_diligence', 'obsoletos', 'Due diligence del comprador',
   'Antecedentes legales y comerciales del comprador revisados antes de habilitarlo.',
   'comprador', true, 12, 30, '{coordinador,admin_venta}', '{}', '{aprobada}',
   'Administrador Plataforma de Venta', 120),
  ('ob_registro_ofertas', 'obsoletos', 'Registro de ofertas',
   'Acta o planilla con las ofertas recibidas al cierre de la publicación.',
   'publicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Administrador Plataforma de Venta', 130),
  ('ob_cert_adjudicacion', 'obsoletos', 'Certificado de adjudicación',
   'Certificado de adjudicación firmado.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Coordinador Logístico MEL', 140),
  ('ob_matriz', 'obsoletos', 'Matriz de evaluación',
   'Matriz de evaluación de ofertas con sus ponderaciones.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Administrador Plataforma de Venta', 150),
  ('ob_guia_despacho', 'obsoletos', 'Guía de despacho',
   'Guía con que el componente sale de MEL hacia el comprador.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{entregada}',
   'Coordinador Logístico MEL', 160),
  ('ob_guia_venta', 'obsoletos', 'Guía de venta',
   'Guía de venta del componente adjudicado.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Administrador Plataforma de Venta', 170),
  ('ob_cert_entrega', 'obsoletos', 'Certificado de entrega de componentes',
   'Acta de entrega firmada por el comprador al retirar.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{entregada}',
   'Administrador Plataforma de Venta', 180),
  ('ob_factura', 'obsoletos', 'Factura de venta',
   'Factura de venta del componente al comprador.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{pagada,entregada}',
   'Administrador Plataforma de Venta', 190),
  ('ob_pago', 'obsoletos', 'Pago por transferencia',
   'Comprobante de la transferencia del comprador.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{pagada,entregada}',
   'Administrador Plataforma de Venta', 200),
  ('ob_comision', 'obsoletos', 'Comisión de venta al vendor',
   'Respaldo del cálculo y pago de la comisión de venta.',
   'adjudicacion', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Coordinador Logístico MEL', 210),
  ('ob_baja_activo', 'obsoletos', 'Baja del activo fijo',
   'Baja contable del componente en el activo fijo de MEL.',
   'componente', false, null, 30, '{coordinador,admin_venta}', '{}', '{entregado}',
   'Coordinador Logístico MEL', 220),
  ('ob_conversion', 'obsoletos', 'Conversión a chatarra',
   'Respaldo de la conversión a chatarra de un componente no adjudicado.',
   'componente', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Administrador Plataforma de Venta', 230),
  ('ob_disposicion', 'obsoletos', 'Disposición final',
   'Certificado de disposición final del componente convertido a chatarra.',
   'componente', false, null, 30, '{coordinador,admin_venta}', '{}', '{}',
   'Coordinador Logístico MEL', 240)
on conflict (codigo) do nothing;

-- ===================== RLS =====================
-- El backend usa la clave de servicio (bypass de RLS); las políticas protegen
-- ante accesos directos con claves de menor privilegio. Cada rol ve solo los
-- tipos que carga o consulta, y escribe solo los que carga.
alter table doc_tipos           enable row level security;
alter table documentos          enable row level security;
alter table documento_versiones enable row level security;

create policy doc_tipos_read on doc_tipos for select
  using (app_role() in ('limpieza', 'vendor', 'ito', 'coordinador', 'lampa', 'admin_venta'));
create policy doc_tipos_admin on doc_tipos for all
  using (app_role() = 'coordinador');

create policy documentos_read on documentos for select
  using (exists (select 1 from doc_tipos t
                 where t.codigo = documentos.tipo
                   and app_role() = any (t.roles_carga || t.roles_ver)));
create policy documentos_write on documentos for all
  using (exists (select 1 from doc_tipos t
                 where t.codigo = documentos.tipo
                   and app_role() = any (t.roles_carga)));

create policy documento_versiones_read on documento_versiones for select
  using (exists (select 1 from documentos d join doc_tipos t on t.codigo = d.tipo
                 where d.id = documento_versiones.documento_id
                   and app_role() = any (t.roles_carga || t.roles_ver)));
create policy documento_versiones_write on documento_versiones for insert
  with check (exists (select 1 from documentos d join doc_tipos t on t.codigo = d.tipo
                      where d.id = documento_versiones.documento_id
                        and app_role() = any (t.roles_carga)));
