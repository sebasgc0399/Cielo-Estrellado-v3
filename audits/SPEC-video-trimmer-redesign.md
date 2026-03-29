# SPEC: Rediseno del VideoTrimmer — Filmstrip con Thumbnails

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** Revision de UX post-implementacion de SPEC_v3 (video clips)
**Archivos afectados:**
- `frontend/src/components/sky/VideoTrimmer.tsx` (rewrite completo)
- `frontend/src/styles/globals.css` (reemplazar CSS `.trim-slider`)

## Contexto

El VideoTrimmer actual usa dos `<input type="range">` superpuestos para marcar el rango de recorte de video. El resultado visual es insatisfactorio:

1. **Los sliders se ven genericos** — thumbs circulares blancos que parecen controles del sistema operativo, no parte del design system de la app.
2. **No hay feedback visual del contenido** — el usuario ve una barra azul con dos puntos, pero no sabe *que* contiene el video en cada segundo. Tiene que reproducir el video mentalmente para saber donde recortar.
3. **La interaccion es imprecisa en mobile** — dos range inputs superpuestos compiten por el touch target. Es facil mover el thumb equivocado.

El rediseno propone un **filmstrip con thumbnails reales del video** (estilo WhatsApp/Instagram) con **handles laterales arrastrables** que muestren visualmente el contenido del video en cada punto.

---

## Codigo actual relevante

### VideoTrimmer.tsx — Estructura

```typescript
interface VideoTrimmerProps {
  file: File
  onConfirm: (trimStart: number, trimEnd: number) => void
  onCancel: () => void
}

// Constraints
const MAX_CLIP_DURATION = 6  // max 6 segundos
const MIN_CLIP_DURATION = 1  // min 1 segundo
```

**Integracion con StarFormSheet.tsx:**
- Parent almacena `videoFile`, `trimData`, `showTrimmer`
- VideoTrimmer se renderiza condicionalmente dentro del BottomSheet
- Al confirmar: `handleTrimConfirm(start, end)` guarda en `trimData`
- `trimData` se pasa a `uploadStarVideo()` como metadata de recorte

**Props interface no cambia.** El contrato `(file, onConfirm, onCancel)` se mantiene identico.

### globals.css — CSS actual (lineas 181-225)

44 lineas de CSS para `.trim-slider`: appearance reset, thumbs 24px, pointer-events hack para superponer dos inputs, track transparency. **Todo este CSS se elimina** en el rediseno.

---

## Diseno propuesto

### Vision general

Reemplazar los range inputs por una **filmstrip horizontal** de thumbnails extraidos del video, con **dos handles verticales** (izquierdo/derecho) que el usuario arrastra para seleccionar el rango. Las zonas fuera del rango se oscurecen.

```
┌──────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────┐ │
│  │  [frame1][frame2][frame3][frame4][frame5]   │ │
│  └─────────────────────────────────────────────┘ │
│  ▏████████████████████████████▕                  │
│  ↑ handle izq              handle der ↑          │
│                                                  │
│  0:00.3 – 0:04.5           ✂ 4.2s / 6.0s       │
│                                                  │
│  [Cancelar]                    [Adjuntar]         │
└──────────────────────────────────────────────────┘
```

**Capas visuales (de abajo hacia arriba):**
1. **Filmstrip** — fila de thumbnails extraidos del video via canvas
2. **Overlay oscuro** — cubre las zonas fuera del rango seleccionado (`rgba(0,0,0,0.6)`)
3. **Handles** — barras verticales blancas en los bordes izquierdo/derecho del rango, con borde superior/inferior azul brillante
4. **Borde del rango** — linea fina blanca/azul arriba y abajo del segmento seleccionado

### Estructura del componente

```typescript
// Estado interno
const [thumbnails, setThumbnails] = useState<string[]>([])  // data URLs de frames
const [duration, setDuration] = useState(0)
const [trimStart, setTrimStart] = useState(0)
const [trimEnd, setTrimEnd] = useState(0)
const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

// Refs
const videoRef = useRef<HTMLVideoElement>(null)      // video oculto para extraccion
const canvasRef = useRef<HTMLCanvasElement>(null)     // canvas oculto para frames
const containerRef = useRef<HTMLDivElement>(null)     // contenedor de filmstrip
const playbackVideoRef = useRef<HTMLVideoElement>(null)  // video visible para preview
```

### Extraccion de thumbnails

```typescript
async function extractThumbnails(video: HTMLVideoElement, count: number): Promise<string[]> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const thumbHeight = 56  // altura fija
  const thumbWidth = Math.round((video.videoWidth / video.videoHeight) * thumbHeight)
  canvas.width = thumbWidth
  canvas.height = thumbHeight

  const frames: string[] = []
  const interval = video.duration / count

  for (let i = 0; i < count; i++) {
    video.currentTime = i * interval
    await new Promise<void>(resolve => {
      video.onseeked = () => resolve()
    })
    ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight)
    frames.push(canvas.toDataURL('image/jpeg', 0.6))
  }

  return frames
}
```

**Cantidad de frames:** 8-10 thumbnails. Con un video de max 6s a recortar, esto da ~0.6-0.75s por frame — suficiente granularidad visual.

### Drag handling

**No se usan range inputs.** La interaccion es touch/mouse drag directo:

```typescript
// Convertir posicion de pixel a timestamp
function pixelToTime(clientX: number): number {
  const rect = containerRef.current!.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return ratio * duration
}

// Handlers
function handlePointerDown(e: React.PointerEvent, handle: 'start' | 'end') {
  e.preventDefault()
  setDragging(handle)
  containerRef.current?.setPointerCapture(e.pointerId)
}

function handlePointerMove(e: React.PointerEvent) {
  if (!dragging) return
  const time = pixelToTime(e.clientX)
  if (dragging === 'start') {
    handleStartChange(time)
  } else {
    handleEndChange(time)
  }
}

function handlePointerUp() {
  setDragging(null)
}
```

**Ventaja sobre range inputs:** Un solo handler de pointer, sin conflicto de z-index entre dos inputs, funciona identico en touch y mouse.

### Renderizado

```tsx
<div ref={containerRef} className="relative h-14 w-full overflow-hidden rounded-lg"
     onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}>

  {/* Filmstrip */}
  <div className="flex h-full">
    {thumbnails.map((src, i) => (
      <img key={i} src={src} className="h-full flex-1 object-cover" draggable={false} />
    ))}
  </div>

  {/* Overlay izquierdo (fuera del rango) */}
  <div className="absolute inset-y-0 left-0"
       style={{ width: `${leftPercent}%`, background: 'rgba(0,0,0,0.6)' }} />

  {/* Overlay derecho (fuera del rango) */}
  <div className="absolute inset-y-0 right-0"
       style={{ width: `${100 - rightPercent}%`, background: 'rgba(0,0,0,0.6)' }} />

  {/* Borde del rango seleccionado */}
  <div className="absolute inset-y-0 pointer-events-none"
       style={{
         left: `${leftPercent}%`,
         width: `${rightPercent - leftPercent}%`,
         borderTop: '2px solid rgba(100, 160, 255, 0.8)',
         borderBottom: '2px solid rgba(100, 160, 255, 0.8)',
       }} />

  {/* Handle izquierdo — hit area 44px, visual 4px */}
  <div className="absolute inset-y-0 cursor-col-resize flex items-center justify-center"
       style={{ width: 44, left: `calc(${leftPercent}% - 22px)` }}
       onPointerDown={(e) => handlePointerDown(e, 'start')}>
    <div className="h-6 w-1 rounded-full bg-white shadow-[0_0_6px_rgba(100,160,255,0.8)]" />
  </div>

  {/* Handle derecho — hit area 44px, visual 4px */}
  <div className="absolute inset-y-0 cursor-col-resize flex items-center justify-center"
       style={{ width: 44, left: `calc(${rightPercent}% - 22px)` }}
       onPointerDown={(e) => handlePointerDown(e, 'end')}>
    <div className="h-6 w-1 rounded-full bg-white shadow-[0_0_6px_rgba(100,160,255,0.8)]" />
  </div>
</div>
```

### Video preview

El video preview (reproduccion del segmento seleccionado) se mantiene **arriba** de la filmstrip, identico al actual: `<video playsInline muted>` con loop via requestAnimationFrame.

### Layout completo

```
┌── BottomSheet ("Recortar clip") ──────┐
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  <video> preview (max 40vh)     │  │
│  │  Reproduce segmento en loop     │  │
│  └──────────────────────────────────┘  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │  Filmstrip con handles (56px h) │  │
│  └──────────────────────────────────┘  │
│                                        │
│  0:00.3 – 0:04.5      ✂ 4.2s / 6.0s  │
│                                        │
│  [Cancelar]              [Adjuntar]    │
└────────────────────────────────────────┘
```

---

## Decisiones de diseno

### Elegido: Filmstrip con canvas.drawImage()

**Razon:** Es el patron estandar de trimming en apps de mensajeria (WhatsApp, Telegram, Instagram). El usuario ve el contenido visual del video distribuido en el timeline, lo que le permite orientarse sin reproducir el video. `canvas.drawImage(video, ...)` funciona en todos los navegadores modernos incluyendo iOS Safari 15+.

### Descartado: Range inputs con CSS custom

**Razon:** La implementacion actual. Dos range inputs superpuestos con `pointer-events: none` y `position: absolute` crean conflictos de z-index en mobile, no dan feedback visual del contenido, y son dificiles de estilizar consistentemente cross-browser (WebKit vs Firefox vs Safari pseudo-elements).

### Descartado: Video.captureStream() + MediaRecorder para frames

**Razon:** API mas compleja, soporte inconsistente en Safari, y no ofrece ventaja sobre `canvas.drawImage()` para thumbnails estaticos.

### Descartado: OffscreenCanvas + Web Workers para extraccion

**Razon:** Overengineering. Extraer 8-10 frames de ~100x56px toma <500ms incluso en dispositivos lentos. No justifica la complejidad de workers. El proyecto no usa OffscreenCanvas en ningun otro lugar.

### Descartado: Libreria de trimmer (react-video-trimmer, etc.)

**Razon:** Agrega dependencia externa para un componente que es ~150 lineas de codigo. El proyecto evita dependencias innecesarias (filosofia de CLAUDE.md: "no crear abstracciones sin 3 usos reales").

### Elegido: Pointer Events en vez de Touch + Mouse separados

**Razon:** `PointerEvent` unifica touch, mouse y stylus en un solo API. `setPointerCapture()` garantiza que el drag sigue al dedo aunque salga del contenedor. Soportado en todos los navegadores target.

### Elegido: data URLs para thumbnails (no blob URLs)

**Razon:** Los thumbnails son imagenes pequenas (~2-5KB cada una). Usar `canvas.toDataURL('image/jpeg', 0.6)` evita el lifecycle management de blob URLs (crear, revocar, limpiar). Para 10 frames de 100x56px, el overhead de base64 es negligible.

---

## Impacto en otros archivos

### No cambian:
- `StarFormSheet.tsx` — La interface `VideoTrimmerProps` se mantiene identica: `(file, onConfirm, onCancel)`. El parent no sabe ni necesita saber como funciona internamente el trimmer.
- `storage.ts` — `uploadStarVideo()` recibe `trimStart/trimEnd` como numeros. Sin cambios.
- `StarOverlay.tsx` — Playback independiente del trimmer. Sin cambios.
- `SkyPage.tsx` — Sin cambios.

### Cambian:
- `VideoTrimmer.tsx` — **Rewrite completo** del componente. Misma interface, distinta implementacion.
- `globals.css` — **Eliminar** las 44 lineas de CSS `.trim-slider` (lineas 181-225). Ya no se usan range inputs.

---

## Riesgos tecnicos

### canvas.drawImage() con video — Compatibilidad cross-browser

| Navegador | Soporte | Notas |
|-----------|---------|-------|
| Chrome/Edge | Completo | Sin restricciones |
| Firefox | Completo | Sin restricciones |
| Safari 15+ | Completo | Funciona con `<video playsInline>`. Requiere que el video tenga `crossOrigin` si viene de otro dominio (no aplica, es un archivo local) |
| Safari 14 | Parcial | `video.onseeked` puede no dispararse en el primer frame. Mitigacion: fallback con `setTimeout` |
| iOS Safari | Completo | Requiere `playsInline` y `muted` para autoplay. El video es un blob URL local, no hay restricciones CORS |

**Mitigacion para onseeked poco confiable:**

```typescript
await new Promise<void>(resolve => {
  const onSeeked = () => {
    video.removeEventListener('seeked', onSeeked)
    resolve()
  }
  video.addEventListener('seeked', onSeeked)
  // Fallback: si onseeked no dispara en 500ms, resolver de todos modos
  setTimeout(() => {
    video.removeEventListener('seeked', onSeeked)
    resolve()
  }, 500)
})
```

### Rendimiento de extraccion de frames

| Frames | Resolucion | Tiempo estimado | Bloqueo UI |
|--------|-----------|-----------------|------------|
| 8 | 100x56 | ~200-400ms | Imperceptible |
| 10 | 100x56 | ~300-500ms | Imperceptible |
| 20 | 100x56 | ~600-1000ms | Perceptible en gama baja |

**Conclusion:** 8-10 frames es el sweet spot. No se necesita Web Worker.

**UX durante extraccion:** Mientras se extraen los frames, mostrar un rectangulo de 56px de alto con la animacion `skeleton-sweep` existente del proyecto (misma que usa StarOverlay para imagenes). Los frames se renderizan **progresivamente**: cada `<img>` aparece individualmente cuando su dataURL esta listo, no todos al final. Esto da feedback inmediato — el usuario ve la filmstrip llenandose de izquierda a derecha en ~300ms.

```tsx
{/* Filmstrip con loading progresivo */}
<div className="flex h-14 w-full overflow-hidden rounded-lg">
  {Array.from({ length: FRAME_COUNT }).map((_, i) => (
    thumbnails[i] ? (
      <img key={i} src={thumbnails[i]} className="h-full flex-1 object-cover" draggable={false} />
    ) : (
      <div key={i} className="h-full flex-1" style={{
        background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-sweep 1.8s ease-in-out infinite',
      }} />
    )
  ))}
</div>
```

Para el renderizado progresivo, la funcion de extraccion actualiza el estado frame por frame:

```typescript
async function extractThumbnails(video: HTMLVideoElement, count: number,
  onFrame: (index: number, dataUrl: string) => void): Promise<void> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  canvas.width = Math.round((video.videoWidth / video.videoHeight) * 56)
  canvas.height = 56

  const interval = video.duration / count
  for (let i = 0; i < count; i++) {
    video.currentTime = i * interval
    await waitForSeeked(video)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    onFrame(i, canvas.toDataURL('image/jpeg', 0.6))  // actualiza estado parcial
  }
}
```

### Video sin audio track

Algunos videos grabados solo con camara frontal pueden no tener audio track. Esto no afecta la extraccion de frames ni el trimming — solo afecta al playback (que ya maneja el caso con `muted` como default).

### Videos cortos (< 1 segundo)

El trim minimo es 1 segundo. Si el video original dura menos de 1 segundo, no hay rango valido para recortar. **Manejar en handleMetadata:** si `duration < MIN_CLIP_DURATION`, mostrar toast de error y llamar `onCancel()`.

---

## Plan de tests

### Tests existentes
No existen tests unitarios para VideoTrimmer. No hay regresiones que manejar.

### Tests recomendados (post-implementacion)
El componente interactua con APIs del navegador (Video, Canvas, PointerEvent) que no estan disponibles en jsdom. Testing significativo requiere un browser real o mocks extensivos. Dado que el proyecto no tiene tests de componentes con canvas, se recomienda:

1. **Test de constraint logic** (puede extraerse a funcion pura):
   - `clampTrimStart(value, trimEnd, duration)` → respeta min 1s, max 6s
   - `clampTrimEnd(value, trimStart, duration)` → respeta min 1s, max 6s
   - Edge cases: video mas corto que 6s, video exactamente 6s, video de 1s

2. **Test manual visual** (checklist):
   - Seleccionar video → filmstrip aparece con thumbnails
   - Arrastrar handle izquierdo → rango se ajusta, video salta a nuevo start
   - Arrastrar handle derecho → rango se ajusta
   - Constraints: no puede bajar de 1s ni superar 6s
   - Confirmar → parent recibe trimStart/trimEnd correctos
   - Cancelar → parent recibe callback

---

## Verificacion

### Antes de cada commit

```bash
cd frontend && npx tsc --noEmit    # 0 errores TypeScript
cd frontend && npm run build       # build exitoso
cd frontend && npm run test:run    # tests existentes pasan (52)
```

### Checklist visual

- [ ] Video preview reproduce el segmento seleccionado en loop
- [ ] Filmstrip muestra thumbnails del video
- [ ] Handles arrastrables responden a touch y mouse
- [ ] Overlays oscurecen las zonas fuera del rango
- [ ] Borde azul visible en el rango seleccionado
- [ ] Constraint 1-6s funciona (no se puede bajar de 1s ni superar 6s)
- [ ] Time labels actualizan en tiempo real
- [ ] Botones Cancelar/Adjuntar funcionan
- [ ] iOS Safari: video no abre reproductor nativo (playsInline)
- [ ] Mobile: handles faciles de agarrar con el dedo (touch target >= 44px)

### Conteo esperado de tests

Sin cambios — 52 tests frontend se mantienen.

---

## Orden de implementacion

| Paso | Cambio | Complejidad | Razon del orden |
|------|--------|-------------|-----------------|
| 1 | Eliminar CSS `.trim-slider` de globals.css | Baja | Limpieza, no rompe nada |
| 2 | Rewrite VideoTrimmer.tsx | Alta | Componente independiente |
| 3 | Verificacion (tsc + build + visual) | Media | Confirmar todo funciona |

**Tiempo estimado:** El componente es ~180 lineas. La logica de constraints se reutiliza del actual. La extraccion de frames y drag handling son nuevos.
