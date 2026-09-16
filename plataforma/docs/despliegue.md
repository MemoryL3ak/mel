# Despliegue — Vercel (frontend) + Railway (backend)

Arquitectura en producción:

```
Navegador ──▶ Vercel (React estático)  ──fetch──▶ Railway (Express /api) ──▶ Supabase (BD + Storage)
```

La sesión viaja en el header `Authorization` (sin cookies), por lo que basta CORS
con el dominio de Vercel como origen permitido.

## 0. Requisito previo

- Repositorio subido a GitHub (`git push -u origin main`).
- **Rotar la clave `sb_secret`** en Supabase (Settings → API keys) antes del
  go-live y usar la nueva en Railway. La antigua quedó comprometida.

## 1. Backend en Railway

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → elegir `MemoryL3ak/mel`.
2. En el servicio → **Settings → Root Directory**: `plataforma/server`.
   Railway detecta Node y usa `npm install` + `npm start` automáticamente.
3. **Variables** (pestaña Variables):

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://fjuctakhayioowcezeup.supabase.co` |
   | `SUPABASE_SECRET_KEY` | la clave `sb_secret_...` **rotada** |
   | `JWT_SECRET` | secreto largo y aleatorio (distinto al local) |
   | `CORS_ORIGIN` | se completa en el paso 3 con el dominio de Vercel |

   `PORT` no se define: Railway lo inyecta y el servidor lo lee.
4. **Settings → Networking → Generate Domain** → anotar la URL
   (ej. `gea-server-production.up.railway.app`).
5. Verificar: `https://<dominio-railway>/api/health` debe responder `{"ok":true,"fase":1}`.
6. Opcional: Settings → Health Check Path = `/api/health`.

## 2. Frontend en Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → importar `MemoryL3ak/mel`.
2. **Root Directory**: `plataforma/client` (Framework: Vite, detectado solo;
   build `npm run build`, salida `dist`).
3. **Environment Variables**:

   | Variable | Valor |
   |---|---|
   | `VITE_API_URL` | `https://<dominio-railway>/api` |

   > Es variable de *build*: si después cambia, hay que **Redeploy**.
4. Deploy → **anotar aquí el dominio real** que asigna Vercel. No inventarlo:
   el dominio de producción se lee en Vercel → Deployments → el que está
   marcado *Production*, o en Settings → Domains.

   > Dominio de producción: `________________.vercel.app`

## 3. Cerrar el círculo (CORS)

En Railway → Variables → `CORS_ORIGIN` = el dominio de Vercel con `https://` y
sin barra final; varios dominios van separados por coma (agregar el dominio
propio cuando exista). Railway redespliega solo.

## 4. Prueba de humo

1. Abrir el dominio de producción → login con un usuario real.
2. Crear un despacho con foto (valida Storage + multipart a través de CORS).
3. Abrir el detalle de la guía y ver la evidencia (valida URLs firmadas).

## Si un push a `main` no llega a producción

Ha pasado: Vercel recibe el commit, lo construye como **Preview** y no lo
promueve. El síntoma es que la aplicación sigue mostrando la versión anterior
aunque `git push origin main` diga `Everything up-to-date`.

Cómo distinguirlo de un problema de caché del navegador, sin adivinar:

```
curl -s https://api.github.com/repos/MemoryL3ak/mel/deployments?per_page=8
```

Cada despliegue trae su `environment` (`Preview` o `Production`) y su `sha`. Si
el último `Production` no es el commit que acaba de subir, el problema está en
Vercel y no en el navegador de nadie.

Para destrabarlo: Vercel → Deployments → el Preview de ese commit → `⋯` →
**Promote to Production**. Es inmediato y no recompila.

Para evitarlo: empujar a `main` y a `dev` por separado, no encadenados en el
mismo comando.

## Dominio propio (opcional)

- Vercel → Settings → Domains → agregar dominio y apuntar DNS según instrucciones.
- Agregar ese dominio a `CORS_ORIGIN` en Railway (separado por coma).

## Desarrollo local — sin cambios

`npm run dev` en `plataforma/` sigue igual: Vite proxya `/api` a
`localhost:4100`. `VITE_API_URL` y `CORS_ORIGIN` solo aplican en producción.
