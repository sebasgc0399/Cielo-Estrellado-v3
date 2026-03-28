# SPEC v3 — Video Clips en Estrellas

> Extension del SPEC original. Define el soporte para video clips cortos en estrellas, complementando el sistema actual de imagenes con clips tipo GIF procesados server-side.

---

## 1. Vision General

Las estrellas actualmente soportan una imagen estatica. Esta feature agrega la opcion de adjuntar un **video clip corto (max 6 segundos)** como alternativa a la imagen, permitiendo capturar momentos con movimiento.

El enfoque es **hibrido**: la UI de recorte es client-side (ligera, sin procesamiento pesado en el browser), y la compresion/recorte real ocurre en una Cloud Function gen2 con FFmpeg. Esto garantiza compatibilidad en todos los dispositivos y calidad consistente del output.

### 1.1 Principios

- **Imagen o video, nunca ambos.** Una estrella tiene un medio adjunto opcional: imagen o clip.
- **Clips, no videos.** Maximo 6 segundos. Es un momento, no un video largo.
- **Procesamiento server-side.** El browser solo muestra un preview y sliders de recorte. Cero dependencias pesadas en el cliente.
- **Calidad consistente.** Todo clip sale a 720p, H.264, optimizado. El usuario no decide formato ni calidad.
- **Mismo patron attach-only.** Una vez adjunto, no se reemplaza ni se elimina individualmente.

---

## 2. Arquitectura

### 2.1 Flujo Completo

```
  Cliente                    Firebase Storage              Cloud Function gen2
  ───────                    ────────────────              ───────────────────
  1. Usuario elige video
     del dispositivo

  2. Preview + sliders
     de recorte (start/end)
     Solo UI, sin procesar

  3. PATCH /api/skies/{skyId}
     /stars/{starId}
     { mediaStatus: 'processing' }
     via handler updateStar
     (UI muestra spinner
      inmediatamente)

  4. Sube video raw ──────▶  temp/{skyId}/{starId}/raw
     con customMetadata:       (trimStart, trimEnd,
     trimStart, trimEnd,        skyId, starId como
     skyId, starId              metadata del archivo)

     Si upload falla:
     PATCH { mediaStatus: null }
     via updateStar (rollback)

                             5. Trigger onFinalize ──────▶ 6. Lee customMetadata
                                                             (trimStart, trimEnd)

                                                          7. Valida mediaStatus
                                                             == 'processing'

                                                          8. FFmpeg recorta
                                                             segmento [start, end]

                                                          9. Comprime a 720p
                                                             H.264 + AAC

                                                          10. Genera thumbnail
                                                              (primer frame, JPEG)

                             11. Guarda clip final ◀───── stars/{skyId}/{starId}/video
                             12. Guarda thumbnail  ◀───── stars/{skyId}/{starId}/thumb
                             13. Borra raw         ◀───── temp/{skyId}/{starId}/raw

                                                          14. Actualiza Firestore:
                                                              mediaType: 'video'
                                                              mediaPath: '...video'
                                                              thumbnailPath: '...thumb'
                                                              mediaDuration: N
                                                              mediaStatus: 'ready'

                                                          Si falla en cualquier paso:
                                                          → mediaStatus: 'error'
                                                          → borra temp/ (limpieza)

  15. Cliente detecta
      cambio via onSnapshot,
      muestra clip final
      o error con reintento
```

### 2.2 Flujo de Imagenes (sin cambios funcionales)

El flujo actual de imagenes se mantiene identico. Los unicos cambios son el renombramiento del campo `imagePath` → `mediaPath` y la adicion de `mediaType: 'image'` para imagenes existentes. Las imagenes no usan `mediaStatus` (se suben directamente, sin procesamiento asincrono).

---

## 3. Limites y Restricciones

| Parametro | Valor | Justificacion |
|-----------|-------|---------------|
| Duracion maxima del clip | **6 segundos** | Suficiente para un momento. Mantiene archivos pequenos. |
| Duracion minima del clip | **1 segundo** | Evitar clips vacios o accidentales. |
| Tamano maximo upload raw | **50 MB** | Permite videos 4K del telefono que luego se comprimen server-side. |
| Tamano maximo clip final | **3 MB** | Despues de compresion. Comparable a una imagen. |
| Resolucion output | **720p max** | Balance calidad/peso. Suficiente para mobile. |
| Formato output | **MP4 (H.264 + AAC)** | Compatibilidad universal. |
| Thumbnail | **JPEG, primer frame** | Generado automaticamente por FFmpeg. |
| Tipos de video aceptados | `video/mp4`, `video/webm`, `video/quicktime` | Los formatos que generan los telefonos. |

---

## 4. Modelo de Datos

### 4.1 StarRecord (cambios)

```typescript
// Antes
interface StarRecord {
  imagePath: string | null
  // ...resto de campos
}

// Despues
interface StarRecord {
  mediaType: 'image' | 'video' | null   // null = sin medio adjunto
  mediaStatus: 'processing' | 'ready' | 'error' | null  // estado del procesamiento de video
  mediaPath: string | null               // ruta en Storage (imagen o clip final)
  thumbnailPath: string | null           // solo para videos, JPEG del primer frame
  mediaDuration: number | null           // solo para videos, duracion en segundos
  // ...resto de campos sin cambios
}
```

> **Nota:** `mediaStatus` solo aplica a videos. Para imagenes, `mediaStatus` es siempre `null` (el upload es sincrono desde la perspectiva del usuario).

### 4.2 Metadata de Recorte via customMetadata

Los parametros de recorte se envian como `customMetadata` del propio archivo de video en el upload a Firebase Storage. Esto garantiza un **upload atomico** — no hay archivos separados que puedan fallar independientemente.

```typescript
await uploadBytes(tempRef, file, {
  customMetadata: {
    skyId: 'abc123',
    starId: 'def456',
    trimStart: '2.3',
    trimEnd: '7.1',
    userId: 'uid789'
  }
});
```

La Cloud Function lee estos valores directamente del objeto del evento `onFinalize`.

### 4.3 Migracion de Datos Existentes

Las estrellas existentes con `imagePath` necesitan migracion:

```
imagePath: "stars/x/y/image"
→
mediaType: "image"
mediaStatus: null
mediaPath: "stars/x/y/image"
thumbnailPath: null
mediaDuration: null
```

**Estrategia:** Migration script one-time + codigo defensivo que interpreta `imagePath` como fallback durante la transicion.

### 4.4 Rutas en Storage

```
# Imagenes (sin cambios en la ruta fisica)
stars/{skyId}/{starId}/image          → JPEG/PNG/WebP, max 5MB

# Videos
temp/{skyId}/{starId}/raw            → Video raw temporal (se borra post-procesamiento)
stars/{skyId}/{starId}/video          → Clip final MP4, max 3MB
stars/{skyId}/{starId}/thumb          → Thumbnail JPEG, ~50-100KB
```

### 4.5 Rate Limit en UserRecord

```typescript
// Campos nuevos en UserRecord
videoProcessedToday: number       // contador de videos procesados hoy
lastVideoProcessDate: string      // fecha UTC del ultimo procesamiento
```

Sigue el mismo patron que `createdStarsToday` / `lastStarCreationDate`. La Cloud Function verifica y actualiza antes de procesar. Max **5 videos por usuario por dia**.

---

## 5. Maquina de Estados: mediaStatus

### 5.1 Diagrama de Transiciones

```
              Cliente                    Cloud Function
              ───────                    ──────────────
  null ──→ processing ──→ ready
    ↑       │  ↑  │
    │       │  │  ╰──→ error ──╯
    │       │  │               │
    │       ╰──╯               │
    │    (rollback             │
    │     upload fallido)      │
    ╰──────────────────────────╯
                (retry)
```

### 5.2 Transiciones Permitidas

| Desde | Hacia | Quien | Cuando |
|-------|-------|-------|--------|
| `null` | `processing` | Cliente via `updateStar` handler | Antes de iniciar upload del video raw |
| `processing` | `null` | Cliente via `updateStar` handler | Rollback: `uploadBytes()` fallo, el raw no llego a Storage |
| `processing` | `ready` | Cloud Function (Admin SDK) | Procesamiento exitoso, clip final guardado |
| `processing` | `error` | Cloud Function (Admin SDK) | Fallo en cualquier paso del procesamiento |
| `error` | `null` | Cliente via `updateStar` handler | Usuario toca "Reintentar" (reset para nuevo intento) |
| `ready` | — | — | Estado final. Attach-only, no se modifica. |

### 5.3 Restriccion: No se expone "Cancelar" en `processing`

El cliente **puede** transicionar `processing → null` **solo como rollback automatico** cuando `uploadBytes()` falla (el raw nunca llego a Storage, la Cloud Function no se dispara). La UI **no** expone un boton "Cancelar" manual porque:
- La Cloud Function puede estar procesando. Cancelar no la detiene.
- Si el usuario cancela manualmente despues de un upload exitoso y la Cloud Function termina despues, escribiria `ready` resucitando un video "cancelado". Race condition.
- El procesamiento toma 5-15 segundos. No justifica mecanismo de cancelacion manual.

**Seguridad del rollback automatico:** El rollback solo se ejecuta cuando `uploadBytes()` lanza excepcion. En ese caso, el archivo raw no llego a `temp/` (o llego incompleto, lo cual no dispara `onFinalize`), por lo que la Cloud Function nunca corre y no hay race condition. El edge case de "upload completo server-side pero el cliente recibe error de red" es cubierto por el cron de cleanup (§5.4 Nivel 2).

**UX:** El boton "Cancelar" desaparece una vez que el upload inicia. El usuario ve spinner hasta `ready` o `error`.

### 5.4 Mecanismos de Recuperacion

Dos niveles de cleanup para evitar estrellas zombies en `processing`:

**Nivel 1 — Rollback inmediato del cliente (primera linea de defensa):**

Los try/catch estan separados para distinguir que paso fallo y evitar rollbacks innecesarios (mismo patron que SPEC-storage-uploads Fix 1 aplico para imagenes):

```typescript
// Paso A: marcar como procesando via API
try {
  await api.patch(`/skies/${skyId}/stars/${starId}`, { mediaStatus: 'processing' });
} catch (err) {
  // PATCH fallo (red, servidor caido). mediaStatus sigue siendo null.
  // No hay nada que rollbackear.
  showToast('Error al iniciar procesamiento. Intenta de nuevo.');
  return;
}

// Paso B: subir video raw
try {
  await uploadBytes(tempRef, file, { customMetadata });
  // Exito. Cloud Function toma el control via onFinalize.
} catch (err) {
  // Upload fallo. mediaStatus quedo en 'processing' pero el raw no llego a Storage.
  // Rollback: processing → null (seguro porque la CF no se disparo).
  await api.patch(`/skies/${skyId}/stars/${starId}`, { mediaStatus: null });
  showToast('Error al subir el video. Intenta de nuevo.');
}
```

> **Nota:** Las transiciones de `mediaStatus` van por el handler `updateStar` (PATCH via API), no por escritura directa a Firestore. Esto mantiene la arquitectura API-only del proyecto donde todas las escrituras pasan por Cloud Functions.

**Por que separar los try/catch:** Si el paso A falla a nivel de red, `mediaStatus` sigue siendo `null`. Un rollback a `null` seria una transicion `null → null` que el handler rechazaria (no esta en las transiciones permitidas). Separando, evitamos el rollback innecesario.

Esto cubre: errores de red, timeouts, errores de permisos de Storage, usuario pierde conexion durante upload.

**Nivel 2 — Cron de cleanup (safety net):**

Cloud Function scheduled cada 15 minutos:
- Busca estrellas con `mediaStatus: 'processing'` donde `updatedAt` > 15 minutos.
- Resetea `mediaStatus` a `null`.
- Borra cualquier residuo en `temp/{skyId}/{starId}/`.

Cubre: usuario cierra la app mid-upload, Cloud Function crashea (OOM, timeout, deploy durante ejecucion), cualquier fallo no anticipado.

### 5.5 Validacion de mediaStatus en updateStar

El handler `updateStar` debe aplicar dos reglas al recibir `mediaStatus` en el body del PATCH:

**Regla 1 — Exclusividad:** Si `mediaStatus` esta presente en el body, debe ser el **unico campo**. No se permite mezclar transiciones de estado con edicion de contenido en el mismo request.

```typescript
// En updateStar handler:
if ('mediaStatus' in body) {
  const otherKeys = Object.keys(body).filter(k => k !== 'mediaStatus');
  if (otherKeys.length > 0) {
    return res.status(400).json({ error: 'mediaStatus debe enviarse solo, sin otros campos' });
  }
}
```

**Justificacion:** Un request como `{ title: 'nuevo', mediaStatus: 'processing' }` es ambiguo y peligroso. Si la transicion de estado falla, ¿se aplica el cambio de titulo? ¿O viceversa? Separar garantiza atomicidad: o se transiciona el estado, o se edita contenido, nunca ambos.

**Regla 2 — Transiciones permitidas:** Si `mediaStatus` esta presente, validar que la transicion es legal:

```typescript
const currentStatus = star.mediaStatus ?? null;
const newStatus = body.mediaStatus ?? null;

const allowedTransitions: Record<string, string[]> = {
  'null': ['processing'],           // iniciar upload
  'processing': ['null'],           // rollback (upload fallo)
  'error': ['null'],                // retry
};

const allowed = allowedTransitions[String(currentStatus)] ?? [];
if (!allowed.includes(String(newStatus))) {
  return res.status(400).json({ error: 'Transicion de mediaStatus no permitida' });
}
```

> **Nota:** `ready` y `error` solo los escribe la Cloud Function via Admin SDK. El handler rechaza cualquier intento del cliente de escribir estos valores.

---

## 6. Cloud Function: processVideoClip

### 6.1 Configuracion

```typescript
// Trigger: Storage onFinalize en ruta temp/{skyId}/{starId}/raw
// Runtime: Node 22, gen2
// Memoria: 2 GB
// Timeout: 300 segundos (5 minutos)
// Instancias maximas: 10 (limitar costo)
```

### 6.2 Logica

1. **Leer customMetadata** del archivo subido (`trimStart`, `trimEnd`, `skyId`, `starId`, `userId`).
2. **Validar** que la estrella existe en Firestore, no esta eliminada, y `mediaStatus == 'processing'`. Si no es `processing`, abortar y borrar el raw (upload huerfano).
3. **Validar rate limit:** verificar `videoProcessedToday` del usuario. Si excede 5/dia, escribir `mediaStatus: 'error'` y borrar raw.
4. **Descargar** video raw a `/tmp/`.
5. **Validar tamano:** si excede 50MB, rechazar.
6. **FFmpeg** recorta y comprime:
   ```bash
   ffmpeg -i input.mp4 -ss {start} -to {end} \
     -vf "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease" \
     -c:v libx264 -preset fast -crf 28 \
     -c:a aac -b:a 64k \
     -movflags +faststart \
     output.mp4
   ```
7. **Generar thumbnail:**
   ```bash
   ffmpeg -i output.mp4 -frames:v 1 -q:v 5 thumb.jpg
   ```
8. **Validar** que el clip final no excede 3MB. Si excede, reintentar con CRF mas alto (max 35).
9. **Subir** clip final y thumbnail a rutas definitivas.
10. **Actualizar Firestore** atomicamente:
    ```typescript
    {
      mediaType: 'video',
      mediaStatus: 'ready',
      mediaPath: `stars/${skyId}/${starId}/video`,
      thumbnailPath: `stars/${skyId}/${starId}/thumb`,
      mediaDuration: trimEnd - trimStart,
      updatedAt: now
    }
    ```
11. **Actualizar rate limit:** incrementar `videoProcessedToday` en UserRecord.
12. **Limpiar:** borrar raw de `temp/`.

### 6.3 Error Handling

Si falla en **cualquier paso** despues de la validacion inicial:
1. Escribir `mediaStatus: 'error'` en Firestore.
2. Borrar archivo raw de `temp/` (limpieza inmediata, no esperar al cron).
3. Borrar archivos parciales en `stars/` si se llegaron a crear.
4. Loguear error con contexto completo (skyId, starId, userId, paso que fallo).

### 6.4 Seguridad

- Validar que `userId` en customMetadata coincide con `authorUserId` de la estrella en Firestore.
- Rate limit: maximo 5 procesamientos de video por usuario por dia (via `videoProcessedToday` en UserRecord).
- Si el archivo raw excede 50MB, rechazar y borrar.
- Si `mediaStatus != 'processing'` al momento de procesar, abortar (previene procesamiento de uploads huerfanos).

---

## 7. Frontend

### 7.1 UI de Seleccion de Medio

En `StarFormSheet`, el selector actual de imagen se extiende con dos opciones:

```
┌─────────────────────────────┐
│  Agregar a tu estrella      │
│                             │
│  ┌──────┐    ┌──────┐      │
│  │  📷  │    │  🎬  │      │
│  │Imagen│    │ Clip │      │
│  └──────┘    └──────┘      │
└─────────────────────────────┘
```

- **Imagen:** Flujo actual sin cambios.
- **Clip:** Abre selector de video del dispositivo.

### 7.2 UI de Recorte (Trim)

Despues de seleccionar un video, se muestra:

```
┌─────────────────────────────────┐
│  ┌─────────────────────────┐    │
│  │                         │    │
│  │    Preview del video    │    │
│  │    (reproduciendo el    │    │
│  │     segmento actual)    │    │
│  │                         │    │
│  └─────────────────────────┘    │
│                                 │
│  0:00 ●━━━━━[======]━━━━ 0:45  │
│        ↑ start    end ↑         │
│        2.3s      7.1s           │
│                                 │
│  Duracion: 4.8s / 6.0s max     │
│                                 │
│  [Cancelar]        [Adjuntar]   │
└─────────────────────────────────┘
```

**Componentes necesarios:**

- `VideoTrimmer.tsx` — Componente con el video preview y los sliders de rango.
- Usa un `<video>` nativo para el preview. Al mover los sliders, hace `video.currentTime = start` y reproduce hasta `end`.
- **Sin dependencias externas.** Solo HTML5 Video API + un range slider (se puede hacer con dos `<input type="range">` o un componente de rango dual).

### 7.3 Estados de Carga

El cliente observa `mediaStatus` via `onSnapshot` y reacciona:

| `mediaStatus` | UI | Acciones disponibles |
|---|---|---|
| `null` | Sin medio adjunto | Adjuntar imagen o clip |
| `'processing'` | Spinner + "Procesando clip..." | Ninguna (boton cancelar oculto) |
| `'ready'` | Thumbnail con icono de play | Ver clip, expandir fullscreen |
| `'error'` | Mensaje de error | Boton "Reintentar" |

### 7.4 Flujo de Upload con Rollback

```typescript
async function attachVideoClip(skyId, starId, tempRef, file, trimData) {
  // Paso A: marcar como procesando via API (UI reacciona inmediato)
  try {
    await api.patch(`/skies/${skyId}/stars/${starId}`, { mediaStatus: 'processing' });
  } catch (err) {
    // PATCH fallo. mediaStatus sigue null. No hay nada que rollbackear.
    showToast('Error al iniciar procesamiento.');
    return;
  }

  // Paso B: subir video raw con metadata de recorte
  try {
    await uploadBytes(tempRef, file, {
      customMetadata: {
        skyId: trimData.skyId,
        starId: trimData.starId,
        trimStart: String(trimData.start),
        trimEnd: String(trimData.end),
        userId: trimData.userId
      }
    });

    // Exito del upload. Cloud Function toma el control.
    // Cliente espera via onSnapshot.

  } catch (err) {
    // Upload fallo: rollback processing → null (seguro, la CF no se disparo)
    await api.patch(`/skies/${skyId}/stars/${starId}`, { mediaStatus: null });
    showToast('Error al subir el video. Intenta de nuevo.');
  }
}
```

> **Nota:** Los try/catch estan separados (mismo patron que SPEC-storage-uploads Fix 1 para imagenes). Si el paso A falla, `mediaStatus` sigue en `null` y no hay rollback. El rollback `processing → null` solo ocurre si el paso B falla, momento en que el raw no llego a Storage y la Cloud Function no se dispara (sin race condition). El rollback es intencionalmente mas simple que el retry con backoff de imagenes porque la Cloud Function gestiona el estado final (`ready`/`error`), no el cliente.

### 7.5 Flujo de Reintento

```
Estado: 'error' → Usuario toca "Reintentar"
  1. Cliente envia PATCH /api/skies/{skyId}/stars/{starId}
     con { mediaStatus: null } via updateStar (reset)
  2. UI vuelve a mostrar selector de medio
  3. Usuario selecciona video (puede ser el mismo u otro)
  4. Flujo normal: PATCH { mediaStatus: 'processing' } → upload → esperar
```

El raw anterior ya fue limpiado por la Cloud Function al escribir `'error'`. La ruta `temp/{skyId}/{starId}/raw` esta libre para el nuevo upload.

### 7.6 Playback

- Clip corto (max 6s): se descarga completo como un archivo, no necesita streaming.
- **Autoplay en mute** al abrir la estrella (como Instagram/WhatsApp).
- Loop automatico (es un clip corto, tipo GIF).
- Tap para unmute si tiene audio.
- Fullscreen al tap largo o boton de expandir.

---

## 8. Security Rules

### 8.1 Firestore Rules (sin cambios)

No se requieren cambios a las Firestore Rules para stars. La regla actual `allow write: if false` se mantiene intacta.

Las transiciones de `mediaStatus` se validan en el handler `updateStar` (server-side, ver §5.5):
- `null → processing`: permitida (cliente inicia upload)
- `processing → null`: permitida (rollback automatico cuando upload falla, ver §5.3)
- `error → null`: permitida (cliente reintenta)
- Cualquier otra transicion desde el cliente: rechazada por el handler con 400.
- `processing → ready`, `processing → error`: escritas por la Cloud Function via Admin SDK (bypasea rules).
- Si `mediaStatus` viene acompanado de otros campos en el body: rechazado con 400 (ver §5.5).

> **Justificacion:** El proyecto enruta todas las escrituras por Cloud Functions via API HTTP. El cliente nunca escribe directamente a Firestore (`updateDoc`/`setDoc` no se usan en el frontend). Mantener esta invariante evita abrir writes selectivos en las rules y simplifica el modelo de seguridad.

### 8.2 Storage Rules

```rules
// Videos temporales (raw upload)
match /temp/{skyId}/{starId}/{fileName} {
  allow read: if false;  // Nadie lee el temporal
  allow create: if isActiveMember(skyId)
                && isStarAuthorOrEditor(skyId, starId)
                && request.resource.size < 50 * 1024 * 1024
                && request.resource.contentType.matches('video/.*');
  allow update: if false;  // No se sobrescribe; la CF limpia antes del reintento
  allow delete: if false;  // Solo la Cloud Function borra via Admin SDK
}

// Clips finales
match /stars/{skyId}/{starId}/video {
  allow read: if isActiveMember(skyId);
  allow create, update: if false;  // Solo la Cloud Function escribe
  allow delete: if false;           // Cleanup via Cloud Function en soft-delete
}

// Thumbnails
match /stars/{skyId}/{starId}/thumb {
  allow read: if isActiveMember(skyId);
  allow create, update: if false;  // Solo la Cloud Function escribe
  allow delete: if false;
}
```

---

## 9. Cleanup

### 9.1 En Eliminacion de Estrella

Al eliminar (soft-delete) una estrella, el handler `deleteStar` se extiende para limpiar:

- `stars/{skyId}/{starId}/image` (si existe, comportamiento actual)
- `stars/{skyId}/{starId}/video` (si existe)
- `stars/{skyId}/{starId}/thumb` (si existe)
- `temp/{skyId}/{starId}/*` (por si quedo algo pendiente)

### 9.2 En Error de Procesamiento

La Cloud Function limpia `temp/` tanto en exito como en error:
- **Exito:** borra raw despues de guardar clip final.
- **Error:** borra raw despues de escribir `mediaStatus: 'error'`.

Esto garantiza que la ruta este libre para reintentos inmediatos sin esperar al cron.

### 9.3 Cron de Cleanup (Safety Net)

Cloud Function scheduled cada 15 minutos:

```typescript
// Buscar estrellas zombies
const zombies = await db.collectionGroup('stars')
  .where('mediaStatus', '==', 'processing')
  .where('updatedAt', '<', fifteenMinutesAgo)
  .get();

// Resetear cada una
for (const doc of zombies.docs) {
  await doc.ref.update({ mediaStatus: null });
  await cleanupTempFiles(doc.data().skyId, doc.id);
}
```

Cubre edge cases que ni el cliente ni la Cloud Function de procesamiento atrapan:
- Usuario cierra la app mid-upload.
- Cloud Function crashea sin escribir `'error'` (OOM, timeout duro, deploy durante ejecucion).
- Cualquier fallo no anticipado.

### 9.4 En Eliminacion de Cielo (deleteSky cascade)

Al eliminar un cielo, el handler `deleteSky` hace cascade de todas las estrellas y borra sus archivos en Storage. Actualmente borra `imagePath` en batches de 10 con `Promise.allSettled`. Este flujo se extiende para limpiar medios de video:

Para cada estrella en el cielo:
- `mediaPath` (imagen o clip final, segun `mediaType`)
- `thumbnailPath` (si existe, solo para videos)

Adicionalmente, limpieza global del cielo:
- `temp/{skyId}/**/raw` (cualquier upload en progreso de cualquier estrella del cielo)

El patron existente de batches (`IMAGE_DELETE_BATCH_SIZE = 10`) y `Promise.allSettled` (best-effort, no bloquea el soft-delete) se mantiene para los nuevos paths.

---

## 10. Estimacion de Costos

### 10.1 Escenario: 100 usuarios activos, ~50 videos/semana

| Concepto | Calculo | Costo/mes |
|----------|---------|-----------|
| Cloud Function procesamiento | 50/sem × 4 sem × 5s × 2GB | ~$0.40 |
| Cloud Function cron cleanup | 4/hora × 24h × 30d × 256MB × 1s | ~$0.02 |
| Storage (clips finales) | ~2MB × 200 clips/mes = 0.4GB | ~$0.01 |
| Storage (bandwidth reads) | 200 clips × 20 views × 2MB = 8GB | ~$0.96 |
| Storage (uploads temporales) | Se borran inmediato | ~$0.00 |
| **Total mensual** | | **~$1.39** |

### 10.2 Comparacion con solo imagenes

El costo incremental es minimo porque los clips finales (~2MB) son comparables en tamano a las imagenes actuales (~1-4MB).

---

## 11. Fases de Implementacion

### Fase 1 — Modelo de datos y migracion

> **Nota:** `contracts.ts` y `policies.ts` existen en dos copias manuales que deben mantenerse sincronizadas: `functions/src/domain/` (backend) y `frontend/src/domain/` (frontend). Cada cambio en esta fase debe aplicarse a **ambos** archivos. Lo mismo para `defaults.ts`.

- Actualizar `StarRecord` en `contracts.ts` (agregar `mediaType`, `mediaStatus`, renombrar `imagePath` → `mediaPath`, agregar `thumbnailPath`, `mediaDuration`).
- Agregar `videoProcessedToday` y `lastVideoProcessDate` a `UserRecord`.
- Actualizar `policies.ts` con nuevas constantes (limites de video, tipos aceptados).
- Migracion de datos existentes: script para actualizar estrellas con `imagePath` al nuevo esquema.
- Actualizar handlers existentes (`createStar`, `updateStar`, `deleteStar`) para el nuevo esquema.
- Extender `updateStar` para validar transiciones de `mediaStatus` (`null → processing`, `processing → null`, `error → null`) y la regla de exclusividad (ver §5.5).
- Extender `deleteStar` y `deleteSky` para limpiar `mediaPath`, `thumbnailPath` y `temp/` (ver §9.1 y §9.4).
- Actualizar Storage Rules con reglas para `temp/`, clips y thumbnails.
- Tests del nuevo modelo y transiciones.

### Fase 2 — Cloud Function de procesamiento

- Instalar FFmpeg como dependencia en functions (binary estatico o `@ffmpeg-installer/ffmpeg`).
- Implementar `processVideoClip` Cloud Function (trigger `onFinalize` en `temp/`).
- Logica: leer customMetadata → validar → recortar → comprimir → thumbnail → guardar → limpiar.
- Error handling: escribir `'error'` + limpiar temp/ en cualquier fallo.
- Implementar cron de cleanup para estrellas zombies (cada 15 min).
- Tests unitarios del handler y del cron.
- Deploy y prueba manual.

### Fase 3 — Frontend: upload y trim UI

- Componente `VideoTrimmer.tsx` (preview + sliders de rango).
- Extender `StarFormSheet.tsx` con selector imagen/video.
- Funcion `uploadStarVideo()` en `storage.ts` (PATCH via API para `mediaStatus: 'processing'` → upload con customMetadata → rollback via API en error).
- Observar `mediaStatus` via `onSnapshot` para estados de carga.
- Flujo de reintento (reset a null → flujo normal).
- Tests del componente y del flujo de upload.

### Fase 4 — Frontend: playback

- Extender `StarOverlay.tsx` para detectar `mediaType` y renderizar `<video>` o `<img>`.
- Autoplay muted + loop para clips.
- Tap to unmute.
- Thumbnail como poster mientras carga.
- Fullscreen viewer para video.
- Tests del componente de playback.

---

## 12. Decisiones Descartadas

| Alternativa | Por que se descarto |
|-------------|-------------------|
| FFmpeg.wasm (client-side) | ~30MB de WASM, lento en moviles de gama baja, incompatible con Safari/iOS en algunos casos. |
| MediaRecorder API (client-side) | Perdida de calidad, soporte inconsistente en Safari, no garantiza formato uniforme. |
| Cloud Run para procesamiento | Overengineering para clips de 6 segundos. Cloud Function gen2 con 2GB de RAM es suficiente. |
| Streaming adaptativo (HLS/DASH) | Innecesario para clips de 2-3MB. Descarga directa es mas simple y rapida. |
| Permitir videos largos | Incrementa costos, complejidad de procesamiento, y storage exponencialmente. 6 segundos cubre el caso de uso. |
| GIF animado como formato output | Calidad inferior, archivos mas pesados que MP4 equivalente, sin audio. |
| Permitir reemplazar el clip | Complejidad adicional en permisos y cleanup. Mismo patron attach-only que imagenes. |
| meta.json como archivo separado | Dos uploads independientes crean race condition: si meta.json falla pero el raw sube, el onFinalize no tiene datos de recorte. customMetadata en el propio archivo es atomico. |
| Escritura directa a Firestore (`updateDoc`) para `mediaStatus` | El proyecto enruta todas las escrituras por Cloud Functions via API. Introducir `updateDoc` en el frontend requeriria abrir `allow write` en Firestore rules, rompiendo la invariante de seguridad. El handler `updateStar` ya valida permisos, acceso al cielo y ownership — reusar ese endpoint es mas simple y seguro. |
| Cloud Function setea `processing` | Gap de UX de 1-10+ segundos entre upload completado y onFinalize (cold start). El usuario ve la estrella vacia. Cliente seteando antes del upload da feedback inmediato. |
| Cancelacion manual en `processing` | Race condition: si el usuario cancela despues de un upload exitoso, la Cloud Function puede escribir `ready` resucitando un video "cancelado". El rollback automatico (upload fallo) es seguro porque la CF no se disparo. Pero la UI no expone boton de cancelar para evitar el caso manual. |
| Mezclar `mediaStatus` con otros campos en PATCH | Ambiguedad: si `{ title: 'x', mediaStatus: 'processing' }` falla la transicion, ¿se aplica el titulo? Separar garantiza atomicidad. El handler rechaza con 400 si `mediaStatus` viene acompanado de otros campos. |
| `allow update` en temp/ Storage | Permitiria sobrescribir un raw que la Cloud Function esta procesando. La CF limpia temp/ en error, dejando la ruta libre para reintentos. |
| Rutas unicas por intento (timestamp) | Complica el cron y la CF necesita resolver cual es el intento mas reciente. Innecesario si la CF limpia en error. |

---

## 13. Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigacion |
|--------|:------------:|:-------:|-----------|
| FFmpeg falla en Cloud Function | Baja | Alto | Binary estatico testeado. Fallback: `mediaStatus: 'error'`, usuario reintenta. |
| Video raw muy grande satura /tmp | Media | Medio | Validar tamano antes de descargar. /tmp en gen2 tiene hasta 10GB. |
| Clip final excede 3MB | Baja | Bajo | Reintentar con CRF mas alto (max 35). Si aun excede, rechazar con error. |
| Procesamiento toma mas de 5 min | Muy baja | Medio | Para 6s de video es improbable. Timeout a 5 min como safety net. |
| Abuso (uploads masivos) | Media | Alto | Rate limit por usuario (5/dia). Max 10 instancias concurrentes de la function. |
| Estrella zombi en `processing` | Media | Bajo | Rollback inmediato del cliente + cron cada 15 min como safety net. |
| Upload falla despues del PATCH | Media | Bajo | try/catch con rollback a `mediaStatus: null`. Cron cubre caso de app cerrada. |
| Cloud Function crashea sin escribir error | Muy baja | Medio | Cron detecta estrellas en `processing` > 15 min y las resetea. |
