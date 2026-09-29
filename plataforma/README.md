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
