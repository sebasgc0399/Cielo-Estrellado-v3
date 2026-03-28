# SPEC: Correcciones al Sistema de Storage y Uploads

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/09-storage-uploads.md` (auditoria de seguridad)
**Archivos afectados:**
- `frontend/src/components/sky/StarFormSheet.tsx` (flujo de creacion con imagen)
- `frontend/src/components/sky/StarOverlay.tsx` (getDownloadURL en cada render)
- `functions/src/handlers/stars.ts` (handler deleteStar)
- `functions/src/handlers/stars.test.ts` (tests)
- `functions/src/handlers/skies.ts` (deleteSky con cleanup de imagenes)

## Contexto

Una auditoria de seguridad identifico 1 critico, 2 medios y 4 bajos en el sistema de uploads/storage. Tras explorar el codigo actual, **M1 y M2 ya estan resueltos** — el frontend ahora valida MIME type y tamano en `StarFormSheet.tsx:67-84` usando constantes de `frontend/src/domain/policies.ts` (`STAR_IMAGE_MAX_SIZE_BYTES` y `STAR_IMAGE_ALLOWED_TYPES`). La auditoria se hizo sobre una version anterior del codigo.

Los hallazgos restantes NO son vulnerabilidades de seguridad. El sistema tiene buena defensa en profundidad (Storage Rules validan tipo, tamano, permisos, sobreescritura; handlers validan path canonico y 409 en sobreescritura). Los issues son de **consistencia de datos** (archivos huerfanos), **operaciones** (concurrencia en deletes), **rendimiento** (getDownloadURL innecesarios) y **cobertura de tests**.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 1: Separar errores de upload y PATCH + retry PATCH [C1 — Severidad Critica]

### Problema

El flujo de creacion de estrella con imagen tiene 3 pasos no atomicos:
1. `POST /api/skies/{skyId}/stars` → crea estrella con `imagePath: null`
2. `uploadStarImage(skyId, starId, file)` → sube imagen a Storage
3. `PATCH /api/skies/{skyId}/stars/{starId}` → actualiza `imagePath` en Firestore

Si el paso 2 (upload) tiene exito pero el paso 3 (PATCH) falla, la imagen queda en Storage sin referencia en Firestore. El archivo es inaccesible y ocupa espacio indefinidamente.

### Codigo actual (`StarFormSheet.tsx:107-118`)

```typescript
if (imageFile) {
  try {
    const path = await uploadStarImage(skyId, res.starId, imageFile)
    await api(`/api/skies/${skyId}/stars/${res.starId}`, {
      method: 'PATCH',
      body: JSON.stringify({ imagePath: path, title: trimTitle }),
    })
  } catch {
    toast.warning('Estrella creada pero la imagen no se pudo subir')
    onSuccess()
    return
  }
}
```

El `catch` captura errores de **ambos** upload y PATCH indistintamente. Si upload tiene exito y PATCH falla:
- El mensaje "imagen no se pudo subir" es incorrecto (SI se subio)
- La imagen queda huerfana en Storage
- El frontend no puede limpiar porque `storage.rules` tiene `allow delete: if false`

### Evaluacion de opciones

| Opcion | Pros | Contras |
|--------|------|---------|
| **Retry PATCH en frontend** | Simple, cubre errores transitorios | No limpia si todos los retries fallan |
| **Cleanup en PATCH failure (frontend)** | Limpiaria inmediatamente | **Imposible:** `storage.rules` tiene `allow delete: if false` |
| **Cloud Function scheduled cleanup** | Cubre todos los casos | Complejidad alta, nuevo servicio, costos de listado de Storage |
| **Invertir flujo (upload → POST)** | Atomico | Requiere rediseno completo del handler y storage.rules |

**Decision:** Retry PATCH (opcion 1). Razones:
- El escenario problematico es PATCH fallando tras upload exitoso. La causa mas probable son errores de red transitorios.
- Si el PATCH falla permanentemente, el usuario puede reintentar manualmente via edit: la storage rule `imagePath == null` permite re-upload (sobrescribe el huerfano via `allow update`), y el PATCH handler es idempotente (`star.imagePath === null` check en `stars.ts:318`).
- La limpieza desde frontend es **imposible** por storage.rules. Solo el Admin SDK (backend) puede borrar archivos (`stars.ts:411`, `skies.ts:307`).
- Un Cloud Function scheduler es desproporcionado para un escenario de baja probabilidad.

### Codigo propuesto (`StarFormSheet.tsx:107-118`)

```typescript
if (imageFile) {
  let uploadedPath: string | null = null
  try {
    uploadedPath = await uploadStarImage(skyId, res.starId, imageFile)
  } catch {
    toast.warning('Estrella creada pero la imagen no se pudo subir')
    onSuccess()
    return
  }

  const patchUrl = `/api/skies/${skyId}/stars/${res.starId}`
  const patchOpts = {
    method: 'PATCH' as const,
    body: JSON.stringify({ imagePath: uploadedPath, title: trimTitle }),
  }

  try {
    await api(patchUrl, patchOpts)
  } catch {
    // Retry una vez — la mayoria de fallos de PATCH son errores transitorios de red.
    try {
      await api(patchUrl, patchOpts)
    } catch (retryError) {
      // 409 = el primer PATCH SI tuvo exito (respuesta perdida en red)
      // La imagen YA esta vinculada, continuar normalmente.
      if (retryError instanceof ApiError && retryError.status === 409) {
        // Fall through to success
      } else {
        toast.warning(
          'Estrella creada pero la imagen no se pudo vincular. '
          + 'Puedes agregarla editando la estrella.'
        )
        onSuccess()
        return
      }
    }
  }
}
```

### Cambios clave

1. **Errores separados:** Upload y PATCH tienen `try/catch` independientes. El mensaje refleja correctamente que paso.
2. **Parametros extraidos:** `patchUrl` y `patchOpts` se definen una sola vez y se reusan en el intento original y el retry. Evita duplicacion y reduce superficie de error si los parametros cambian en el futuro.
3. **Un retry de PATCH:** Si el primer PATCH falla, se reintenta una vez. Cubre errores de red transitorios. Si el handler tiene un bug (ej. deploy malo que retorna 500), el retry falla con el mismo error y cae correctamente al toast de "no se pudo vincular".
4. **409 en retry = exito:** Si el primer PATCH realmente tuvo exito (respuesta perdida en red), el retry recibe 409 de `stars.ts:319` ("La estrella ya tiene una imagen"). Se trata como exito porque la imagen SI esta vinculada.
5. **Mensaje corregido:** Si PATCH falla tras retry, dice "no se pudo vincular" (no "subir") y sugiere editar.
6. **Sin limpieza de archivo:** No posible desde frontend. El huerfano es benigno — la storage rule `allow create, update` en `storage.rules:48-52` permite re-upload cuando `imagePath == null`.

### Decisiones de diseno

- **1 retry, no exponential backoff.** Suficiente para errores transitorios. Si el handler tiene un bug, 10 retries no ayudan. La complejidad de backoff no se justifica para un flujo de UI con retry manual disponible (editar la estrella).
- **No se agrega endpoint de cleanup.** Crear `POST /cleanup-orphan` requiere auth, verificacion de propiedad, y logica de borrado. Desproporcionado para escenario de baja probabilidad. Costo maximo de un huerfano: 5MB (limite en `storage.rules:51`).
- **El flujo de edit sirve como recovery.** Star con `imagePath: null` puede editarse (`StarFormSheet.tsx:132-136`). El re-upload sobrescribe el huerfano porque `storage.rules:48-52` permite `create, update` cuando `imagePath == null`.
- **`ApiError` ya esta importado** en `StarFormSheet.tsx:17` (`import { api, ApiError } from '@/lib/api/client'`). No requiere cambio de imports.

---

## Fix 2: Documentar decision de soft-delete star con hard-delete imagen [B1 — Severidad Baja]

### Problema

`deleteStar` hace soft-delete en Firestore (`deletedAt: now` en `stars.ts:404-407`) pero hard-delete de la imagen en Storage (`stars.ts:409-415`). No hay restore capability.

### Codigo actual (`stars.ts:409-415`)

```typescript
if (star.imagePath) {
  try {
    await storage.bucket().file(star.imagePath).delete()
  } catch {
    console.warn(`Failed to delete storage file: ${star.imagePath}`)
  }
}
```

### Propuesta: Solo documentar, sin cambio de logica

El hard-delete es correcto:
- No existe funcionalidad de restore
- Imagenes de estrellas eliminadas incrementan costos sin beneficio
- Storage rules bloquean reads cuando `deletedAt != null` (`starExistsAndActive()` requiere `star.data.deletedAt == null`), la imagen seria inaccesible de todas formas

**Agregar comentario en `stars.ts` antes de linea 409:**

```typescript
// DECISION: hard-delete imagen en soft-delete de star.
// La imagen es inaccesible tras soft-delete (storage rules verifican deletedAt == null).
// Si se implementa restore, considerar mover a path "trash/" en vez de eliminar.
// Ver audits/09-storage-uploads.md B1.
```

---

## Fix 3: Cachear getDownloadURL en StarOverlay [B3 — Severidad Baja]

### Problema

`StarOverlay` llama `getDownloadURL(ref(storage, star.imagePath))` cada vez que el componente se monta (`StarOverlay.tsx:37`). Si un usuario abre/cierra el mismo overlay, se generan llamadas redundantes.

### Codigo actual (`StarOverlay.tsx:32-44`)

```typescript
useEffect(() => {
  if (!star.imagePath) return
  setImageLoaded(false)
  let cancelled = false

  getDownloadURL(ref(storage, star.imagePath))
    .then((url) => {
      if (!cancelled) setImageUrl(url)
    })
    .catch(() => {})

  return () => { cancelled = true }
}, [star.imagePath])
```

### Codigo propuesto

**Crear cache a nivel de modulo en `StarOverlay.tsx` (despues de `formatDate`, antes de la funcion `StarOverlay`, alrededor de linea 26):**

```typescript
const downloadUrlCache = new Map<string, string>()
```

**Reemplazar el useEffect (`StarOverlay.tsx:32-44`):**

```typescript
useEffect(() => {
  if (!star.imagePath) return
  setImageLoaded(false)
  let cancelled = false

  const cached = downloadUrlCache.get(star.imagePath)
  if (cached) {
    setImageUrl(cached)
    return
  }

  getDownloadURL(ref(storage, star.imagePath))
    .then((url) => {
      downloadUrlCache.set(star.imagePath!, url)
      if (!cancelled) setImageUrl(url)
    })
    .catch(() => {})

  return () => { cancelled = true }
}, [star.imagePath])
```

### Decisiones de diseno

- **Module-level Map, no React state.** Persiste entre montajes/desmontajes del componente. Un `useState` o `useRef` se reinicia cuando el componente se desmonta. Un `Map` a nivel de modulo persiste durante toda la sesion de la SPA.
- **Sin TTL.** Download URLs de Firebase Storage tienen tokens con TTL largo (~1 hora). En una sesion tipica, la URL no expira. Si expirara, el `<img>` falla silenciosamente y el usuario recarga (limpia cache del modulo).
- **Sin limite de tamano.** Un cielo tiene max ~500 estrellas. 500 entradas de string es ~50KB. Negligible.
- **Cache key es `imagePath`.** Cada estrella tiene path unico (`stars/{skyId}/{starId}/image`). Sin colisiones.

---

## Fix 4: Limitar concurrencia de deletes en deleteSky [B2 — Severidad Baja]

### Problema

`deleteSky` lanza todos los deletes de imagen en paralelo con `Promise.allSettled`. Si un cielo tiene 100 estrellas con imagen, se generan 100 requests simultaneas a Cloud Storage.

### Codigo actual (`skies.ts:301-312, 327-328`)

```typescript
// Linea 301-312: crea todas las promesas inmediatamente
const imageDeletePromises: Promise<void>[] = []
for (const doc of starsSnap.docs) {
  const starData = doc.data()
  if (starData.imagePath) {
    imageDeletePromises.push(
      storage.bucket().file(starData.imagePath).delete().then(() => {}).catch(() => {
        console.warn(`Failed to delete storage file: ${starData.imagePath}`)
      })
    )
  }
}

// ... (batch commits de Firestore en lineas 314-325) ...

// Linea 327-328: espera todos al final
await Promise.allSettled(imageDeletePromises)
```

Nota: las promesas de Storage se **crean** antes de los batch commits de Firestore (linea 314-325), por lo que los deletes de Storage corren concurrentemente con las operaciones de Firestore. Esto funciona con el codigo actual pero es relevante al cambiar a batches secuenciales.

### Codigo propuesto

**Reemplazar lineas 301-312 y 327-328.** Mover la limpieza de imagenes DESPUES de los batch commits de Firestore (despues de linea 325):

```typescript
// Clean up star images from Storage (batched, best-effort)
const IMAGE_DELETE_BATCH_SIZE = 10
const imagePaths: string[] = []
for (const doc of starsSnap.docs) {
  const starData = doc.data()
  if (starData.imagePath) imagePaths.push(starData.imagePath as string)
}
for (let i = 0; i < imagePaths.length; i += IMAGE_DELETE_BATCH_SIZE) {
  const chunk = imagePaths.slice(i, i + IMAGE_DELETE_BATCH_SIZE)
  await Promise.allSettled(
    chunk.map(path =>
      storage.bucket().file(path).delete().then(() => {}).catch(() => {
        console.warn(`Failed to delete storage file: ${path}`)
      })
    )
  )
}
```

### Cambios clave

1. **Batch size 10.** Cloud Storage Admin SDK no documenta rate limits estrictos para deletes, pero 10 requests concurrentes es un patron comun y conservador.
2. **Batches secuenciales, paralelo dentro de cada batch.** 100 imagenes = 10 batches de 10. Cada batch ~200ms. Total ~2s vs ~200ms para full parallel. Aceptable para una operacion infrecuente.
3. **Movido despues de Firestore commits.** En el codigo actual, las promesas de Storage se crean eagerly antes de Firestore. Con batches secuenciales (`await` en loop), bloquearian los commits si estuvieran antes. Moverlas despues asegura que Firestore completa primero.
4. **Constante local, no en policies.** `IMAGE_DELETE_BATCH_SIZE` es un detalle de implementacion, no una politica de dominio.

---

## Plan de tests

### Tests existentes — SIN modificacion

`stars.test.ts` tiene 6 tests en `describe('createStar rewards')` (lineas 98-200). Cubren rewards, cap diario, audit logs y best-effort. Ninguno se ve afectado por este SPEC.

### Gap descubierto

Durante la exploracion se descubrio que **no existen tests** para:
- Validacion de `imagePath` en `updateStar` (path canonico, path traversal, 409 overwrite, null, tipo invalido)
- Limpieza de imagen en `deleteStar` (con imagen, sin imagen, Storage error no bloquea)

### Mocks a agregar/modificar

**1. Import adicional (despues de linea 59):**

```typescript
import { updateStar, deleteStar } from './stars'
```

**2. En `vi.hoisted()` (linea 8), agregar mocks de Storage:**

```typescript
const storageDelete = vi.fn().mockResolvedValue(undefined)
const storageFile = vi.fn().mockReturnValue({ delete: storageDelete })
```

Agregar al `return` (linea 31): `storageFile, storageDelete`

**3. En mock de `firebaseAdmin` (linea 44-57), agregar `storage`:**

```typescript
vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    // ... mock de db existente sin cambios ...
  },
  storage: {
    bucket: vi.fn().mockReturnValue({
      file: mocks.storageFile,
    }),
  },
}))
```

**4. Agregar resets en `beforeEach` (despues de linea 93):**

```typescript
mocks.storageFile.mockClear()
mocks.storageDelete.mockResolvedValue(undefined)
```

### Helpers nuevos (agregar despues de `makeRes`)

```typescript
function makeUpdateReq(body: Record<string, unknown> = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', starId: 'star-123' },
    body: { title: 'Updated Star', ...body },
    query: {},
  } as unknown as Request
}

function makeDeleteReq() {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', starId: 'star-123' },
    body: {},
    query: {},
  } as unknown as Request
}
```

### Nuevos tests: `describe('updateStar — imagePath')`

```typescript
describe('updateStar — imagePath', () => {
  const baseStar = {
    title: 'Existing Star',
    message: null,
    xNormalized: 0.5,
    yNormalized: 0.5,
    imagePath: null,
    deletedAt: null,
    authorUserId: 'test-uid',
  }

  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ ...baseStar, ...overrides }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('acepta imagePath canonico cuando star.imagePath es null', async () => {
    const starRef = setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: 'stars/sky-1/star-123/image' }),
    )
  })

  it('rechaza imagePath no canonico con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/OTHER-STAR/image' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza imagePath con path traversal con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(
      makeUpdateReq({ imagePath: 'stars/sky-1/star-123/../../../etc/passwd' }),
      res,
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('retorna 409 si star ya tiene imagen', async () => {
    setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('permite setear imagePath a null', async () => {
    const starRef = setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: null }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: null }),
    )
  })

  it('rechaza imagePath con tipo invalido con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 12345 }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})
```

### Nuevos tests: `describe('deleteStar — image cleanup')`

```typescript
describe('deleteStar — image cleanup', () => {
  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          deletedAt: null,
          authorUserId: 'test-uid',
          imagePath: null,
          ...overrides,
        }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('elimina imagen de Storage al eliminar estrella con imagen', async () => {
    setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-123/image')
    expect(mocks.storageDelete).toHaveBeenCalled()
  })

  it('no intenta eliminar Storage si star no tiene imagen', async () => {
    setupStarRef({ imagePath: null })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).not.toHaveBeenCalled()
  })

  it('completa soft-delete aun si Storage delete falla', async () => {
    mocks.storageDelete.mockRejectedValueOnce(new Error('Storage error'))
    const starRef = setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(String) }),
    )
  })
})
```

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | B1 — Comentario en deleteStar | Minima | 4 lineas de comentario. Sin cambios de logica. |
| 2 | B3 — Cache getDownloadURL | Baja | ~10 lineas en un archivo frontend. Sin dependencias. |
| 3 | B2 — Batch deletes en deleteSky | Baja | Refactor de bucle en un archivo backend. Sin impacto en otros handlers. |
| 4 | C1 — Separar errores upload/PATCH | Media | Cambio en flujo critico. Requiere testing manual del happy path y error paths. |
| 5 | Tests — updateStar + deleteStar | Media | Requiere mocks adicionales (Storage). Independiente de fixes. |

### Dependencias entre cambios

- **Pasos 1, 2, 3** son completamente independientes y pueden implementarse en paralelo.
- **Paso 4** es independiente pero es el mas critico — requiere testing manual.
- **Paso 5** es independiente de los fixes — puede implementarse antes o despues. Se recomienda al final porque los mocks de `storage` no existen aun en el test file y requieren extender el setup.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/stars.test.ts
cd functions && npx tsc --noEmit
```

### Conteo esperado de tests

- **Antes:** 6 tests (6 createStar rewards)
- **Despues:** 15 tests (6 createStar rewards + 6 updateStar imagePath + 3 deleteStar image cleanup)
- **Delta:** +6 en updateStar, +3 en deleteStar

### Checklist post-deploy

- [ ] Crear estrella con imagen — flujo normal funciona (happy path)
- [ ] Simular fallo de red en PATCH (DevTools > Network > Offline momentaneo) — retry funciona
- [ ] Si retry tambien falla, toast dice "no se pudo vincular" y la estrella se puede editar para agregar imagen
- [ ] Abrir/cerrar StarOverlay para la misma estrella — solo 1 llamada a getDownloadURL (verificar en Network tab)
- [ ] deleteSky con multiples estrellas con imagen — sin errores de rate limiting en Cloud Logging

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Retry de PATCH causa doble vinculacion | Imposible | `updateStar` es idempotente: si `imagePath` ya tiene valor, retorna 409 (`stars.ts:318-320`). El retry trata 409 como exito. |
| Cache de getDownloadURL sirve URL expirada | Muy baja | Download URLs tienen TTL ~1h. Recarga de pagina limpia cache del modulo. |
| Mocks de Storage no cubren API real | Baja | Misma cadena de llamadas que produccion: `bucket().file(path).delete()`. |
| Batch delete en deleteSky mas lento que full parallel | Aceptable | ~2s vs ~200ms para 100 imagenes. Operacion infrecuente (deleteSky). |
| Mock de `starsChain.doc` compartido entre describes | Media | Cada `describe` configura el mock en su propio `setupStarRef`. El `vi.clearAllMocks()` global en `beforeEach` (linea 80) reinicia entre tests. |

---

## Hallazgos resueltos (no requieren accion)

### [RESUELTO] M1 — Frontend no valida tipo MIME antes del upload

**Estado:** Resuelto en `StarFormSheet.tsx:74-76`.

```typescript
if (!STAR_IMAGE_ALLOWED_TYPES.includes(file.type)) {
  toast.error('Solo se permiten imágenes JPEG, PNG o WebP')
  return
}
```

Constantes importadas de `frontend/src/domain/policies.ts:5`. Validacion ocurre en `handleImageSelect` (linea 67) antes de cualquier upload.

### [RESUELTO] M2 — Frontend no valida tamano antes del upload

**Estado:** Resuelto en `StarFormSheet.tsx:70-72`.

```typescript
if (file.size > STAR_IMAGE_MAX_SIZE_BYTES) {
  toast.error(`La imagen no puede superar ${STAR_IMAGE_MAX_SIZE_BYTES / 1024 / 1024}MB`)
  return
}
```

Constante importada de `frontend/src/domain/policies.ts:4` (`5 * 1024 * 1024`). Validacion ocurre antes del upload, evitando transferencia innecesaria.

---

## Matriz de proteccion (actualizada)

| Vector | Storage Rules | Handler | Frontend |
|--------|--------------|---------|----------|
| **Tipo MIME invalido** | ✅ `contentType.matches(...)` | N/A (upload directo a Storage) | ✅ `STAR_IMAGE_ALLOWED_TYPES` |
| **Archivo > 5MB** | ✅ `size < 5 * 1024 * 1024` | N/A | ✅ `STAR_IMAGE_MAX_SIZE_BYTES` |
| **Sobreescritura** | ✅ `imagePath == null` | ✅ `star.imagePath !== null → 409` | ✅ no muestra input si ya tiene imagen |
| **Acceso no autorizado** | ✅ `isActiveMember()` | ✅ `getSkyWithAccess()` | ✅ auth required |
| **Path traversal** | ✅ path fijo `stars/{skyId}/{starId}/image` | ✅ canonical path check | ✅ path generado automaticamente |
| **SVG/ejecutable** | ✅ solo jpeg/png/webp | N/A | ✅ `STAR_IMAGE_ALLOWED_TYPES` |
| **Delete de archivo** | ✅ `allow delete: if false` | Solo via handler (Admin SDK) | N/A |
| **Archivos huerfanos** | ✅ permite re-upload (`imagePath == null`) | ✅ PATCH idempotente (409) | ✅ retry PATCH (este SPEC) |
