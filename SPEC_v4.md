# SPEC v4 — Optimizacion de Rendimiento Frontend

> **Objetivo:** Bajar FCP de 4.4s a <2s y LCP de 5.2s a <2.5s (zona verde Google).
> **Principio:** No romper funcionalidad por optimizar. Cada fix es independiente y reversible.

---

## 1. Metricas actuales (PageSpeed Insights — Mobile)

| Metrica | Valor | Estado |
|---------|-------|--------|
| Performance | 69/100 | Naranja |
| First Contentful Paint (FCP) | 4.4s | Rojo |
| Largest Contentful Paint (LCP) | 5.2s | Rojo |
| Accesibilidad | 100/100 | Verde |
| Recomendaciones | 100/100 | Verde |
| SEO | 82/100 | Naranja |

### Desglose del LCP (dato clave de PageSpeed)

El **elemento LCP** es `<h1 class="text-[1.75rem]...">Cielo Estrellado</h1>` en la landing/login page.

| Fase LCP | Tiempo |
|----------|--------|
| Time to First Byte (TTFB) | ~600ms |
| Carga de recursos | ~2,230ms |
| **Retraso en renderizacion del elemento** | **2,370ms** |
| Duracion de renderizacion | ~0ms |

El dato critico: **2,370ms de "retraso en renderizacion"** = tiempo entre que el HTML llega y el `<h1>` se pinta. Eso es JavaScript bloqueando el render de un titulo que es **texto estatico puro**. No depende de Firebase, ni de auth, ni de datos. Si se renderizara sin esperar la hidratacion completa de React + todos los imports sincronos, el LCP bajaria drasticamente.

### JS sin usar confirmado por PageSpeed

| Chunk | Total transferido | Sin usar | % desperdiciado |
|-------|-------------------|----------|-----------------|
| vendor-firebase.js | 93.6 KB | 54.8 KB | 59% |
| vendor-ui.js | 60.3 KB | 37.2 KB | 62% |
| index.js | 61.9 KB | 25.0 KB | 40% |
| **Total** | **215.8 KB** | **117.0 KB** | **54%** |

### Cadena critica de requests (PageSpeed)

```
index.js ─── 434ms ──→ auth/iframe.js ─── 630ms ──→ getProjectConfig ─── 176ms
                                                     Total cadena: 1,240ms
```

Tres requests secuenciales antes de que Firebase Auth se resuelva. Esto se suma al waterfall de userSync (Fix 6).

**Objetivo:**

| Metrica | Actual | Objetivo |
|---------|--------|----------|
| FCP | 4.4s | <2.0s |
| LCP | 5.2s | <2.5s |
| Performance | 69 | >90 |

---

## 2. Diagnostico — Bundle y Critical Path

### 2.1 Composicion del bundle (post-build, gzip)

| Chunk | Raw | Gzip | % del total | Carga |
|-------|-----|------|-------------|-------|
| vendor-firebase | 490 KB | 115 KB | 34% | Eager (modulepreload) |
| index (app code) | 228 KB | 73 KB | 22% | Eager |
| vendor-ui | 216 KB | 70 KB | 21% | Eager (modulepreload) |
| vendor-react | 46 KB | 17 KB | 5% | Eager (modulepreload) |
| SkyPage | 55 KB | 15 KB | 4% | Lazy |
| SkiesPage | 28 KB | 8 KB | 2% | Lazy |
| SkyCanvas | 22 KB | 7 KB | 2% | Lazy (shared) |
| shopCatalog | 19 KB | 7 KB | 2% | Lazy |
| ShopPage | 15 KB | 5 KB | 2% | Lazy |
| themes | 11 KB | 2 KB | 1% | Lazy |
| Otros (dialog, login, invite, profile, micro-chunks) | ~25 KB | ~11 KB | 3% | Lazy |
| CSS (index + SkyCanvas) | 70 KB | 12 KB | 4% | Eager |
| **Total** | **~1,203 KB** | **~334 KB** | **100%** | |

**JS critico (eager, antes del primer render): ~275 KB gzip**

### 2.2 Cadena critica: script → primer pixel

```
T0   HTML parseado → fondo #05080f visible (inline CSS)
T1   Vite carga main.tsx + vendor chunks en paralelo (modulepreload)
     ├── vendor-react     17 KB gz  (react, react-dom, react-router)
     ├── vendor-firebase  115 KB gz (firebase/app + auth + firestore + storage)
     ├── vendor-ui        70 KB gz  (motion/react, @base-ui, sonner)
     └── index            73 KB gz  (app code, tailwind-merge, cva, lucide)
     TOTAL SINCRONO: ~275 KB gz
T2   Modulos evaluados → Firebase initializeApp() + getAuth() + getFirestore() + getStorage()
T3   createRoot().render() → AuthProvider monta con loading=true
T4   Suspense fallback: <LoadingScreen> visible (texto "Cielo Estrellado" con BlurFade)
     ← PRIMER PIXEL CON CONTENIDO (FCP)
T5   onIdTokenChanged dispara:
     ├── Usuario NO autenticado: loading=false → redirige a /login
     └── Usuario autenticado:
         ├── setLoading(true) ← BLOQUEA DE NUEVO
         ├── await api('/api/userSync', { method: 'POST' }) ← RED
         └── setLoading(false) → redirige a /skies
T6   Lazy chunk de la pagina se descarga
T7   Pagina renderiza → LCP
```

### 2.3 Causas raiz identificadas

| # | Causa | Impacto estimado | Archivos |
|---|-------|------------------|----------|
| C1 | **Firebase barrel export** — `client.ts` importa y exporta app+auth+firestore+storage en un solo modulo. Cualquier `import { auth }` arrastra los 4 SDKs (~115 KB gz) al critical path. Firestore (~75 KB gz) y Storage (~15 KB gz) no se necesitan en initial load. | ~90 KB gz desperdiciados | `src/lib/firebase/client.ts` |
| C2 | **motion/react en critical path + animaciones no compuestas** — `LoadingScreen` usa `BlurFade` que importa `motion/react`. El vendor-ui chunk completo (70 KB gz) se necesita solo para un fade-in de texto. Ademas, PageSpeed detecta **7 animaciones no compuestas** con `filter: blur(0px)` en la landing (BlurFade en login). `filter: blur()` fuerza repaint — no se compone en GPU como `opacity` y `transform`. | ~70 KB gz en critical path + jank visual | `src/components/ui/LoadingScreen.tsx`, `src/components/ui/blur-fade.tsx`, `src/pages/LoginPage.tsx` |
| C3 | **Double network waterfall** — AuthProvider espera `onIdTokenChanged` (red) → si hay usuario, `setLoading(true)` y `await userSync` (red) → recien `loading=false`. Cadena total confirmada por PageSpeed: index.js (434ms) → auth/iframe.js (630ms) → getProjectConfig (176ms) + userSync POST (~300-500ms) = **~1,740-1,940ms solo de network**. | +1,240ms cadena auth + 300-500ms userSync | `src/lib/auth/AuthContext.tsx:53-69` |
| C4 | **Sin preconnect hints** — PageSpeed confirma "no se preconecto ningun origen". Recomienda preconnect a `masmelito-f209c.firebaseapp.com` con **ahorro estimado de 320ms** en LCP. | -320ms confirmado por PageSpeed | `index.html` |
| C5 | **Componentes pesados eager en SkyPage** — StarFormSheet (566 lineas), StarOverlay (298), SkySettingsSheet (444), CollaboratorsSheet (434) se importan eager pero se renderizan condicionalmente (modals/sheets). | ~55 KB raw innecesarios en SkyPage chunk | `src/pages/SkyPage.tsx:8-11` |
| C6 | **canvas-confetti eager** — Importado top-level en ShopPage y DailyRewardModal, solo se usa en acciones puntuales de celebracion. | ~10 KB innecesarios en page chunks | `ShopPage.tsx`, `DailyRewardModal.tsx` |
| C7 | **Dependencia fantasma** — `@fontsource-variable/geist` en package.json pero nunca importado. | Ruido en node_modules | `package.json` |
| C8 | **LCP element es texto estatico bloqueado por JS** — El `<h1>Cielo Estrellado</h1>` tiene 2,370ms de "retraso en renderizacion" segun PageSpeed. Es texto puro que no depende de datos, pero espera a que React se hidrate completamente (parse de ~275 KB gz de JS) para pintarse. | 2,370ms de delay innecesario en LCP | `index.html`, `src/components/ui/LoadingScreen.tsx` |
| C9 | **registerSW.js bloquea renderizacion** — PageSpeed lista `/registerSW.js` (0.7 KB, 470ms) como recurso que bloquea rendering. Es un script pequeno pero sincronico. | 470ms de bloqueo innecesario | `vite-plugin-pwa` config |

---

## 3. Fixes propuestos

### Fix 1 — Split Firebase: auth eager, firestore/storage lazy

**Impacto estimado: ~90 KB gz off critical path | FCP -1.0-1.5s**

**Problema:** `client.ts` es un barrel export que inicializa los 4 SDKs de Firebase al evaluarse. `AuthContext.tsx` importa `auth` de este archivo, arrastrando firestore y storage al bundle critico.

**Codigo actual** (`src/lib/firebase/client.ts`):
```ts
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFirestore } from 'firebase/firestore'

const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
```

**Codigo propuesto** — Splitear en 3 archivos:

`src/lib/firebase/app.ts` (eager — ~15 KB gz):
```ts
import { initializeApp, getApps, getApp } from 'firebase/app'

const firebaseConfig = { /* ... */ }

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)
```

`src/lib/firebase/auth.ts` (eager — ~50 KB gz):
```ts
import { getAuth } from 'firebase/auth'
import { app } from './app'

export const auth = getAuth(app)
```

`src/lib/firebase/firestore.ts` (lazy — ~75 KB gz, solo se importa donde se necesita):
```ts
import { getFirestore } from 'firebase/firestore'
import { app } from './app'

export const db = getFirestore(app)
```

`src/lib/firebase/storage.ts` (lazy — ~15 KB gz, refactorizar el existente):
```ts
import { getStorage, ref, uploadBytes } from 'firebase/storage'
import { app } from './app'

export const storage = getStorage(app)

export async function uploadStarImage(skyId: string, starId: string, file: File): Promise<string> {
  const path = `stars/${skyId}/${starId}/image`
  await uploadBytes(ref(storage, path), file, { contentType: file.type })
  return path
}
// ... uploadStarVideo igual
```

**Cambios en consumidores:**
- `AuthContext.tsx`: `import { auth } from '@/lib/firebase/auth'` (en vez de `client`)
- `api/client.ts`: `import { auth } from '@/lib/firebase/auth'` (en vez de `client`)
- `useSkyStars.ts`: `import { db } from '@/lib/firebase/firestore'` (en vez de `client`)
- `StarOverlay.tsx`, `StarFormSheet.tsx`: importar de `@/lib/firebase/storage`

**Cambios en vite.config.ts** (`manualChunks`):
```ts
manualChunks: {
  'vendor-react': ['react', 'react-dom', 'react-router'],
  'vendor-ui': ['@base-ui/react', 'motion', 'sonner'],
  'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
  // firebase/firestore y firebase/storage se splitean automaticamente en los lazy chunks
},
```

**Riesgos:**
- La inicializacion de Firestore/Storage ocurre mas tarde (primera vez que se necesita). Impacto nulo en UX: el usuario ya esta en la pagina cuando se dispara.
- Si algun import oculto de `client.ts` queda sin migrar, Vite lo advertira como "conflicto static/dynamic". Buscar con `grep -r "firebase/client" src/`.

---

### Fix 2 — LoadingScreen sin motion (CSS puro) + BlurFade compuesto en login

**Impacto estimado: ~70 KB gz off critical path | FCP -0.5-1.0s | Elimina 7 animaciones no compuestas**

**Problema:** `LoadingScreen` importa `BlurFade` → `motion/react` (AnimatePresence, motion, useInView). Esto fuerza el vendor-ui chunk completo (70 KB gz) al critical path, solo para un fade-in y blur de texto. Ademas, PageSpeed detecta **7 animaciones no compuestas** con `filter: blur(0px)` en la landing — son los BlurFade de `LoginPage`. La propiedad `filter: blur()` fuerza repaint del compositor y no se ejecuta en GPU.

**Parte A — LoadingScreen (critical path)**

**Codigo actual** (`src/components/ui/LoadingScreen.tsx`):
```tsx
import { BlurFade } from '@/components/ui/blur-fade'

export function LoadingScreen() {
  return (
    <div className="flex h-full w-full items-center justify-center" style={{...}}>
      <BlurFade delay={0.2} inView>
        <h1 className="text-2xl font-light tracking-widest" style={{...}}>
          Cielo Estrellado
        </h1>
      </BlurFade>
    </div>
  )
}
```

**Codigo propuesto:**
```tsx
export function LoadingScreen() {
  return (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{
        background: 'radial-gradient(ellipse at center, rgba(140, 180, 255, 0.03) 0%, var(--bg-void) 70%)',
      }}
    >
      <h1
        className="text-2xl font-light tracking-widest animate-fade-in-up"
        style={{
          color: 'var(--text-secondary)',
          fontFamily: "'Georgia', 'Times New Roman', serif",
        }}
      >
        Cielo Estrellado
      </h1>
    </div>
  )
}
```

**Parte B — BlurFade compuesto (animaciones en login)**

PageSpeed marca 7 animaciones como "no compuestas" porque usan `filter: blur()`. El componente `BlurFade` (`src/components/ui/blur-fade.tsx`) define las variantes:
```ts
// Actual — NO compuesto (filter fuerza repaint)
hidden: { y: -offset, opacity: 0, filter: `blur(${blur})` }
visible: { y: 0, opacity: 1, filter: `blur(0px)` }
```

**Opciones:**
1. **Eliminar `filter: blur()` de BlurFade** y dejar solo `opacity` + `transform` (compuestas, GPU-accelerated). El efecto visual es 95% identico — el blur sutil de entrada es imperceptible en mobile.
2. **Reemplazar BlurFade por CSS animations en LoginPage** con solo `opacity` + `transform`.

**Recomendacion:** Opcion 1 — modificar BlurFade para usar solo propiedades compuestas. Afecta a todos los usos de BlurFade en la app, pero el blur en animaciones de entrada es un detalle que los usuarios no perciben conscientemente.

**CSS a agregar** en `globals.css` (para LoadingScreen):
```css
@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-fade-in-up {
  animation: fade-in-up 0.4s ease-out 0.24s both;
}
```

> **Nota:** Se usa solo `opacity` + `transform` — ambas propiedades compuestas que se ejecutan en GPU sin forzar repaint.

**Efecto:** Si `LoadingScreen` es el unico consumidor sincrono de `motion/react`, el vendor-ui chunk deja de ser necesario en el critical path. Vite solo lo cargara cuando una pagina lazy (que use motion) se active. Adicionalmente, eliminar `filter: blur()` de BlurFade resuelve las 7 animaciones no compuestas detectadas por PageSpeed.

**Riesgos:**
- Verificar que ningun otro import sincrono en `main.tsx` depende de `motion/react`. Revisar `Toaster` (sonner) — sonner esta en vendor-ui pero es independiente de motion. Si sonner arrastra vendor-ui de todas formas, este fix tiene menos impacto pero sigue siendo valido por limpieza.
- Eliminar `filter: blur()` de BlurFade cambia ligeramente la estetica de entrada. Visualmente la diferencia es minima — la animacion sigue teniendo fade + slide.

---

### Fix 3 — Preconnect hints para Firebase

**Impacto estimado: -320ms en LCP confirmado por PageSpeed | Esfuerzo: 2 minutos**

**Problema:** PageSpeed confirma "no se preconecto ningun origen" y recomienda especificamente preconnect a `masmelito-f209c.firebaseapp.com` con **ahorro estimado de 320ms en LCP**. El browser espera a que JS ejecute el primer fetch a Firebase para iniciar la negociacion TLS. La cadena critica de auth (index.js → auth/iframe.js → getProjectConfig = 1,240ms) se beneficia directamente de preconnect.

**Codigo actual** (`index.html`, dentro de `<head>`):
```html
<!-- Nada de preconnect -->
```

**Codigo propuesto** (agregar despues de `<meta name="theme-color">`):
```html
<!-- Auth iframe — 320ms ahorro confirmado por PageSpeed -->
<link rel="preconnect" href="https://masmelito-f209c.firebaseapp.com" />
<!-- Auth API calls -->
<link rel="preconnect" href="https://www.googleapis.com" />
<!-- Google Sign-In -->
<link rel="preconnect" href="https://apis.google.com" />
<!-- Firestore reads (lazy, pero preconnectar no cuesta nada) -->
<link rel="preconnect" href="https://firestore.googleapis.com" />
```

**Riesgos:** Ninguno. Si el dominio no se usa en una sesion, el hint se ignora. Zero downside. Maximo 6 preconnects simultaneos es el limite recomendado — estamos en 4.

---

### Fix 4 — Lazy loading de componentes pesados en SkyPage

**Impacto estimado: ~15-20 KB gz off SkyPage chunk | LCP -0.2-0.5s**

**Problema:** SkyPage importa 4 componentes pesados de forma eager que solo se renderizan condicionalmente:

| Componente | Lineas | Se renderiza cuando |
|------------|--------|---------------------|
| StarFormSheet | 566 | Usuario crea/edita estrella |
| StarOverlay | 298 | Usuario toca una estrella |
| SkySettingsSheet | 444 | Usuario abre config |
| CollaboratorsSheet | 434 | Usuario abre colaboradores |

**Codigo actual** (`src/pages/SkyPage.tsx:8-11`):
```ts
import { StarOverlay } from '@/components/sky/StarOverlay'
import { StarFormSheet } from '@/components/sky/StarFormSheet'
import { SkySettingsSheet } from '@/components/sky/SkySettingsSheet'
import { CollaboratorsSheet } from '@/components/sky/CollaboratorsSheet'
```

**Codigo propuesto:**
```ts
import { lazy, Suspense } from 'react'

const StarOverlay = lazy(() => import('@/components/sky/StarOverlay').then(m => ({ default: m.StarOverlay })))
const StarFormSheet = lazy(() => import('@/components/sky/StarFormSheet').then(m => ({ default: m.StarFormSheet })))
const SkySettingsSheet = lazy(() => import('@/components/sky/SkySettingsSheet').then(m => ({ default: m.SkySettingsSheet })))
const CollaboratorsSheet = lazy(() => import('@/components/sky/CollaboratorsSheet').then(m => ({ default: m.CollaboratorsSheet })))
```

En el JSX, envolver cada uso condicional con `<Suspense fallback={null}>` (estos componentes son modals/sheets que aparecen sobre contenido existente — no necesitan skeleton).

**Riesgos:**
- Primer open de un sheet tendra ~50-100ms de delay mientras carga el chunk. Imperceptible en la practica.
- Si algun componente lazy necesita estar montado en el DOM antes de la interaccion (ej. un ref), no funcionara. Verificar que todos se renderizan condicionalmente con `{showX && <X />}`.

---

### Fix 5 — Dynamic import de canvas-confetti

**Impacto estimado: ~10 KB gz off page chunks | Esfuerzo: 5 minutos**

**Problema:** `canvas-confetti` se importa top-level en ShopPage y DailyRewardModal, pero solo se usa en callbacks de celebracion.

**Codigo actual** (`ShopPage.tsx`):
```ts
import confetti from 'canvas-confetti'
// ...
confetti({ particleCount: 100, spread: 70 })
```

**Codigo propuesto:**
```ts
// Sin import top-level
async function celebrate() {
  const confetti = (await import('canvas-confetti')).default
  confetti({ particleCount: 100, spread: 70 })
}
```

**Riesgos:** La primera celebracion tendra ~50ms de delay para cargar el modulo. Imperceptible dado el contexto (el usuario acaba de comprar algo).

---

### Fix 6 — Optimizar AuthProvider: eliminar waterfall de userSync

**Impacto estimado: -300-500ms en LCP para usuarios autenticados**

**Problema:** Cuando `onIdTokenChanged` detecta usuario autenticado, el AuthProvider:
1. Pone `loading = true` (bloquea toda la UI)
2. Espera `await api('/api/userSync', { method: 'POST' })`
3. Recien pone `loading = false`

La cadena critica confirmada por PageSpeed es: index.js (434ms) → auth/iframe.js (630ms) → getProjectConfig (176ms) = **1,240ms solo de auth**. A eso se suma el `await userSync` (300-500ms adicionales). Total antes de contenido visible: **~1,540-1,740ms solo de network** (sin contar JS parse/exec).

**Codigo actual** (`src/lib/auth/AuthContext.tsx:53-67`):
```ts
const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    setLoading(true)
    setUser(toAuthUser(firebaseUser))
    try {
      await api('/api/userSync', { method: 'POST' })
    } catch (e) {
      console.error('userSync failed:', e)
    }
  } else {
    setUser(null)
  }
  setLoading(false)
})
```

**Codigo propuesto** — Fire-and-forget para userSync:
```ts
const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
  if (firebaseUser) {
    setUser(toAuthUser(firebaseUser))
    // userSync en background — no bloquea el render
    api('/api/userSync', { method: 'POST' }).catch(e =>
      console.error('userSync failed:', e)
    )
  } else {
    setUser(null)
  }
  setLoading(false)
})
```

**Cambios clave:**
- Eliminar `setLoading(true)` dentro del callback (ya arranca en `true` desde el estado inicial)
- `userSync` se dispara pero no se espera. El usuario ve la UI inmediatamente.
- Si userSync falla, no afecta la sesion — el token ya es valido.

**Riesgos:**
- Si alguna pagina depende de datos que `userSync` actualiza (ej. balance de Polvo Estelar), podria mostrar datos stale brevemente hasta que el sync complete y el proximo `onSnapshot` o fetch lo actualice.
- **Mitigacion:** Las paginas ya hacen sus propios fetches de datos (useSkyData, api('/api/skies'), etc.) que traen datos frescos. `userSync` es para sincronizar el profile, no datos criticos de UI.
- **Alternativa conservadora:** Si hay riesgo real de datos stale, en vez de fire-and-forget, hacer `setLoading(false)` ANTES del await y dejar el sync corriendo:
  ```ts
  setUser(toAuthUser(firebaseUser))
  setLoading(false)  // Desbloquear UI inmediatamente
  try { await api('/api/userSync', { method: 'POST' }) } catch (e) { ... }
  ```

---

### Fix 7 — Actualizar manualChunks en vite.config.ts

**Impacto: Necesario para que Fix 1 funcione correctamente**

**Codigo actual** (`vite.config.ts:65-69`):
```ts
manualChunks: {
  'vendor-react': ['react', 'react-dom', 'react-router'],
  'vendor-ui': ['@base-ui/react', 'motion', 'sonner'],
  'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
},
```

**Codigo propuesto:**
```ts
manualChunks: {
  'vendor-react': ['react', 'react-dom', 'react-router'],
  'vendor-ui': ['@base-ui/react', 'motion', 'sonner'],
  'vendor-firebase-core': ['firebase/app', 'firebase/auth'],
  // firebase/firestore y firebase/storage se splitean en lazy chunks automaticamente
},
```

**Efecto:** Vite creara un chunk `vendor-firebase-core` (~65 KB gz) que se carga eager, y firebase/firestore y firebase/storage se agruparan en los lazy chunks que los necesiten (SkyPage, etc.).

**Riesgos:**
- Verificar que `firebase/firestore` no termina duplicado en multiples lazy chunks. Si eso pasa, agregar un `vendor-firebase-data: ['firebase/firestore']` manual.
- Correr `npm run build` y revisar el output de chunks.

---

### Fix 8 — Limpiar dependencia @fontsource-variable/geist

**Impacto: Limpieza — no afecta bundle (nunca se importa)**

```bash
cd frontend && npm uninstall @fontsource-variable/geist
```

**Riesgos:** Ninguno. La dependencia no se importa en ningun archivo.

---

### Fix 9 — Titulo LCP estatico en index.html (pre-React)

**Impacto estimado: -1,500-2,000ms en LCP | El fix de mayor impacto individual**

**Problema:** El elemento LCP es `<h1>Cielo Estrellado</h1>`. PageSpeed reporta **2,370ms de "retraso en renderizacion del elemento"** — eso es tiempo entre que el HTML llega y el `<h1>` se pinta. El titulo es texto estatico puro que no depende de Firebase, auth, ni datos. Pero actualmente vive dentro de un componente React (`LoadingScreen`) que requiere:
1. Descargar ~275 KB gz de JS (vendor chunks + app code)
2. Parsear y ejecutar todo el JS
3. React monta el arbol de componentes
4. `LoadingScreen` renderiza el `<h1>`

Todo eso para pintar texto estatico.

**Solucion:** Poner el titulo directamente en `index.html` como HTML estatico. React lo reemplaza al hidratarse, pero el browser lo pinta **inmediatamente** sin esperar JS.

**Codigo actual** (`index.html`):
```html
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

**Codigo propuesto:**
```html
<body>
  <div id="root">
    <!-- Placeholder pre-React: se pinta inmediatamente, React lo reemplaza al montar -->
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        width: 100%;
        background: radial-gradient(ellipse at center, rgba(140, 180, 255, 0.03) 0%, #05080f 70%);
      "
    >
      <h1
        style="
          font-size: 1.75rem;
          font-weight: 300;
          letter-spacing: 0.1em;
          color: rgba(180, 200, 255, 0.5);
          font-family: 'Georgia', 'Times New Roman', serif;
          animation: fade-in-up 0.4s ease-out 0.24s both;
        "
      >
        Cielo Estrellado
      </h1>
    </div>
  </div>
  <style>
    @keyframes fade-in-up {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <script type="module" src="/src/main.tsx"></script>
</body>
```

**Como funciona:**
1. Browser recibe HTML → pinta fondo `#05080f` (inline CSS existente en `<head>`)
2. Browser encuentra el `<h1>` dentro de `#root` → **lo pinta inmediatamente** con la animacion CSS
3. Esto es el **FCP y LCP** — ocurre antes de que JS se descargue
4. JS se descarga y parsea en paralelo
5. `createRoot(document.getElementById('root')!).render(...)` reemplaza el contenido pre-React con el arbol React
6. La transicion es imperceptible — el `<h1>` de LoadingScreen es visualmente identico

**Por que funciona para LCP:** El browser no necesita JS para pintar HTML estatico. El `<h1>` se renderiza en el primer paint pass, eliminando los 2,370ms de "retraso en renderizacion" que PageSpeed reporta.

**Riesgos:**
- **Flash of content on hydration:** Cuando React monta, reemplaza el HTML pre-renderizado. Si hay un frame donde el contenido desaparece y reaparece, se veria un flash. Mitigacion: `LoadingScreen` (Fix 2) renderiza exactamente el mismo `<h1>` con los mismos estilos, asi la transicion es seamless.
- **Mantenimiento:** Dos copias del titulo (HTML + React). Si cambia el diseno del loading screen, hay que actualizar ambos. Es aceptable porque es un elemento trivial que rara vez cambia.
- **React hydration mismatch:** `createRoot().render()` no usa hydration (no es `hydrateRoot()`), asi que no hay mismatch — simplemente reemplaza el innerHTML del root div. No hay riesgo.

---

### Fix 10 — Diferir registerSW.js

**Impacto estimado: -470ms en render blocking | Esfuerzo: 2 minutos**

**Problema:** PageSpeed lista `/registerSW.js` (0.7 KB, 470ms) como recurso que bloquea renderizacion. El script se inyecta por `vite-plugin-pwa` de forma sincronica.

**Solucion:** Configurar `vite-plugin-pwa` para inyectar el SW con `type: 'module'` o diferir su registro.

**Codigo actual** (`vite.config.ts`):
```ts
VitePWA({
  registerType: 'autoUpdate',
  // ...
})
```

**Codigo propuesto:**
```ts
VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'script-defer',  // Inyecta <script defer> en vez de sincrono
  // ...
})
```

**Alternativas:**
- `injectRegister: null` + registrar manualmente en un `useEffect` despues del mount (maxima deferencia, pero mas codigo)
- `injectRegister: 'script-defer'` — la opcion mas simple, delega al browser el defer

**Riesgos:**
- El SW se registra ligeramente mas tarde. Impacto nulo en UX: el SW solo precachea assets para la proxima visita.
- Verificar que `vite-plugin-pwa` soporte `injectRegister: 'script-defer'` en la version instalada. Si no, usar `injectRegister: null` y registrar manualmente.

---

### Fix 11 — Remover `filter: blur()` de BlurFade (animaciones compuestas)

**Impacto estimado: Elimina 7 animaciones no compuestas en login | Mejora FCP y reduce jank**

> **Nota:** Este fix es parte del Fix 2 (Parte B). Se documenta por separado para que sea reversible independientemente si se decide mantener motion/react en la landing.

**Problema:** PageSpeed detecta 7 elementos en la landing/login con `opacity: 1; filter: blur(0px); transform: none;` marcados como "animaciones no compuestas". Son los componentes BlurFade usados en LoginPage. La propiedad `filter` no se ejecuta en el compositor GPU — fuerza repaint en el main thread.

**Codigo actual** (`src/components/ui/blur-fade.tsx:48-59`):
```ts
const defaultVariants: Variants = {
  hidden: {
    [direction === "left" || direction === "right" ? "x" : "y"]:
      direction === "right" || direction === "down" ? -offset : offset,
    opacity: 0,
    filter: `blur(${blur})`,      // ← NO compuesto
  },
  visible: {
    [direction === "left" || direction === "right" ? "x" : "y"]: 0,
    opacity: 1,
    filter: `blur(0px)`,          // ← NO compuesto
  },
}
```

**Codigo propuesto:**
```ts
const defaultVariants: Variants = {
  hidden: {
    [direction === "left" || direction === "right" ? "x" : "y"]:
      direction === "right" || direction === "down" ? -offset : offset,
    opacity: 0,
    // filter: blur removido — no es compuesto, fuerza repaint
  },
  visible: {
    [direction === "left" || direction === "right" ? "x" : "y"]: 0,
    opacity: 1,
  },
}
```

Tambien limpiar la logica de `shouldTransitionFilter` y las funciones `getFilter` que ya no se necesitan.

**Propiedades compuestas (GPU-accelerated):** `opacity`, `transform` (translate, scale, rotate).
**Propiedades NO compuestas:** `filter`, `backdrop-filter`, `box-shadow`, `border-radius`.

**Riesgos:**
- El efecto de blur al entrar desaparece. La animacion queda como fade + slide, que es 95% del efecto visual percibido. El blur sutil es imperceptible en pantallas mobile.
- Afecta a todos los usos de BlurFade (login, skies, sky, invite, profile). Si se quiere mantener blur en desktop, se puede usar `@media (prefers-reduced-motion: no-preference)` con `will-change: filter` como hint (pero sigue sin ser compuesto).

---

## 4. Orden de implementacion

Ordenado por impacto descendente. Cada fix es independiente y reversible (excepto Fix 7 que es prerequisito de Fix 1).

| Orden | Fix | Impacto est. | Esfuerzo | Dependencia |
|-------|-----|-------------|----------|-------------|
| 1 | **Fix 11 + Fix 9 + Fix 2** — BlurFade compuesto + titulo estatico + LoadingScreen CSS | -2,000ms LCP + -70 KB gz critical + 7 animaciones no compuestas | Bajo | Coordinados: Fix 11 primero para que Fix 9 no cause flash |
| 2 | **Fix 1 + Fix 7** — Split Firebase | -90 KB gz critical (54.8 KB confirmado por PageSpeed) | Medio | Fix 7 es prerequisito |
| 4 | **Fix 3** — Preconnect hints | -320ms LCP (confirmado por PageSpeed) | Trivial | Ninguna |
| 5 | **Fix 6** — Eliminar waterfall userSync | -300-500ms LCP (auth users) | Bajo | Ninguna |
| 6 | **Fix 10** — Diferir registerSW.js | -470ms render blocking | Trivial | Ninguna |
| 7 | **Fix 11** — BlurFade sin filter:blur | Elimina 7 animaciones no compuestas | Trivial | Ninguna |
| 8 | **Fix 4** — Lazy components SkyPage | -15-20 KB gz SkyPage chunk | Medio | Ninguna |
| 9 | **Fix 5** — Dynamic canvas-confetti | -10 KB gz page chunks | Trivial | Ninguna |
| 10 | **Fix 8** — Remover Geist | Limpieza | Trivial | Ninguna |

**Estimacion combinada:**

| Metrica | Antes | + Fix 9 | + Fix 1+7 | + Fix 2 | + Fix 3 | + Fix 6+10 | Final est. |
|---------|-------|---------|-----------|---------|---------|------------|------------|
| JS critical path | 275 KB gz | 275 KB gz | 185 KB gz | 115 KB gz | 115 KB gz | 115 KB gz | **115 KB gz** |
| FCP | 4.4s | ~1.5s* | ~1.5s | ~1.2s | ~1.0s | ~1.0s | **~1.0s** |
| LCP | 5.2s | ~2.5s* | ~2.0s | ~1.8s | ~1.5s | ~1.2s | **~1.2s** |

> *Fix 9 tiene el mayor impacto individual porque el LCP element (el `<h1>`) se pinta desde HTML puro sin esperar JS. Los 2,370ms de "retraso en renderizacion" de PageSpeed se eliminan casi por completo.

---

## 5. Lo que NO se toca (y por que)

| Item | Razon |
|------|-------|
| React.lazy en rutas | Ya implementado correctamente en las 6 paginas |
| System fonts | Cero overhead — no cambiar |
| Tailwind CSS purge | Automatico con @tailwindcss/vite en v4 |
| Service Worker (workbox runtime) | Ya diferido al evento load — solo registerSW.js se toca en Fix 10 |
| SkyEngine/SkyCanvas | Usado en 5/6 paginas — lazy loading no ayuda porque se necesita en casi todas |
| Inline critical CSS | Ya implementado (background #05080f) |
| Vite modulepreload | Ya automatico para vendor chunks |

---

## 6. Verificacion

### Antes de implementar
```bash
# Baseline de chunks
cd frontend && npm run build
# Guardar output (nombres de chunks + tamanos)

# Lighthouse local (Chrome DevTools → Lighthouse → Mobile)
# Anotar: FCP, LCP, TBT, Speed Index

# PageSpeed Insights en produccion
# URL: https://cielo-estrellado-web.web.app
```

### Despues de cada fix
```bash
# Verificar chunks
cd frontend && npm run build
# Comparar tamanos vs baseline

# Tests
cd frontend && npm run test:run

# Smoke test local
cd frontend && npm run dev
# Navegar: /login → /skies → /sky/:id → abrir estrella → crear estrella
# Verificar que todo funciona

# Lighthouse local
# Comparar FCP, LCP vs baseline
```

### Despues de todos los fixes
```bash
# Deploy
cd frontend && npm run test:run && npm run build
firebase deploy --only hosting

# PageSpeed Insights final
# Comparar con metricas iniciales
# Objetivo: FCP <2s, LCP <2.5s, Performance >90
```

### Checklist de regresion
- [ ] Login con email funciona
- [ ] Login con Google funciona
- [ ] Lista de cielos carga
- [ ] Entrar a un cielo muestra estrellas
- [ ] Crear estrella con imagen funciona
- [ ] Crear estrella con video funciona (VideoTrimmer carga)
- [ ] Abrir overlay de estrella funciona
- [ ] Settings de cielo funciona
- [ ] Colaboradores funciona
- [ ] Tienda carga y compra funciona (confetti aparece)
- [ ] Invite link funciona
- [ ] Profile carga
- [ ] PWA instala correctamente
- [ ] Service Worker cachea assets en segunda visita
