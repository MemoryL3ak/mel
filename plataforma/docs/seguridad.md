# Seguridad y calidad — GEA Fase 1

Resumen de los controles implementados y de cómo verificarlos. Última
revisión: 10 de septiembre de 2026.

## Controles implementados

**Autenticación y sesiones**
- Contraseñas con hash bcrypt (nunca en texto plano; ni la plataforma puede leerlas).
- Sesiones JWT firmadas con secreto propio, expiración de 12 horas.
- Respuesta idéntica para "usuario no existe" y "clave incorrecta" (no se filtra qué cuentas existen).
- Límite de fuerza bruta: máximo 10 intentos fallidos por IP cada 15 minutos.
- Cuentas desactivables al instante por el Coordinador; auto-desactivación bloqueada.

**Autorización**
- Cada endpoint valida el rol en el servidor (la interfaz solo oculta, el servidor es quien niega).
- Matriz de permisos por rol verificada con pruebas negativas automatizadas.
- Políticas de seguridad a nivel de fila (RLS) definidas en PostgreSQL como
  segunda capa. Nota: el servidor opera con la clave de servicio, por lo que la
  autorización efectiva es la de la capa Express; las políticas quedan como
  defensa en profundidad ante accesos directos a la base.

**Datos e integridad**
- Folios (GD/GT/CDF/EP) generados atómicamente en la base: sin duplicados bajo concurrencia.
- Precio congelado al recepcionar: cambios de tarifa no alteran guías valorizadas.
- Carga masiva del programa: inserción todo-o-nada.
- Auditoría solo-inserción: la bitácora no se puede editar ni borrar desde la aplicación.
- Evidencia fotográfica en bucket privado; se sirve con URLs firmadas que expiran en 1 hora.
- Tipos y tamaño de archivo restringidos en la subida (JPEG/PNG/WebP, 5 MB, máx. 6 por guía).

**Transporte y cabeceras**
- HTTPS en ambos extremos (Vercel y Railway lo imponen).
- Cabeceras de seguridad HTTP vía helmet (nosniff, HSTS, frame deny, etc.).
- CORS restringido por lista explícita de orígenes (`CORS_ORIGIN`); sin cookies —
  el token viaja solo en el header Authorization, lo que además neutraliza CSRF.

**Secretos**
- Ningún secreto en el repositorio (`.env` ignorado por git; verificado).
- Secretos distintos entre desarrollo y producción.

## Cómo verificar

```bash
# Suite E2E completa (28 pruebas): levanta el servidor en un puerto de prueba,
# ejercita la API real y elimina todos los datos que crea.
cd plataforma/server && npm test

# Dependencias sin vulnerabilidades conocidas (resultado al 10-09-2026: 0 en ambos)
cd plataforma/server && npm audit
cd plataforma/client && npm audit
```

El pipeline de CI (`.github/workflows/ci.yml`) repite la auditoría de
dependencias, el chequeo de sintaxis del servidor y el build del cliente en
cada push a `main` y `dev`.

## Pendientes conocidos

- Rotar la clave de servicio de Supabase antes del go-live y tras cualquier exposición.
- Las cuentas de marcha blanca (clave compartida) se eliminan al crear las cuentas reales.
- Monitoreo/alertas de producción: usar los paneles de Railway y Vercel; evaluar
  alerta externa de disponibilidad si MEL lo requiere.
