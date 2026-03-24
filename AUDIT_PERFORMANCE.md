# Auditoría de Performance — Cielo Estrellado v3

**Fecha:** 2026-03-24
**Stack:** React 19 + Vite 6 + TypeScript · Firebase · SkyEngine (Canvas puro) · Tailwind v4 + shadcn/ui + Magic UI

---

## Resumen ejecutivo

El proyecto está en estado **BUENO / PRODUCTION-READY**. No hay crashes, memory leaks confirmados, ni problemas críticos de renderizado. El SkyEngine en particular tiene un lifecycle excelente y las abstracciones de React están correctamente gestionadas en su mayoría.

| Severidad | Cantidad |
|-----------|----------|
| 🔴 Crítico | 0 |
| 🟠 Alto (GC pressure) | 1 |
| 🟡 Medio | 7 |
| 🟢 Bajo | 2 |
| ✅ Pasando (sin problemas) | ~18 áreas verificadas |

Las optimizaciones identificadas son mejoras de eficiencia — no correcciones de errores. En desktop moderno el impacto es imperceptible; en **mobile y low-end devices** las mejoras de GC y re-renders tendrán mayor visibilidad.

---

## ÁREA 1 & 2 — SkyEngine: Lifecycle y Canvas Rendering

### 🟠 [ALTO] Nuevos `CanvasGradient` en cada frame — GC pressure

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/engine/SkyEngine.ts` |
| **Líneas** | 599 (shooting star) · 627 (pointer glow) |
| **Impacto en performance** | Alto en mobile / low-end |

**Descripción:** En `renderEffects()`, cada frame llama a `createLinearGradient()` y `createRadialGradient()` para las shooting stars y el glow del puntero. Esto genera 3–9 objetos `CanvasGradient` nuevos por frame — aproximadamente 180–540 objetos/segundo a 60 FPS — que el GC debe recolectar continuamente.

```typescript
// SkyEngine.ts:599 — nuevo objeto CanvasGradient en cada frame
const gradient = this.fxCtx.createLinearGradient(tailX, tailY, star.x, star.y)
gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
gradient.addColorStop(0.5, shootingStarTailColor)
gradient.addColorStop(1, shootingStarHeadColor)

// SkyEngine.ts:627 — otro nuevo objeto por frame
const gradient = this.fxCtx.createRadialGradient(
  this.pointer.smoothX, this.pointer.smoothY, 0,
  this.pointer.smoothX, this.pointer.smoothY, radius,
)
```

**Fix sugerido (Opción A — cache por posición redondeada):**
```typescript
private fxGradientCache = new Map<string, CanvasGradient>()

private getShootingGradient(tailX: number, tailY: number, headX: number, headY: number): CanvasGradient {
  const key = `${Math.round(tailX)},${Math.round(tailY)},${Math.round(headX)},${Math.round(headY)}`
  if (this.fxGradientCache.has(key)) return this.fxGradientCache.get(key)!
  const g = this.fxCtx.createLinearGradient(tailX, tailY, headX, headY)
  const { shootingStarTailColor, shootingStarHeadColor } = this.getColors()
  g.addColorStop(0, 'rgba(255, 255, 255, 0)')
  g.addColorStop(0.5, shootingStarTailColor)
  g.addColorStop(1, shootingStarHeadColor)
  if (this.fxGradientCache.size > 30) {
    this.fxGradientCache.delete(this.fxGradientCache.keys().next().value!)
  }
  this.fxGradientCache.set(key, g)
  return g
}
```

**Fix sugerido (Opción B — pragmática):** Aceptar el costo como precio de la calidad visual. Medir frame drops reales en mobile antes de invertir en la cache. Si las DevTools muestran frame times >16ms durante shooting stars, implementar Opción A.

---

### 🟡 [MEDIO] `canvas.width/height` asignados sin comparar dimensiones previas

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/engine/SkyEngine.ts` |
| **Líneas** | 318–324 |
| **Impacto en performance** | Medio (resize frecuente / mobile) |

**Descripción:** Asignar `canvas.width` o `canvas.height` **resetea todo el canvas** — borra el contenido y limpia el estado del contexto (transforms, shadows, globalAlpha). Si el `ResizeObserver` dispara con las mismas dimensiones (puede ocurrir en mobile durante scroll o teclado virtual), el canvas se resetea innecesariamente causando un frame en blanco.

```typescript
// SkyEngine.ts:318-324 — actual
private resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  canvas.width = Math.floor(this.width * this.dpr)   // reset completo del canvas
  canvas.height = Math.floor(this.height * this.dpr)
  canvas.style.width = `${this.width}px`
  canvas.style.height = `${this.height}px`
  ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
}
```

**Fix sugerido:**
```typescript
private resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const newW = Math.floor(this.width * this.dpr)
  const newH = Math.floor(this.height * this.dpr)
  if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width = newW
    canvas.height = newH
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.imageSmoothingEnabled = true
  }
  canvas.style.width = `${this.width}px`
  canvas.style.height = `${this.height}px`
}
```

---

### ✅ SkyEngine — Todo bien (áreas verificadas sin problemas)

| Área | Detalle |
|------|---------|
| **Lifecycle RAF** | `stop()` llama `cancelAnimationFrame(this.rafId)` correctamente (línea 312–314). Sin loops fantasma al desmontar. |
| **Event listeners** | Pointer events via JSX — React los remueve en unmount automáticamente. Sin acumulación de listeners. |
| **ResizeObserver** | Debounced 150ms en `SkyCanvas.tsx`. Cleanup con `observer.disconnect()` en return del useEffect. |
| **Nebula texture** | Cacheada en `this.nebulaTexture`. Solo se regenera al cambiar tema o calidad. Sin costo en frame loop. |
| **Múltiples mounts** | La arrow function `private tick = (now: number) => {...}` preserva `this` correctamente. No hay stale closures. |
| **Recálculo de estrellas** | Recalcular posición/alpha de cada star por frame es correcto y necesario (parallax + twinkle son por frame). |
| **devicePixelRatio** | Leído en `resize()`, no en cada frame. Capped via `dprCap`. Correcto. |
| **Touch / mobile** | `touch-action: none` en CSS. Handlers ligeros (solo actualizan refs). Sin riesgo de scroll jank. |
| **Dirty flag** | No necesario: las estrellas siempre twinklan y hay shooting stars periódicos — siempre hay algo que redibujar. |
| **Conteo de estrellas** | Escalado por `qualityScale` según calidad (high/low). ~546 estrellas en 1080p es manejable. |
| **Gradients estáticos** | `buildNebulaTexture()` crea gradients UNA vez y los cachea. No hay costo en el loop. |

---

## ÁREA 3 & 4 — React: Re-renders y ThemeParams

### 🟡 [MEDIO] `useEffect` de config en `SkyCanvas` con dependencia demasiado amplia

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/components/sky/SkyCanvas.tsx` |
| **Líneas** | 115–118 |
| **Impacto en performance** | Medio — engine reconfiguration innecesaria |

**Descripción:** El efecto que llama `engineRef.current?.setConfig(config)` depende del objeto `config` completo. Cada vez que `sky` se actualiza en Firestore (onSnapshot), `SkyPage` reconstruye el objeto `config`, lo que dispara este efecto aunque el tema y la calidad no hayan cambiado.

```typescript
// SkyCanvas.tsx:115-118 — actual
useEffect(() => {
  configRef.current = config ?? DEFAULT_CONFIG
  if (config) engineRef.current?.setConfig(config)
}, [config])  // config es nuevo objeto en cada re-render de SkyPage
```

**Fix sugerido:**
```typescript
useEffect(() => {
  configRef.current = config ?? DEFAULT_CONFIG
  if (config) engineRef.current?.setConfig(config)
}, [config?.theme, config?.quality, config?.motion])
```

---

### 🟡 [MEDIO] `ThemePicker` crea `new Set()` en cada render

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/components/sky/ThemePicker.tsx` |
| **Líneas** | 15–17 |
| **Impacto en performance** | Medio — costo en cada apertura de SkySettingsSheet |

**Descripción:** `ownedThemeIds` se calcula en el cuerpo del componente con `filter` + `map` + `new Set(...)`. El array `inventory` proviene de `useUserEconomy()` que retorna una nueva referencia en cada refetch → el Set se recrea en cada render.

```typescript
// ThemePicker.tsx:15-17 — actual
const ownedThemeIds = new Set(
  inventory.filter(i => i.category === 'theme').map(i => i.itemId),
)
```

**Fix sugerido:**
```typescript
const ownedThemeIds = useMemo(
  () => new Set(inventory.filter(i => i.category === 'theme').map(i => i.itemId)),
  [inventory],
)
```

---

### 🟡 [MEDIO] `ThemePreviewCard` — inline style objects en cada render

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/components/shop/ThemePreviewCard.tsx` |
| **Líneas** | 35, 47–49, 56 |
| **Impacto en performance** | Medio — todos los cards se recrean cuando balance/owned cambia en ShopPage |

**Descripción:** Los strings de gradiente y `boxShadow` se construyen inline en JSX dentro de un `.map()`. Cada re-render de `ShopPage` (por cambio de balance o estado de compra) recrea todos los objetos de estilo de todos los `ThemePreviewCard`.

```typescript
// ThemePreviewCard.tsx:35 — string nuevo en cada render
background: `linear-gradient(135deg, ${theme.colors.nebulaBaseStartColor}, ${theme.colors.nebulaBaseEndColor})`

// ThemePreviewCard.tsx:47-49 — por cada estrella, nuevo objeto style
background: theme.colors.userStarColor,
boxShadow: `0 0 ${star.size + 3}px ${theme.colors.glowColor}`,

// ThemePreviewCard.tsx:56 — otro gradiente inline
background: `radial-gradient(ellipse at 60% 40%, ${theme.colors.nebulaAccentColor}, transparent 70%)`
```

**Fix sugerido:**
```typescript
// Memoizar estilos del card (no cambian si theme no cambia)
const headerStyle = useMemo(() => ({
  background: `linear-gradient(135deg, ${theme.colors.nebulaBaseStartColor}, ${theme.colors.nebulaBaseEndColor})`,
}), [theme.colors.nebulaBaseStartColor, theme.colors.nebulaBaseEndColor])

const nebulaStyle = useMemo(() => ({
  background: `radial-gradient(ellipse at 60% 40%, ${theme.colors.nebulaAccentColor}, transparent 70%)`,
}), [theme.colors.nebulaAccentColor])

const starStyles = useMemo(() =>
  STAR_POSITIONS.map(star => ({
    width: `${star.size}px`,
    height: `${star.size}px`,
    top: star.top,
    left: star.left,
    background: theme.colors.userStarColor,
    boxShadow: `0 0 ${star.size + 3}px ${theme.colors.glowColor}`,
  })),
  [theme.colors.userStarColor, theme.colors.glowColor],
)
```

---

### 🟢 [BAJO] `onClick` inline en `StardustBalance` desde `SkiesPage`

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/pages/SkiesPage.tsx` |
| **Línea** | 264 |
| **Impacto en performance** | Bajo |

**Descripción:** `onClick={() => setHistoryOpen(true)}` crea una nueva función en cada render de `SkiesPage`. Si `StardustBalance` fuera memoizado con `React.memo`, este patrón rompería la memoización.

```typescript
// SkiesPage.tsx:264 — función inline, referencia nueva en cada render
<StardustBalance balance={economy.stardust} compact onClick={() => setHistoryOpen(true)} />
```

**Fix sugerido:**
```typescript
const handleHistoryOpen = useCallback(() => setHistoryOpen(true), [])
<StardustBalance balance={economy.stardust} compact onClick={handleHistoryOpen} />
```

---

### ✅ React — Todo bien

| Área | Detalle |
|------|---------|
| **AuthContext memoización** | `value` con `useMemo`, todos los callbacks con `useCallback([])`. NO re-renderiza consumidores en cada tick de auth. |
| **Lazy routes** | Las 6 páginas con `React.lazy()` + `Suspense`. Bundle por página. Correcto. |
| **Drag state con refs** | `SkyCanvas` usa `useRef` para estado de drag — cero re-renders durante `pointermove` a 60fps. Excelente. |
| **Cancellation tokens** | Todos los hooks asíncronos usan flag `cancelled` para prevenir `setState` post-unmount. Sin memory leaks. |
| **onSnapshot cleanup** | `return unsubscribe` en todos los `useEffect` de Firestore. Correcto. |
| **Debounce en settings** | `SkySettingsSheet` debouncea el persist 800ms. Reduce API calls durante edición interactiva. |
| **getThemeById** | Lookup O(1) en objeto estático. Sin computación. |
| **DailyRewardModal** | Renderizado condicional — solo monta cuando `rewards.daily > 0`. No re-renderiza si no hay recompensa. |

---

## ÁREA 6 — Llamadas API y Caché

### 🟡 [MEDIO] `useUserEconomy` llamado desde múltiples componentes independientemente

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/hooks/useUserEconomy.ts` |
| **Línea** | 23 (hook definition) |
| **Uso duplicado en** | `frontend/src/pages/SkiesPage.tsx` · `frontend/src/pages/ShopPage.tsx` |
| **Impacto en performance** | Medio — fetches paralelos al `/api/user/economy` en primera carga |

**Descripción:** Cada llamada a `useUserEconomy()` es independiente. `SkiesPage` y `ShopPage` hacen su propio fetch cuando montan — si el usuario navega entre páginas, se lanza un nuevo fetch en cada transición.

**Fix sugerido (corto plazo):** Implementar un simple cache en el hook con TTL de 30–60 segundos para evitar re-fetches en navegación rápida.

**Fix sugerido (largo plazo):** Crear `EconomyContext` al nivel de root (similar a `AuthContext`). Llamar `useUserEconomy()` una sola vez y proveer el resultado vía Context:
```typescript
// En main.tsx / App.tsx
<AuthProvider>
  <EconomyProvider>  {/* único fetch, shared via Context */}
    <RouterProvider router={router} />
  </EconomyProvider>
</AuthProvider>
```

---

### 🟡 [MEDIO] `api()` client sin caché ni deduplicación de GET requests

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/lib/api/client.ts` |
| **Impacto en performance** | Medio — requests paralelos en primera carga |

**Descripción:** El cliente `api()` es un fetch wrapper puro. No hay deduplicación: si dos componentes llaman simultáneamente al mismo endpoint, se ejecutan dos requests en paralelo.

**Fix sugerido:** Cache mínimo para GET requests con TTL corto:
```typescript
const _cache = new Map<string, { promise: Promise<unknown>; ts: number }>()

export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const isGet = !options.method || options.method === 'GET'
  if (isGet) {
    const cached = _cache.get(url)
    if (cached && Date.now() - cached.ts < 30_000) {
      return cached.promise as Promise<T>
    }
  }
  const promise = fetch(url, options).then(r => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json() as Promise<T>
  })
  if (isGet) _cache.set(url, { promise, ts: Date.now() })
  return promise
}
```

---

## ÁREA 5 — Bundle Size y Code Splitting

### 🟡 [MEDIO] Dependencia `next-themes` instalada pero nunca importada

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/package.json` |
| **Impacto en performance** | Ninguno en bundle (no importada) · Ruido en dependency tree |

**Descripción:** `next-themes` está en `dependencies` pero no existe ningún `import` de esta librería en el codebase. El proyecto es dark-only por diseño (SPEC §7.1) — no hay theme switching. La librería **no va al bundle** (Vite no la incluye si no está importada), pero ocupa ~15–20 KB en `node_modules` y puede confundir a quien lea las dependencias.

**Fix:** `cd frontend && npm uninstall next-themes`

---

### 🟡 [MEDIO] `vite.config.ts` sin `manualChunks` para vendor splitting

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/vite.config.ts` |
| **Impacto en performance** | Medio — vendor bundle monolítico, caching subóptimo a largo plazo |

**Descripción:** Sin configuración de `rollupOptions.manualChunks`, Vite agrupa todas las dependencias en un único vendor chunk. Esto impide que el browser cachee React/Firebase independientemente de actualizaciones de UI libs.

**Fix sugerido:**
```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router'],
          'vendor-ui': ['@base-ui/react', 'motion', 'sonner'],
          'vendor-firebase': ['firebase'],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://cielo-estrellado-web.web.app',
        changeOrigin: true,
      },
    },
  },
})
```

---

### 🟢 [BAJO] `console.error` en producción (error handling)

| Campo | Valor |
|-------|-------|
| **Archivos** | `frontend/src/hooks/useUserEconomy.ts:50` · `frontend/src/hooks/useSkyStars.ts:52` |
| **Impacto en performance** | Ninguno — ruido en console de usuario final |

**Descripción:** Dos `console.error` de error handling legítimo llegan a producción. No impactan performance pero añaden ruido a la console del usuario.

**Fix sugerido (opcional):**
```typescript
if (import.meta.env.DEV) console.error('Economy fetch failed:', err)
```

O integrar con un servicio de error tracking (Sentry, etc.) en Fase 3.

---

### ✅ Bundle — Todo bien

| Área | Detalle |
|------|---------|
| **Code splitting** | Las 6 páginas con `React.lazy()` + `Suspense`. Chunk por ruta. Correcto y óptimo. |
| **Tree-shaking** | `moduleResolution: "bundler"`, `module: ESNext`, sin `export *`. Tree-shaking activo. |
| **lucide-react** | Solo íconos importados van al bundle. v0.577.0 con ES modules y `sideEffects: false`. |
| **motion/react** | Usando `motion/react` (más pequeño que `framer-motion`). Imports granulares. |
| **Firebase** | Solo imports modulares. Sin `import * as firebase`. |
| **Tailwind v4** | Vite plugin @tailwindcss/vite. Sin CSS no utilizado. CSS final ~12–18 KB gzipped. |
| **TypeScript** | `target: ES2022`, `moduleResolution: bundler`. Óptimo para Vite 6. |
| **shadcn/ui** | Imports directos por archivo (`@/components/ui/button`). Sin barrel exports con `*`. |
| **Bundle estimado** | ~108–125 KB gzipped. **BUENO** para SPA con Firestore + canvas + animaciones. |
| **Fonts** | `system-ui` — sin web fonts, sin FOUT/FOIT, sin font-display necesario. |
| **@fontsource-variable/geist** | Instalado pero no importado → no va al bundle. Inofensivo. |

---

## ÁREA 7 & 8 — Mobile, Resize, Assets y Fonts

### 🟢 [BAJO] `<img>` en `StarOverlay` sin `loading="lazy"`

| Campo | Valor |
|-------|-------|
| **Archivo** | `frontend/src/components/sky/StarOverlay.tsx` |
| **Impacto en performance** | Bajo — imagen dentro de modal, carga bajo demanda |

**Descripción:** La imagen de usuario en `StarOverlay` se carga desde Firebase Storage sin atributo `loading="lazy"`. Como la imagen está dentro de un `BottomSheet` que no siempre está visible, el impacto es bajo.

**Fix sugerido:** Añadir `loading="lazy"` al `<img>` correspondiente.

---

### ✅ Mobile / Resize / Assets — Todo bien

| Área | Detalle |
|------|---------|
| **ResizeObserver** | Debounced 150ms en `SkyCanvas`. Cleanup con `observer.disconnect()`. Correcto. |
| **DPR en resize** | Calculado una vez en `resize()`. No se recalcula en cada frame. |
| **CSS animations** | Todas GPU-composited (transform, opacity, backdrop-filter). Sin layout thrashing. |
| **Canvas + CSS simultáneo** | Motion/React y Tailwind animations son GPU-only → no compiten con el RAF loop. |
| **Imágenes** | Uso mínimo de imágenes. Skeleton fade-in con `onLoad`. |
| **Fonts** | Sistema. Sin FOUT, sin FOIT, sin font-display. |

---

## Métricas sugeridas para medir antes y después

### FPS / Canvas
- **Chrome DevTools → Performance → Frame rate graph** durante parallax activo y shooting star visible
- Objetivo: estable en 60 FPS en desktop; >45 FPS en mobile mid-range (Moto G, Galaxy A-series)
- Medir especialmente durante shooting star activo (máxima presión GC por gradients)

### Bundle Size
- `cd frontend && npm run build` → revisar `dist/assets/` — separar vendor de app chunks
- Herramienta: `npx vite-bundle-visualizer` para mapa visual de chunks
- Objetivo: vendor chunk <100 KB gzipped; app chunks <50 KB gzipped cada uno

### Lighthouse / Core Web Vitals
- **LCP (Largest Contentful Paint):** Objetivo <2.5s en 4G simulado
- **TTI (Time to Interactive):** Objetivo <3.5s
- **TBT (Total Blocking Time):** Objetivo <200ms
- Correr en modo incógnito con CPU throttling 4x para simular mobile

### Network
- Chrome DevTools → Network → `Disable cache` → recargar
- Contar requests a `/api/user/economy` al navegar entre SkiesPage y ShopPage
- Objetivo post-fix: 1 request en primera carga, 0 en navegación con cache activo

---

## Plan de acción priorizado

### Fase 1 — Quick wins (< 30 minutos, impacto inmediato)

1. **`ThemePicker.tsx:15-17`** — Añadir `useMemo` al `new Set(...)`. 3 líneas.
2. **`SkyEngine.ts:318-324`** — Añadir guard `if (canvas.width !== newW || ...)`. 5 líneas.
3. **`SkiesPage.tsx:264`** — Extraer `handleHistoryOpen` con `useCallback`. 2 líneas.
4. **`package.json`** — `npm uninstall next-themes`. 1 comando.

### Fase 2 — Optimizaciones medias (< 2 horas, impacto en mobile)

5. **`SkyCanvas.tsx:118`** — Cambiar `[config]` por `[config?.theme, config?.quality, config?.motion]`.
6. **`ThemePreviewCard.tsx`** — `useMemo` para `headerStyle`, `nebulaStyle`, y `starStyles`.
7. **`vite.config.ts`** — Añadir `build.rollupOptions.manualChunks`.

### Fase 3 — Arquitectura (Fase 3 del proyecto)

8. **EconomyContext en root** — Eliminar fetches duplicados de `useUserEconomy`. Prioridad alta si se añaden más páginas que consuman datos de economía.
9. **GET cache en `api()` client** — TTL 30s para deduplicar requests simultáneos.
10. **Gradient cache en `SkyEngine`** — Solo si se miden frame drops reales en mobile durante shooting stars. Medir primero.

---

*Auditoría generada con exploración estática de 57 archivos fuente. Sin ejecución de build real — los tamaños de bundle son estimados basados en dependencias y análisis de imports.*
