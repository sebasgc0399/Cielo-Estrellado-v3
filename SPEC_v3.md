# SPEC v3 — Video Clips en Estrellas (Referencia Lean)

Referencia lean del soporte de video clips cortos en estrellas. Para modelo base ver `SPEC.md`. Para economia ver `SPEC_v2.md`.

---

## 1. Principios

- **Imagen o video, nunca ambos.** Una estrella tiene un medio adjunto opcional.
- **Clips, no videos.** Maximo 6 segundos.
- **Procesamiento server-side.** El browser solo muestra preview y UI de recorte. FFmpeg corre en Cloud Function.
- **Calidad consistente.** 720p, H.264 + AAC. El usuario no decide formato ni calidad.
- **Attach-only.** Una vez adjunto, no se reemplaza.

---

## 2. Flujo

```
Cliente                         Storage                    Cloud Function
───────                         ───────                    ──────────────
1. Selecciona video
2. Filmstrip + handles de recorte
3. PATCH { mediaStatus: 'processing' } via updateStar
4. Upload raw → temp/{skyId}/{starId}/raw (con customMetadata)
   Si falla: PATCH { mediaStatus: null } (rollback)
                                5. onFinalize trigger
                                                           6. Valida estado + rate limit
                                                           7. FFmpeg trim + compress
                                                           8. Genera thumbnail
                                9. Guarda clip + thumb ←── stars/{skyId}/{starId}/video|thumb
                                10. Borra raw
                                                           11. mediaStatus: 'ready'
12. onSnapshot detecta cambio → muestra video
```

Imagenes: flujo sin cambios. `mediaType: 'image'`, `mediaStatus: null`.

---

## 3. Limites

| Parametro | Valor |
|-----------|-------|
| Duracion clip | 1–6 segundos |
| Upload raw max | 50 MB |
| Clip final max | 3 MB |
| Resolucion output | 720p max |
| Formato output | MP4 (H.264 + AAC) |
| Thumbnail | JPEG, primer frame |
| Videos aceptados | `video/mp4`, `video/webm`, `video/quicktime` |
| Rate limit | 5 videos/usuario/dia |

---

## 4. Modelo de Datos

### 4.1 StarRecord

```typescript
type MediaType = 'image' | 'video'
type MediaStatus = 'processing' | 'ready' | 'error'

interface StarRecord {
  // ...campos base (SPEC.md)...
  mediaType: MediaType | null
  mediaStatus: MediaStatus | null
  mediaPath: string | null
  thumbnailPath: string | null
  mediaDuration: number | null
}
```

`mediaStatus` solo aplica a videos. Para imagenes es `null`.

### 4.2 UserRecord

```typescript
videoProcessedToday: number        // reset diario
lastVideoProcessDate: string | null
```

### 4.3 Storage Paths

```
stars/{skyId}/{starId}/image     → Imagen (JPEG/PNG/WebP, max 5MB)
temp/{skyId}/{starId}/raw        → Video raw temporal
stars/{skyId}/{starId}/video     → Clip final MP4
stars/{skyId}/{starId}/thumb     → Thumbnail JPEG
```

### 4.4 customMetadata (en upload raw)

```typescript
{ skyId, starId, userId, trimStart: string, trimEnd: string }
```

---

## 5. Maquina de Estados: mediaStatus

```
null → processing → ready
         ↕
       error → null (retry)
```

| Transicion | Quien | Contexto |
|-----------|-------|----------|
| `null → processing` | Cliente via updateStar | Antes del upload |
| `processing → null` | Cliente via updateStar | Rollback (upload fallo) |
| `processing → ready` | Cloud Function (Admin SDK) | Procesamiento exitoso |
| `processing → error` | Cloud Function (Admin SDK) | Fallo en procesamiento |
| `error → null` | Cliente via updateStar | Retry |

**Reglas del handler updateStar:**
- `mediaStatus` debe ser el unico campo en el body (exclusividad)
- Solo transiciones listadas arriba. `ready`/`error` no escribibles desde cliente.
- Todas las escrituras via API, nunca `updateDoc` directo.

---

## 6. Cloud Function: processVideoClip

**Config:** gen2, Node 22, 2GB, 300s timeout, max 10 instancias.
**Trigger:** `onObjectFinalized` (filtra por path `temp/` manualmente).

**Logica:**
1. Leer customMetadata → validar star (existe, no eliminada, `mediaStatus == 'processing'`)
2. Validar userId == authorUserId
3. Validar rate limit (videoProcessedToday < 5)
4. Download raw a /tmp, validar < 50MB
5. FFmpeg trim + compress (CRF 28, 1 retry con CRF 35 si > 3MB)
6. FFmpeg thumbnail (primer frame)
7. Upload clip + thumb a rutas definitivas
8. Update Firestore: `mediaStatus: 'ready'`, `mediaType: 'video'`, paths, duration
9. Incrementar videoProcessedToday
10. Borrar raw de temp/

**Error:** `mediaStatus: 'error'` + borrar raw + borrar parciales en stars/.

### cleanupZombieStars (cron)

Scheduled cada 15 min. Busca `mediaStatus == 'processing'` con `updatedAt > 15 min`. Resetea a `null`, borra temp/.

---

## 7. Frontend

### 7.1 Selector de Medio (StarFormSheet)

Dos botones: "Imagen" + "Clip". Imagen usa flujo existente. Clip abre selector de video con validacion (50MB, tipos).

### 7.2 UI de Recorte (VideoTrimmer)

**Filmstrip con thumbnails** extraidos via `canvas.drawImage()` + **handles laterales** arrastrables con Pointer Events. Constraints: 1–6 segundos. Video preview reproduce el segmento seleccionado en loop.

> Rediseno documentado en `audits/SPEC-video-trimmer-redesign.md`.

### 7.3 Estados de Carga

| mediaStatus | UI |
|---|---|
| `null` | Selector imagen/clip |
| `processing` | Spinner "Procesando clip..." |
| `ready` | Video con autoplay |
| `error` | Error + boton "Reintentar" |

Deteccion via `onSnapshot` (automatica). SkyPage sincroniza `selectedStar` con datos live.

### 7.4 Upload con Rollback

Try/catch separados (patron SPEC-storage-uploads Fix 1):
- Paso A: PATCH `{ mediaStatus: 'processing' }`. Si falla: no rollback (sigue null).
- Paso B: `uploadStarVideo()`. Si falla: PATCH `{ mediaStatus: null }` (rollback).

### 7.5 Playback (StarOverlay)

- Autoplay muted + loop (`playsInline` para iOS)
- Tap para toggle mute
- Indicador mute (VolumeX/Volume2) esquina inferior derecha
- Expand (Maximize2) esquina inferior izquierda
- Fullscreen: `<motion.video>` unmuted
- Thumbnail como poster

---

## 8. Security Rules

### Firestore

Sin cambios. `allow write: if false` para stars. Transiciones de mediaStatus validadas en handler updateStar.

### Storage

```
temp/{skyId}/{starId}/{fileName}:  create only (miembro activo, autor/editor, <50MB, video/*)
stars/{skyId}/{starId}/video:      read only (miembro activo). Write: Admin SDK.
stars/{skyId}/{starId}/thumb:      read only (miembro activo). Write: Admin SDK.
```

---

## 9. Cleanup

| Evento | Limpieza |
|--------|----------|
| deleteStar | mediaPath + thumbnailPath + temp/{skyId}/{starId}/raw |
| deleteSky cascade | mediaPath + thumbnailPath de cada estrella + temp/{skyId}/** |
| processVideoClip exito | Borra raw de temp/ |
| processVideoClip error | Borra raw + parciales en stars/ |
| Cron (cada 15 min) | Estrellas en `processing` > 15 min → reset + borra temp/ |

---

## 10. Estructura de Archivos

### Backend

```
functions/src/
  handlers/processVideoClip.ts       # Storage trigger (onObjectFinalized)
  handlers/cleanupZombieStars.ts     # Cron scheduled (cada 15 min)
  handlers/processVideoClip.test.ts  # 14 tests
  handlers/cleanupZombieStars.test.ts # 5 tests
  lib/ffmpeg.ts                      # Wrapper FFmpeg (execFile + @ffmpeg-installer)
  migrations/migrateImagePathToMediaPath.ts  # Script one-time (ejecutado)
```

### Frontend

```
frontend/src/
  components/sky/VideoTrimmer.tsx     # Filmstrip + handles + preview
  lib/firebase/storage.ts            # +uploadStarVideo()
```

### Archivos modificados (Fase 1)

```
functions/src/domain/contracts.ts    # +MediaType, +MediaStatus, StarRecord 5 campos
frontend/src/domain/contracts.ts     # Mirror
functions/src/domain/policies.ts     # +6 constantes video
frontend/src/domain/policies.ts      # Mirror
functions/src/domain/defaults.ts     # +videoProcessedToday, +lastVideoProcessDate
functions/src/handlers/stars.ts      # createStar, updateStar (mediaStatus), deleteStar
functions/src/handlers/skies.ts      # deleteSky cascade
functions/src/handlers/userSync.ts   # +campos video en UserRecord
storage.rules                        # +temp/, +video, +thumb rules
firestore.indexes.json               # +composite index stars (mediaStatus + updatedAt)
frontend/src/components/sky/StarFormSheet.tsx   # Selector + upload + estados
frontend/src/components/sky/StarOverlay.tsx     # Playback video
frontend/src/pages/SkyPage.tsx                  # Sync selectedStar
```

---

## 11. Indice Firestore

```json
{
  "collectionGroup": "stars",
  "queryScope": "COLLECTION_GROUP",
  "fields": [
    { "fieldPath": "mediaStatus", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "ASCENDING" }
  ]
}
```

Requerido por el cron `cleanupZombieStars`.
