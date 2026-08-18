# GEA — Gestión de Enajenación de Activos

Prototipo funcional de la **Plataforma de Control de Enajenación de Chatarra y Venta de Componentes Obsoletos** para Minera Escondida Limitada (MEL), según la Cotización v2.0 (julio 2026) de Ariel Beroíza.

Aplicación full-stack con backend, base de datos, autenticación por roles y frontend React — todo corre en local sin servicios externos.

## Stack

| Capa | Tecnología | Nota |
|---|---|---|
| Backend | Node.js 22+ · Express | API REST con JWT y RBAC verificado en el servidor |
| Base de datos | SQLite (`node:sqlite`, incluido en Node) | Espejo local del modelo productivo **PostgreSQL + RLS** de la cotización |
| Frontend | React 18 · Vite · React Router | Sistema de diseño GEA (cobre sobre grafito) |
| Documentos | Multer | Carga real de archivos con versionado |

## Ejecutar en local

Requisitos: **Node.js 22.13+** (se usa el módulo nativo `node:sqlite`; con Node 24 funciona sin banderas).

```bash
npm run install:all   # instala raíz, server y client
npm run dev           # API en :4001 + Vite en :5173 (proxy /api)
```

Abrir **http://localhost:5173**.

Alternativa "producción local" en un solo puerto:

```bash
npm run build         # compila el cliente a client/dist
npm start             # la API sirve la SPA en http://localhost:4001
```

La base de datos se crea y se puebla sola en el primer arranque (`server/data/gea.sqlite`). Para volver a los datos de demostración:

```bash
npm run seed:reset
```

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
- **Obsoletos + portal (F3)**: inventario con ubicación en terreno; publicación con plazo; **regla de los 15 días ejecutada por el servidor** (job al arrancar y cada hora: convierte a chatarra, genera el documento de baja y lo audita); cuadro comparativo, matriz de evaluación ponderada con puntajes sugeridos desde los datos, certificado de adjudicación foliado, bandeja de pendientes de entrega; portal público sin credenciales, registro de compradores y ofertas del comprador autenticado.
- **Indicadores (F4)**: KPI de despachos y pagos y panel de obsoletos calculados en vivo desde la base.
- **Transversal**: bitácora de auditoría inmutable (cada mutación la escribe el servidor), seis roles con permisos por endpoint, matriz de permisos.

## Estructura

```
server/   API Express · src/db.js (esquema + seed) · src/routes/*
client/   SPA React · src/pages/* (12 pantallas + login)
prototipo/  Maqueta estática original (artifact de referencia visual)
```

## Diferencias asumidas frente a producción

SQLite en lugar de PostgreSQL gestionado (mismo modelo relacional; el RBAC por endpoint representa las políticas RLS), contraseñas planas de demo, correo/notificaciones y exportación Excel/PDF simulados en la interfaz. Todo lo demás sigue el alcance de la Sección 2 de la cotización.
