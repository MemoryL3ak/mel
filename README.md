# GEA — Gestión de Enajenación de Activos

Prototipo funcional de la **Plataforma de Control de Enajenación de Chatarra y Venta de Componentes Obsoletos** para Minera Escondida Limitada (MEL), según la Cotización v2.0 (julio 2026) de Ariel Beroíza.

Aplicación full-stack: backend Express, base de datos **PostgreSQL en Supabase** (la arquitectura gestionada que indica la cotización), autenticación por roles y frontend React.

## Stack

| Capa | Tecnología | Nota |
|---|---|---|
| Backend | Node.js 22+ · Express | API REST con JWT y RBAC verificado en el servidor |
| Base de datos | PostgreSQL gestionado (Supabase) | Esquema + seed + RLS en `server/db/supabase.sql`; regla de 15 días como función SQL |
| Frontend | React 18 · Vite · React Router | Sistema de diseño GEA (cobre sobre grafito) |
| Documentos | Multer (disco local) | En producción: Supabase Storage |

## Puesta en marcha

Requisitos: **Node.js 22.13+** y un proyecto en [Supabase](https://supabase.com).

1. **Base de datos**: en el SQL Editor de Supabase, ejecutar completo [`server/db/supabase.sql`](server/db/supabase.sql). Es re-ejecutable: recrea el esquema con los datos de demostración (sirve también como *reset* de la demo).
2. **Credenciales**: copiar `server/.env.example` a `server/.env` con la URL del proyecto y la **secret key** (Project Settings → API Keys). La secret key solo vive en el servidor.
3. **Ejecutar**:

```bash
npm run install:all   # instala raíz, server y client
npm run dev           # API en :4001 + Vite en :5173 (proxy /api)
```

Abrir **http://localhost:5173**. Alternativa "producción local" en un solo puerto:

```bash
npm run build && npm start   # la API sirve la SPA en http://localhost:4001
```

Utilidades de demo: `npm run demo:refresh` re-ancla las fechas del seed a hoy y restaura los estados canónicos (ideal antes de presentar o tras ensayar); `?demo=<usuario>` en la URL inicia sesión directa con ese perfil (ej. `http://localhost:4001/?demo=coordinador`).

Opcional: para que la regla de los 15 días corra también sin el servidor encendido, habilitar **pg_cron** en Supabase y programar `select convertir_vencidos()` (la línea exacta está comentada en el script SQL).

## Usuarios de demostración

Contraseña de todos: **`demo`**. Cada perfil ve solo sus módulos (RBAC en cliente y servidor).

| Usuario | Perfil | Qué puede hacer |
|---|---|---|
| `coordinador` | Coordinador Logístico MEL | Todo: aprueba/rechaza EP, ve auditoría e indicadores |
| `ito` | ITO | Valida despachos, aplica descuentos, genera el EP |
| `limpieza` | Empresa de limpieza de patios | Programa semanal, registro de retiros con evidencia |
| `vendor` | Vendor de chatarra | Despachos valorizados, EP, registro de pagos |
| `adminventa` | Adm. Plataforma de Venta Web | Publica, evalúa ofertas, adjudica |
| `comprador` | Comprador externo | Portal público, presenta ofertas, sigue su estado |

## Qué está implementado (funcional, no simulado)

- **Chatarra (F1)**: programa de limpieza con registro de ejecución; despachos con foliado automático de guía; recepción con validación de peso (>2% de diferencia queda *observada*); valorización automática con la tabla de precios del contrato; **generación del EP desde los despachos del período**, descuentos con recálculo, aprobación/rechazo con observación obligatoria y conciliación de pagos del vendor.
- **Documental (F2)**: repositorio con carga real de archivos, versionado automático por hito, control de vencimientos y descarga.
- **Obsoletos + portal (F3)**: inventario con ubicación en terreno; publicación con plazo; **regla de los 15 días como función PostgreSQL** (`convertir_vencidos()`: convierte a chatarra, genera el documento de baja y lo audita; se dispara al arrancar, cada hora y opcionalmente vía pg_cron); cuadro comparativo, matriz de evaluación ponderada con puntajes sugeridos desde los datos, certificado de adjudicación foliado, bandeja de pendientes de entrega; portal público sin credenciales, registro de compradores y ofertas del comprador autenticado.
- **Indicadores (F4)**: KPI de despachos y pagos y panel de obsoletos calculados en vivo desde la base.
- **Transversal**: bitácora de auditoría inmutable, seis roles con permisos por endpoint, **RLS habilitado en todas las tablas** con políticas base (el servidor opera con la secret key; las políticas quedan listas para acceso directo de clientes con Supabase Auth).

## Estructura

```
server/            API Express
  db/supabase.sql  Esquema PostgreSQL + seed + función de 15 días + RLS
  src/supa.js      Capa de datos (supabase-js, secret key)
  src/routes/*     Módulos: auth, chatarra, documental, obsoletos, portal, indicadores
client/            SPA React · src/pages/* (12 pantallas + login)
prototipo/         Maqueta estática original (artifact de referencia visual)
```

## Diferencias asumidas frente a producción

Contraseñas planas de demo (producción: Supabase Auth con credenciales corporativas), archivos del repositorio documental en disco local (producción: Supabase Storage), correo/notificaciones y exportación Excel/PDF simulados en la interfaz, y políticas RLS base (el set completo por rol/acción es parte de la Fase 1). Todo lo demás sigue el alcance de la Sección 2 de la cotización.
