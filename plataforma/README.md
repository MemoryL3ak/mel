# GEA · Plataforma de enajenación de activos — Minera Escondida

Plataforma oficial. **Fase 1: proceso de enajenación de chatarra**, según los
flujos levantados con MEL: retiro en patios (HOP01/LD01/CLS01), despacho con
pesaje a **La Negra**, recepción y clasificación del vendor, traslado a
**Lampa** con certificado de disposición final, cuadratura semanal del ITO y
ciclo completo del estado de pago (generación → revisión/ajustes → firma →
factura → pago < 15 días → conciliación).

**Fase 2: venta de componentes obsoletos.** Inventario de componentes con
ubicación en terreno, publicaciones con **regla de 15 días** (sin adjudicar al
plazo, el componente se convierte en chatarra y pasa a enajenación), **portal
público** de consulta y oferta (registro + due diligence para ofertar), y
**adjudicación** con matriz de evaluación ponderada, certificado y comisión de
venta al vendor, con flujo posterior de pago y entrega.

**Fase 3: repositorio documental.** Los 9 tipos documentales de chatarra y los
14 de obsoletos, cada documento **vinculado al hito** que respalda (guía,
traslado, estado de pago, memo, comprador, publicación, adjudicación,
componente o contrato), con **versiones inmutables**, **control de
vencimientos** (aviso en el panel y por correo) y bandeja de **pendientes**:
lo que ya debería estar cargado según el estado de cada hito. El catálogo de
tipos (quién carga, quién consulta, si vence y cuándo es exigible) lo ajusta
el coordinador desde la pantalla.

## Puesta en marcha

1. **Crear el proyecto Supabase** (exclusivo para la plataforma; no compartir
   con la demo). En el *SQL Editor* ejecutar, en orden:
   - `db/0001_schema.sql` (tablas, folios, RLS)
   - `db/0002_seed.sql` (patios, categorías, sitios, precios iniciales)
   - `db/0003_ep_contrato.sql` · `db/0004_operacion.sql` · `db/0005_precio_tm.sql`
   - `db/0006_review.sql` (observaciones del review: tara de origen, doble control de
     cuadratura, rol Lampa, código interno, adjunto CDF)
   - `db/0007_obsoletos.sql` (Fase 2: obsoletos, publicaciones, ofertas, adjudicación,
     roles `admin_venta` y `comprador`, comisión al vendor)
   - `db/0008_memos.sql` … `db/0014_despacho_obs.sql` (ajustes de las fases 1 y 2)
   - `db/0015_documental.sql` (Fase 3: catálogo de 23 tipos documentales,
     documentos y versiones)
   - `db/0016_despacho_pendiente.sql` (despacho «pendiente de guía» de un
     obsoleto derivado a chatarra; patio La Negra)
   - `db/0017_planilla_materiales.sql` (importación de la planilla de
     materiales: valor SAP en pesos, área, planta, estado de terreno por
     cantidades; sitio Puerto Coloso)

   Después de aplicar `0015`, desde `server/` correr `npm run indexar:documentos`:
   registra en el repositorio las guías, certificados, respaldos, actas y memos
   que se subieron antes. Se puede repetir sin duplicar nada.

   El seed carga las vigencias de precio escalonadas respecto del día de la
   carga, para que el semáforo de la pantalla de Valorización se vea con sus
   tres estados: dos categorías vencidas, dos por vencer y dos vigentes. En una
   base ya cargada, `db/demo-precios.sql` (o `npm run demo:precios -- --confirmar`
   desde `server/`) deja ese mismo estado. Antes del go-live hay que reemplazar
   estos precios por los reales del contrato.

2. **Configurar el servidor**
   ```
   cd server
   copy .env.example .env
   ```
   Completar `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (clave `sb_secret_...`,
   solo servidor, jamás al repositorio) y un `JWT_SECRET` largo y aleatorio.

3. **Instalar y crear usuarios**
   ```
   npm install            (en la raíz: instala concurrently)
   npm run install:all
   npm run setup:users    (agregar -- --demo para contraseña fija de prueba)
   ```
   Las contraseñas se muestran UNA sola vez; repartirlas por canal seguro.

4. **Desarrollo**: `npm run dev` → API en :4100, web en :5273 (proxy /api).
   **Producción local**: `npm run build && npm start` → todo en :4100.

## Estructura

```
db/        migraciones SQL (esquema + seed) para Supabase
server/    API Express — auth bcrypt+JWT, RBAC por acción, auditoría
client/    React + Vite — sistema de diseño GEA
```

## Roles

| Rol | Alcance |
|---|---|
| `limpieza` | Programa semanal, despachos desde patios MEL |
| `vendor` | Recepciones La Negra, traslados y recepción Lampa, factura y pago del EP |
| `ito` | Revisión de guías, resolución de observados, cuadratura, generación del EP, programa |
| `coordinador` | Firma/ajustes del EP, conciliación, precios, obsoletos, todo el proceso |
| `lampa` | Confirmación (doble control) de la cuadratura, recepción en Lampa |
| `admin_venta` | Fase 2: inventario, publicaciones, ofertas/adjudicación, compradores |

Todos los perfiles internos entran al repositorio documental, y cada uno ve y
carga solo los tipos que le asigna el catálogo (`doc_tipos`).
| `comprador` | Portal público (registro + oferta); reservado para acceso futuro |

## Reglas de negocio implementadas

- Folios correlativos race-safe en la base (`next_folio`): GD, GT y CDF.
- Valorización congelada: el precio vigente se fija al recepcionar en La Negra
  (con la categoría final si hubo reclasificación); los cambios de precio no
  alteran guías ya valorizadas.
- Diferencia de peso > 2% ⇒ recepción observada; la resuelve el ITO con
  observación obligatoria.
- Cuadratura semanal con snapshot inmutable; con diferencias exige observación.
- EP: transiciones validadas por estado y por rol; devolución con ajustes
  requiere observación; conciliación con pago incompleto también.
- Bitácora de auditoría: solo inserción; RLS activo en todas las tablas.

### Fase 2 · Obsoletos

- Folios `OBS` (componente) y `CA` (certificado de adjudicación) por `next_folio`.
- Publicación con plazo (15 días por defecto); al cumplirse sin adjudicar, acción
  de conversión a chatarra que da de baja el activo y lo deriva a enajenación.
- Portal público: consulta sin credenciales; para ofertar se exige comprador con
  **due diligence aprobada** (identificado por RUT + correo registrado). Límite de
  tasa por IP en `/api/portal`.
- Adjudicación: puntajes 1–10 por criterio, ponderados por la matriz configurable;
  la matriz queda **congelada** en el certificado. Comisión al vendor = % del
  contrato sobre el monto adjudicado. Flujo posterior: pago → entrega (guía).

### Fase 3 · Repositorio documental

- Folio `DOC` por `next_folio`. Archivos en el bucket privado `documentos`,
  servidos con URL firmada: PDF, imagen, Excel o Word hasta 20 MB por el
  servidor, y videos (MP4, MOV, WebM) o archivos grandes hasta 500 MB que el
  navegador sube directo al almacenamiento con una URL firmada de subida
  (`POST /documentos/subida`) y después registra con el documento. El límite
  por archivo del proyecto Supabase (Storage → Settings) debe permitirlo.
- Cada carga es una **versión nueva**; las anteriores no se modifican ni se
  borran. Un documento no se elimina: se **anula** con motivo (coordinador).
- Vencimiento: vigente / por vencer (dentro del aviso del tipo) / vencido. El
  barrido de cada 6 h avisa por correo una vez al entrar en «por vencer» y otra
  al vencer, a quienes cargan ese tipo y al coordinador (`APP_URL` para el enlace).
- Los flujos que ya adjuntaban archivos (guía al despachar, CDF en Lampa,
  respaldos de descuentos, acta de entrega, memo firmado) los registran también
  en el repositorio, sin copiarlos.
- Pendientes: un tipo es exigible cuando su hito está en los estados que marca
  el catálogo (p. ej. la factura del EP desde «facturado»).
- Prueba E2E: `npm run test:documental` (firma sus propias sesiones y borra lo
  que crea).

### Planilla de materiales de MEL

MEL lleva su inventario de obsoletos en una planilla propia (Excel `.xlsx` o
CSV separado por `;`, una fila por material SAP). En **Inventario → «Importar planilla de
materiales»** se sube tal cual: la plataforma muestra una vista previa agrupada
por área y sub-área, se elige el memo de baja de cada grupo (uno existente o
uno nuevo) y se importa. Solo entran las filas con «Aprobado = Sí». Reimportar
la misma planilla actualiza por código SAP (cantidades, estado de terreno,
ubicación, datos SAP) sin duplicar; los componentes que ya avanzaron en la
plataforma conservan su estado y su memo. El valor contable SAP se guarda en
pesos, aparte del valor referencial de venta en USD. El lector vive en
`server/src/planilla.js`.
