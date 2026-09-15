# GEA · Plataforma de enajenación de activos — Minera Escondida

Plataforma oficial. **Fase 1: proceso de enajenación de chatarra**, según los
flujos levantados con MEL: retiro en patios (HOP01/LD01/CLS01), despacho con
pesaje a **La Negra**, recepción y clasificación del vendor, traslado a
**Lampa** con certificado de disposición final, cuadratura semanal del ITO y
ciclo completo del estado de pago (generación → revisión/ajustes → firma →
factura → pago < 15 días → conciliación).

## Puesta en marcha

1. **Crear el proyecto Supabase** (exclusivo para la plataforma; no compartir
   con la demo). En el *SQL Editor* ejecutar, en orden:
   - `db/0001_schema.sql` (tablas, folios, RLS)
   - `db/0002_seed.sql` (patios, categorías, sitios, precios iniciales)

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

## Roles (Fase 1)

| Rol | Alcance |
|---|---|
| `limpieza` | Programa semanal, despachos desde patios MEL |
| `vendor` | Recepciones La Negra, traslados y recepción Lampa, factura y pago del EP |
| `ito` | Revisión de guías, resolución de observados, cuadratura, generación del EP |
| `coordinador` | Firma/ajustes del EP, conciliación, precios, todo el proceso |

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
