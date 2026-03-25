# Auditoria: Storage y Uploads

**Fecha:** 2026-03-25
**Alcance:** `storage.rules`, `functions/src/handlers/stars.ts` (upload flow), `functions/src/handlers/skies.ts` (delete cleanup), `frontend/src/lib/firebase/storage.ts`, `frontend/src/components/sky/StarFormSheet.tsx`, `frontend/src/components/sky/StarOverlay.tsx`
**Severidad general:** Media

## Resumen ejecutivo

El sistema de uploads tiene buenas protecciones en Storage Rules (tipo MIME, tamano, condicion de `imagePath == null`). Sin embargo, se identifican **1 critico** y **2 medios** relacionados con archivos huerfanos en un flujo de dos pasos (create star → upload → patch) y la falta de validacion de tipo MIME en el frontend antes del upload.

---

## Hallazgos

### [CRITICO] C1 — Archivos huerfanos: upload exitoso pero PATCH falla

- **Archivo:** `frontend/src/components/sky/StarFormSheet.tsx:107-118`
- **Descripcion:** El flujo de creacion de estrella con imagen es un proceso de 3 pasos NO atomicos:
  1. `POST /api/skies/{skyId}/stars` → crea la estrella con `imagePath: null`
  2. `uploadStarImage(skyId, starId, file)` → sube la imagen a Storage
  3. `PATCH /api/skies/{skyId}/stars/{starId}` → actualiza `imagePath` en Firestore

  Si el paso 2 (upload) tiene exito pero el paso 3 (PATCH) falla:
  - La imagen queda en Storage en `stars/{skyId}/{starId}/image`
  - La estrella en Firestore tiene `imagePath: null`
  - El archivo esta en Storage pero es inaccesible (nadie sabe que existe)
  - Las Storage rules permiten un nuevo upload porque `imagePath == null` (la regla de sobreescritura no aplica)

  Si el paso 2 falla, el frontend muestra `toast.warning('Estrella creada pero la imagen no se pudo subir')` y retorna — la estrella existe sin imagen, lo cual es un estado valido.

  **Pero el problema critico es el paso 2 exito + paso 3 fallo:** la imagen ocupa espacio en Storage sin referencia en Firestore. Con el tiempo, esto puede acumular archivos huerfanos que nunca se limpian.

- **Impacto:** Acumulacion de archivos huerfanos en Cloud Storage (costo de almacenamiento). No hay vulnerabilidad de seguridad, pero si un impacto economico gradual.
- **Recomendacion:** Varias opciones:
  1. **Retry del PATCH:** En el frontend, reintentar el PATCH si falla (ya esta parcialmente implementado — el catch en linea 114 no reintenta).
  2. **Limpieza backend:** Cloud Function programada que compare archivos en Storage con `imagePath` en Firestore y elimine huerfanos.
  3. **Invertir el flujo:** Primero subir imagen, luego crear estrella con imagePath en un solo POST (requiere cambio en el handler para aceptar multipart o un campo de upload pendiente).
  4. **TTL en Storage:** Configurar un lifecycle rule en el bucket que elimine archivos en `/stars/` despues de X dias si no tienen referencia (requiere metadata custom).

### [MEDIO] M1 — Frontend no valida tipo MIME antes del upload

- **Archivo:** `frontend/src/lib/firebase/storage.ts:11`, `frontend/src/components/sky/StarFormSheet.tsx:107-109`
- **Descripcion:** `uploadStarImage` envia `file.type` como `contentType` pero no valida que sea uno de los tipos permitidos (`jpeg`, `png`, `webp`). La validacion ocurre en Storage Rules:
  ```
  request.resource.contentType.matches('image/(jpeg|png|webp)')
  ```
  Si el usuario selecciona un archivo no permitido (ej: GIF, SVG), el upload falla en Storage Rules con un error generico de permisos. El usuario ve un mensaje confuso: `"Estrella creada pero la imagen no se pudo subir"`.
- **Impacto:** Mala experiencia de usuario. No hay riesgo de seguridad (las rules bloquean correctamente).
- **Recomendacion:** Validar en el frontend ANTES del upload:
  ```typescript
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
  if (!ALLOWED_TYPES.includes(file.type)) {
    toast.error('Formato no soportado. Usa JPEG, PNG o WebP.')
    return
  }
  ```
  Y limitar el `accept` del input file:
  ```html
  <input type="file" accept="image/jpeg,image/png,image/webp" />
  ```

### [MEDIO] M2 — Frontend no valida tamano antes del upload

- **Archivo:** `frontend/src/lib/firebase/storage.ts:11`, `frontend/src/components/sky/StarFormSheet.tsx`
- **Descripcion:** Similar a M1, el limite de 5MB se valida solo en Storage Rules:
  ```
  request.resource.size < 5 * 1024 * 1024
  ```
  Si el usuario sube un archivo de 10MB, el upload completo se transmite al servidor antes de ser rechazado.
- **Impacto:** Desperdicio de ancho de banda del usuario y mala UX. No hay riesgo de seguridad.
- **Recomendacion:** Validar tamano en el frontend:
  ```typescript
  const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
  if (file.size >= MAX_SIZE) {
    toast.error('La imagen no puede superar 5 MB.')
    return
  }
  ```
  Importar `STAR_IMAGE_MAX_SIZE_BYTES` del domain si esta disponible en frontend.

---

### [BAJO] B1 — Soft-delete de star NO elimina la imagen de Storage

- **Archivo:** `functions/src/handlers/stars.ts:392-404`
- **Descripcion:** Al eliminar una estrella (soft-delete), la imagen SI se elimina de Storage:
  ```typescript
  if (star.imagePath) {
    try {
      await storage.bucket().file(star.imagePath).delete()
    } catch {
      console.warn(`Failed to delete storage file: ${star.imagePath}`)
    }
  }
  ```
  Esto es correcto. Sin embargo, la estrella hace soft-delete (`deletedAt: now`) pero la imagen se elimina fisicamente. Si se quisiera implementar "restaurar estrella" en el futuro, la imagen ya no existiria.
- **Impacto:** Bajo. No hay funcionalidad de restauracion actualmente. La eliminacion de imagen es el comportamiento esperado.
- **Recomendacion:** Documentar la decision: "soft-delete de star = hard-delete de imagen". Si se necesita restauracion, considerar soft-delete de imagen tambien (mover a un path de "trash").

### [BAJO] B2 — `deleteSky` elimina imagenes en paralelo sin limite de concurrencia

- **Archivo:** `functions/src/handlers/skies.ts:296-306`
- **Descripcion:** Al eliminar un cielo, se crean promesas de eliminacion de imagen para TODAS las estrellas con imagen:
  ```typescript
  for (const doc of starsSnap.docs) {
    if (starData.imagePath) {
      imageDeletePromises.push(storage.bucket().file(starData.imagePath).delete()...)
    }
  }
  await Promise.allSettled(imageDeletePromises)
  ```
  Si un cielo tiene 100 estrellas con imagen, se lanzan 100 deletes simultaneos a Cloud Storage.
- **Impacto:** Bajo. Cloud Storage maneja bien la concurrencia. Podria impactar el rate limit de la API de Storage si hay muchos cielos eliminandose simultaneamente, pero es un escenario improbable.
- **Recomendacion:** Considerar batching con `Promise.all` en chunks de 10-20 si se observan problemas. No es urgente.

### [BAJO] B3 — `getDownloadURL` se llama en cada render de `StarOverlay`

- **Archivo:** `frontend/src/components/sky/StarOverlay.tsx:33-44`
- **Descripcion:** Cada vez que el componente se monta o `star.imagePath` cambia, se llama a `getDownloadURL(ref(storage, star.imagePath))`. Firebase SDK internamente cachea tokens de descarga, pero la llamada genera un round-trip al servidor para verificar el token.
- **Impacto:** Bajo. Firebase SDK cachea URLs de descarga. Pero si un cielo tiene 50 estrellas con imagen, se generan 50 llamadas a `getDownloadURL` al cargar.
- **Recomendacion:** Considerar cachear las URLs de descarga en un `Map` local o en estado del hook. No es urgente.

---

## Flujo completo de upload

```
CREAR ESTRELLA CON IMAGEN:
  Frontend:
  1. POST /api/skies/{skyId}/stars → { starId } (imagePath: null)
  2. uploadStarImage(skyId, starId, file) → sube a Storage
     Storage Rules validan:
     - request.auth != null ✅
     - canAttach() (miembro activo, owner o editor-de-su-star) ✅
     - imagePath == null en Firestore ✅
     - size < 5MB ✅
     - contentType matches jpeg|png|webp ✅
  3. PATCH /api/skies/{skyId}/stars/{starId} → { imagePath: path }
     Handler valida:
     - imagePath == canonical path ✅
     - star.imagePath === null (no sobreescritura) ✅

EDITAR ESTRELLA (agregar imagen):
  Frontend:
  1. uploadStarImage(skyId, starId, file) → sube a Storage
  2. PATCH incluye imagePath en body

ELIMINAR ESTRELLA:
  Backend:
  1. Soft-delete en Firestore (deletedAt: now) ✅
  2. Hard-delete imagen en Storage ✅
  3. Storage rules bloquean reads (deletedAt != null) ✅

ELIMINAR CIELO:
  Backend:
  1. Hard-delete stars de Firestore ✅
  2. Hard-delete imagenes de Storage (paralelo, best-effort) ✅
  3. Hard-delete members, revoke invites ✅
```

---

## Matriz de proteccion

| Vector | Storage Rules | Handler | Frontend |
|--------|--------------|---------|----------|
| **Tipo MIME invalido** | ✅ `contentType.matches(...)` | N/A (upload va directo a Storage) | ❌ Sin validacion |
| **Archivo > 5MB** | ✅ `size < 5 * 1024 * 1024` | N/A | ❌ Sin validacion |
| **Sobreescritura** | ✅ `imagePath == null` | ✅ `star.imagePath !== null → 409` | ✅ no muestra input si ya tiene imagen |
| **Acceso no autorizado** | ✅ `isActiveMember()` | ✅ `getSkyWithAccess()` | ✅ auth required |
| **Path traversal** | ✅ path fijo `stars/{skyId}/{starId}/image` | ✅ canonical path check | ✅ path generado automaticamente |
| **SVG/ejecutable** | ✅ solo jpeg/png/webp | N/A | ❌ Sin validacion |
| **Delete de archivo** | ✅ `allow delete: if false` | Solo via handler (admin SDK) | N/A |

---

## Aspectos positivos

1. **Path canonico:** La imagen siempre va a `stars/{skyId}/{starId}/image` — no hay variabilidad ni riesgo de path traversal.
2. **Sobreescritura prevenida en dos niveles:** Storage rules (`imagePath == null`) + handler (`star.imagePath !== null → 409`).
3. **Tipo y tamano validados en Storage rules:** Barrera de seguridad independiente del codigo.
4. **Delete bloqueado en rules:** Solo el backend (Admin SDK) puede eliminar archivos.
5. **Limpieza en delete:** Tanto `deleteStar` como `deleteSky` eliminan imagenes de Storage.
6. **`canAttach` con roles:** Owners pueden adjuntar a cualquier star, editors solo a las propias.
7. **Frontend no muestra input de imagen si la star ya tiene una:** Previene confusion del usuario.
8. **Best-effort cleanup:** `deleteSky` usa `Promise.allSettled` para no fallar si un archivo no se puede eliminar.
9. **Legacy path protegido:** Solo lectura para miembros de `shared-legacy-v1`, writes bloqueados.

---

## Conclusion

El sistema de uploads tiene buenas protecciones de seguridad en Storage Rules. El hallazgo critico (C1) no es una vulnerabilidad de seguridad sino un problema de consistencia y costo: archivos huerfanos por flujo de 3 pasos no atomico. Los hallazgos medios (M1, M2) son mejoras de UX que previenen uploads innecesarios. La defensa en profundidad (rules + handler + frontend) funciona bien.

### Proximos pasos recomendados (por prioridad):
1. **Implementar limpieza de archivos huerfanos** — Cloud Function programada o retry del PATCH (C1)
2. **Validar tipo MIME y tamano en el frontend** antes del upload (M1, M2)
3. Documentar decision de hard-delete de imagen en soft-delete de star (B1)
