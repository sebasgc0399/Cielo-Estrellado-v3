# SPEC v4 — Optimizacion de Rendimiento Frontend (Referencia Lean)

Referencia lean de las optimizaciones de rendimiento aplicadas al frontend. Para modelo base ver `SPEC.md`. Para economia ver `SPEC_v2.md`. Para video clips ver `SPEC_v3.md`.

---

## 1. Resultados

### Metricas PageSpeed Insights (Mobile)

| Metrica | Antes | Despues | Cambio |
|---------|:-----:|:-------:|:------:|
| Performance | 69 | 79 | **+10** |
| FCP | 4.4s | 2.5s | **-1.9s** |
| LCP | 5.2s | 4.8s | **-0.4s** |
| Speed Index | 5.2s | 2.6s | **-2.6s** |
| JS critical path | 275 KB gz | 172 KB gz | **-37%** |
| Cadena critica | 1,240ms | 722ms | **-42%** |

**Nota:** LCP sigue alto porque el elemento LCP medido por PageSpeed es el `<h1>` renderizado por React (1,710ms delay), no el estatico. `auth/iframe.js` (90 KB) es codigo de terceros de Firebase que no controlamos. Llegar a 90+ requeriria eliminar esa dependencia o hacer SSR/pre-rendering — cambios arquitectonicos mayores.

---

## 2. Causas raiz identificadas

| # | Causa | Impacto |
|---|-------|---------|
| C1 | Firebase barrel export — `client.ts` arrastra 4 SDKs (~115 KB gz) al critical path | ~90 KB gz desperdiciados |
| C2 | `motion/react` en critical path + animaciones `filter:blur` no compuestas | ~70 KB gz + 7 animaciones con jank |
| C3 | Double network waterfall — auth chain (1,240ms) + await userSync (300-500ms) | ~1,740ms de network bloqueante |
| C4 | Sin preconnect hints a Firebase | -320ms confirmado por PageSpeed |
| C5 | Componentes pesados eager en SkyPage (modals/sheets) | ~55 KB raw innecesarios |
| C6 | `canvas-confetti` eager en ShopPage/DailyRewardModal | ~10 KB innecesarios |
| C7 | `@fontsource-variable/geist` en package.json sin uso | Ruido en node_modules |
| C8 | LCP element (`<h1>`) es texto estatico bloqueado por JS (2,370ms delay) | Delay innecesario en LCP |
| C9 | `registerSW.js` bloquea renderizacion (470ms) | Render blocking |

---

## 3. Fixes implementados

| Fix | Descripcion | Archivos clave |
|-----|-------------|----------------|
| **1** | Split Firebase: auth eager, firestore/storage lazy | `lib/firebase/{app,auth,firestore,storage}.ts` |
| **2** | LoadingScreen con CSS puro (sin motion) | `components/ui/LoadingScreen.tsx`, `globals.css` |
| **3** | Preconnect hints para Firebase y Google APIs | `index.html` |
| **4** | Lazy loading de 4 componentes pesados en SkyPage | `pages/SkyPage.tsx` |
| **5** | Dynamic import de canvas-confetti | `pages/ShopPage.tsx`, `components/economy/DailyRewardModal.tsx` |
| **6** | userSync fire-and-forget (sin await) | `lib/auth/AuthContext.tsx` |
| **7** | manualChunks actualizado (firebase-core + firebase-data) | `vite.config.ts` |
| **8** | Removida dependencia fantasma @fontsource-variable/geist | `package.json` |
| **9** | Titulo LCP estatico en index.html (pre-React) | `index.html`, `main.tsx` |
| **10** | registerSW.js diferido con `injectRegister: 'script-defer'` | `vite.config.ts` |
| **11** | BlurFade sin `filter:blur` (solo opacity + transform) | `components/ui/blur-fade.tsx` |

---

## 4. Detalle tecnico

### Fix 1+7 — Split Firebase + manualChunks

Firebase splitado en modulos independientes: `app.ts` (eager, ~15 KB gz), `auth.ts` (eager, ~50 KB gz), `firestore.ts` (lazy, ~75 KB gz), `storage.ts` (lazy, ~15 KB gz). `vite.config.ts` agrupa `firebase/app` + `firebase/auth` en `vendor-firebase-core`. Firestore y storage se cargan solo cuando se necesitan.

### Fix 2 — LoadingScreen CSS puro

Eliminada dependencia de `BlurFade`/`motion/react`. Usa clase CSS `animate-fade-in-up` definida en `globals.css` con solo `opacity` + `transform` (propiedades compuestas GPU-accelerated). Vendor-ui deja de ser necesario en critical path.

### Fix 3 — Preconnect hints

Cuatro `<link rel="preconnect">` en `index.html`: `masmelito-f209c.firebaseapp.com`, `www.googleapis.com`, `apis.google.com`, `firestore.googleapis.com`. Ahorro de -320ms confirmado por PageSpeed.

### Fix 4 — Lazy loading SkyPage

`StarOverlay`, `StarFormSheet`, `SkySettingsSheet`, `CollaboratorsSheet` cargados con `React.lazy()` + `Suspense`. Son modals/sheets que solo se renderizan condicionalmente.

### Fix 5 — Dynamic canvas-confetti

`import('canvas-confetti')` dinamico dentro de funciones `fireStarConfetti()`. Solo se carga al momento de celebracion.

### Fix 6 — userSync fire-and-forget

`api('/api/userSync', { method: 'POST' }).catch(...)` sin `await`. La UI se desbloquea inmediatamente despues de `onIdTokenChanged`. El sync corre en background.

### Fix 9 — Titulo estatico pre-React

`index.html` contiene un `<div id="static-landing">` con el `<h1>Cielo Estrellado</h1>` estatico + animacion CSS inline. El browser lo pinta inmediatamente sin esperar JS. `main.tsx` lo remueve al montar React.

### Fix 10 — registerSW diferido

`injectRegister: 'script-defer'` en `vite-plugin-pwa`. El SW se registra despues del render en vez de bloquear.

### Fix 11 — BlurFade compuesto

Removido `filter: blur()` de las variantes de `BlurFade`. Solo usa `opacity` + `transform` (translate). Elimina las 7 animaciones no compuestas detectadas por PageSpeed.

---

## 5. Arquitectura resultante del bundle

### Chunks eager (critical path): ~172 KB gz

| Chunk | Gzip | Contenido |
|-------|:----:|-----------|
| vendor-react | ~17 KB | react, react-dom, react-router |
| vendor-firebase-core | ~65 KB | firebase/app, firebase/auth |
| index (app code) | ~73 KB | app code, tailwind-merge, cva, lucide |
| CSS | ~12 KB | globals + componentes |

### Chunks lazy (on-demand)

| Chunk | Gzip | Se carga cuando |
|-------|:----:|-----------------|
| vendor-firebase-data | ~75 KB | Primera pagina con Firestore |
| vendor-ui | ~70 KB | Primera pagina con motion/react |
| vendor-motion | variable | Animaciones motion |
| SkyPage + sub-chunks | ~15-55 KB | Navegar a /sky/:id |
| ShopPage | ~5 KB | Navegar a /shop |
| Otros (dialog, login, etc.) | ~11 KB | Bajo demanda |

### Cadena critica optimizada

```
T0  HTML parseado → fondo #05080f visible + <h1> estatico (FCP/LCP inmediato)
T1  JS se descarga en paralelo (~172 KB gz eager)
T2  React monta → reemplaza placeholder estatico → AuthProvider
T3  onIdTokenChanged → userSync fire-and-forget → UI desbloqueada
T4  Lazy chunks bajo demanda (firestore, storage, motion, pages)
```

---

## 6. Lo que no se toca (y por que)

| Item | Razon |
|------|-------|
| React.lazy en rutas | Ya implementado en las 6 paginas |
| System fonts | Cero overhead |
| Tailwind CSS purge | Automatico con @tailwindcss/vite v4 |
| Service Worker workbox | Ya diferido al evento load |
| SkyEngine/SkyCanvas | Se usa en 5/6 paginas — lazy no ayuda |
| Inline critical CSS | Ya implementado (background #05080f) |
| Vite modulepreload | Ya automatico para vendor chunks |
| auth/iframe.js (90 KB) | Codigo de terceros Firebase — no controlamos |

---

## 7. Verificacion

```bash
# Build + verificar chunks
cd frontend && npm run build

# Tests
cd frontend && npm run test:run

# Smoke test local: /login → /skies → /sky/:id → crear estrella → overlay → settings → shop

# PageSpeed Insights: https://cielo-estrellado-web.web.app
# Objetivo: FCP <2.5s, LCP <5s, Performance >75
```

### Checklist de regresion

- Login email + Google
- Lista de cielos carga
- Cielo muestra estrellas
- Crear estrella con imagen/video
- Overlay de estrella funciona
- Settings y colaboradores cargan (lazy)
- Tienda + compra + confetti
- Invite link funciona
- PWA instala + SW cachea assets
