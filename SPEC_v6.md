# SPEC v6 — Tours Guiados con driver.js (Referencia Lean)

Recorridos guiados para usuarios nuevos en las pantallas principales de la app usando driver.js. Para modelo base ver `SPEC.md`. Para economia ver `SPEC_v2.md`. Para video clips ver `SPEC_v3.md`. Para rendimiento ver `SPEC_v4.md`. Para seguridad ver `SPEC_v5.md`.

---

## 1. Objetivo

Reducir la friccion de onboarding guiando al usuario nuevo por las funcionalidades clave de la app mediante tours interactivos. Los tours se activan automaticamente la primera vez que el usuario visita cada pantalla y no vuelven a mostrarse una vez completados o descartados.

**No-goals:**
- No reemplazar tooltips permanentes ni documentacion
- No forzar al usuario a completar el tour para usar la app
- No afectar el critical path de 172 KB gz (SPEC_v4)

---

## 2. Auditoria del estado actual

### Onboarding existente

| Mecanismo | Ubicacion | Comportamiento |
|-----------|-----------|----------------|
| `StardustOnboarding` | `SkiesPage.tsx` | Card informativa sobre Polvo Estelar. Se muestra si `stardust <= 100 && loginStreak <= 1`. Se descarta con boton X o auto-dismiss a los 8s. Persistido en localStorage (`cielo-estrellado:stardust-onboarding-dismissed`) |
| Creation mode hint | `SkyPage.tsx:216-230` | Pill flotante "Toca donde quieras colocar tu estrella" cuando `creationMode=true`. No persiste estado |

### Deteccion de usuario nuevo

No existe campo explicito de onboarding en `UserRecord`. Indicadores disponibles:

| Campo | Tipo | Heuristica |
|-------|------|------------|
| `loginStreak` | `number` | `=== 0` en primer login (antes del daily reward) |
| `lastLoginAt` | `IsoDateString \| null` | `null` si nunca ha completado login |
| `createdAt` | `IsoDateString` | Reciente = usuario nuevo |

**Decision:** No agregar campo a `UserRecord`. Usar localStorage por tour (patron ya establecido por `StardustOnboarding`). Razon: evita mini-RFC de modelo de datos, el tour es UX no-critica, y localStorage es suficiente para una SPA sin SSR.

---

## 3. Dependencias e instalacion

### driver.js

| Atributo | Valor |
|----------|-------|
| Paquete | `driver.js` |
| Version | `^1.3.1` (ultima estable) |
| Bundle | ~5 KB min+gz (JS) + ~2 KB CSS |
| Tipados | Incluidos (TypeScript nativo) |
| Licencia | MIT |

```bash
cd frontend && npm install driver.js
```

### Impacto en bundle

driver.js se carga **exclusivamente via dynamic import** dentro del hook `useTour`. No entra en ningun chunk del critical path. El CSS se importa dentro del mismo dynamic import.

```typescript
// Carga lazy — 0 KB en critical path
const { driver } = await import('driver.js')
await import('driver.js/dist/driver.css')
```

No requiere entrada en `manualChunks` de `vite.config.ts` — Vite generara un chunk separado automaticamente.

---

## 4. Arquitectura

### Estructura de archivos

```
frontend/src/
├── hooks/
│   └── useTour.ts              # Hook reutilizable (nuevo)
├── tours/
│   ├── skiesWelcomeTour.ts     # Definicion de steps para SkiesPage (nuevo)
│   ├── skyEditorTour.ts        # Definicion de steps para SkyPage (nuevo)
│   └── shopIntroTour.ts        # Definicion de steps para ShopPage (nuevo)
├── pages/
│   ├── SkiesPage.tsx           # Modificado: integra tour
│   ├── SkyPage.tsx             # Modificado: integra tour
│   └── ShopPage.tsx            # Modificado: integra tour
├── components/sky/
│   └── FloatingToolbar.tsx     # Modificado: prop forceVisible
```

### Hook `useTour`

Responsabilidades:
1. Verificar si el tour ya fue completado (localStorage)
2. Cargar driver.js via dynamic import (lazy)
3. Inicializar el driver con config y steps
4. Ejecutar `driver.drive()`
5. Marcar como completado en `onDestroyed`
6. Cleanup en unmount (`driver.destroy()`)

```typescript
// hooks/useTour.ts
import { useEffect, useRef, useCallback } from 'react'
import type { Config, DriveStep } from 'driver.js'

interface UseTourOptions {
  tourId: string                    // Clave localStorage
  steps: DriveStep[]                // Pasos del tour
  enabled?: boolean                 // Condicion extra (ej. loginStreak <= 1)
  delay?: number                    // ms antes de iniciar (default: 500)
  config?: Partial<Config>          // Override de config driver.js
  onComplete?: () => void           // Callback al completar
}

const STORAGE_PREFIX = 'cielo-estrellado:tour-completed:'

export function useTour({ tourId, steps, enabled = true, delay = 500, config, onComplete }: UseTourOptions) {
  const driverRef = useRef<ReturnType<typeof import('driver.js').driver> | null>(null)

  const startTour = useCallback(async () => {
    const key = `${STORAGE_PREFIX}${tourId}`
    if (localStorage.getItem(key) === 'true') return
    if (steps.length === 0) return

    const { driver } = await import('driver.js')
    await import('driver.js/dist/driver.css')

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente',
      prevBtnText: 'Anterior',
      doneBtnText: 'Entendido',
      allowClose: true,
      overlayColor: '#05080f',
      overlayOpacity: 0.75,
      stagePadding: 8,
      stageRadius: 12,
      popoverClass: 'cielo-tour-popover',
      smoothScroll: true,
      animate: true,
      steps,
      onDestroyed: () => {
        localStorage.setItem(key, 'true')
        onComplete?.()
      },
      ...config,
    })

    driverRef.current = driverObj
    driverObj.drive()
  }, [tourId, steps, config, onComplete])

  useEffect(() => {
    if (!enabled) return

    const key = `${STORAGE_PREFIX}${tourId}`
    if (localStorage.getItem(key) === 'true') return

    const timer = setTimeout(startTour, delay)
    return () => {
      clearTimeout(timer)
      driverRef.current?.destroy()
      driverRef.current = null
    }
  }, [enabled, tourId, delay, startTour])

  return {
    restart: () => {
      localStorage.removeItem(`${STORAGE_PREFIX}${tourId}`)
      startTour()
    },
    isCompleted: () => localStorage.getItem(`${STORAGE_PREFIX}${tourId}`) === 'true',
  }
}
```

### Persistencia

| Clave localStorage | Tour |
|---------------------|------|
| `cielo-estrellado:tour-completed:skies-welcome` | Tour de bienvenida en SkiesPage |
| `cielo-estrellado:tour-completed:sky-editor` | Tour del editor en SkyPage |
| `cielo-estrellado:tour-completed:shop-intro` | Tour de la tienda en ShopPage |

---

## 5. Tours propuestos

### Tour 1: Bienvenida — SkiesPage (`skies-welcome`)

**Trigger:** `economy.loginStreak <= 1 && !showRewards && !tourCompleted`
**Delay:** 500ms

| # | Selector | Side | Titulo | Descripcion |
|---|----------|------|--------|-------------|
| 1 | _(sin elemento — popover centrado)_ | — | ¡Bienvenido a Cielo Estrellado! ✦ | Este es tu espacio para crear cielos llenos de recuerdos. Te mostramos lo basico. |
| 2 | `[data-tour="stardust-balance"]` | bottom | Polvo Estelar | Esta es tu moneda. La ganas al crear estrellas, iniciar sesion cada dia y mantener tu racha. Usala para desbloquear temas. |
| 3 | `[data-tour="streak-indicator"]` | bottom | Racha diaria | Inicia sesion cada dia para mantener tu racha y ganar mas Polvo Estelar. |
| 4 | `[data-tour="store-button"]` | bottom | Tienda | Aqui puedes desbloquear temas para personalizar tus cielos. |
| 5 | `[data-tour="create-sky-fab"]` | top | Crea tu primer cielo | Toca aqui para crear un cielo y empezar a llenarlo de estrellas. |

**Notas:**
- Step 3 (`streak-indicator`) se filtra antes de pasar los steps al hook si el elemento no existe en el DOM. La logica vive en el componente que llama a `useTour`, no en la definicion del tour:
```typescript
const steps = skiesWelcomeSteps.filter(step => {
  if (step.element === '[data-tour="streak-indicator"]') {
    return document.querySelector('[data-tour="streak-indicator"]') !== null
  }
  return true
})
```
- Suprimir `StardustOnboarding` mientras el tour esta activo para evitar overlap visual. El tour ya explica el Polvo Estelar.
- El step 1 sin `element` muestra un popover centrado en pantalla (comportamiento nativo de driver.js).

### Tour 2: Editor de cielo — SkyPage (`sky-editor`)

**Trigger:** Primera visita a un SkyPage (cualquier cielo) && usuario con role `owner` o `editor`
**Delay:** 800ms (esperar render del canvas y toolbar)

| # | Selector | Side | Titulo | Descripcion |
|---|----------|------|--------|-------------|
| 1 | _(sin elemento)_ | — | Tu cielo estrellado | Este es tu cielo. Cada punto de luz es una estrella — un recuerdo, un momento, una persona. |
| 2 | `[aria-label="Crear estrella"]` | right (desktop) / top (mobile) | Crear una estrella | Toca aqui para activar el modo de creacion. Luego toca cualquier parte del cielo para colocar tu estrella. |
| 3 | `[aria-label="Configuración"]` | right (desktop) / top (mobile) | Personaliza tu cielo | Cambia el tema, la densidad de estrellas y los efectos visuales. |
| 4 | `[aria-label="Volver"]` | right (desktop) / top (mobile) | Volver | Desde aqui puedes regresar a tu lista de cielos. |

**Notas:**
- **FloatingToolbar debe permanecer visible** durante el tour. Se agrega prop `forceVisible?: boolean` al componente. Cuando `forceVisible=true`, el auto-hide se desactiva.
- Steps 2-4 apuntan a botones del toolbar via `aria-label` — selectores estables.
- Si el usuario es `viewer`, se omite el step 2 (crear estrella) filtrando los steps antes de pasarlos al hook.
- El step sobre colaboradores se omite intencionalmente — es una feature secundaria, no abrumar al usuario nuevo.

### Tour 3: Tienda — ShopPage (`shop-intro`)

**Trigger:** Primera visita a ShopPage && `!tourCompleted`
**Delay:** 500ms

| # | Selector | Side | Titulo | Descripcion |
|---|----------|------|--------|-------------|
| 1 | `[data-tour="shop-balance"]` | bottom | Tu Polvo Estelar | Este es tu balance actual. Puedes ganar mas creando estrellas o comprando paquetes. |
| 2 | `[data-tour="theme-grid"]` | top | Temas disponibles | Desbloquea temas para cambiar la apariencia de tus cielos. Los que ya tienes estan marcados. |
| 3 | `[data-tour="buy-stardust-cta"]` | top | Obtener mas Polvo Estelar | Si quieres mas Polvo Estelar, puedes comprar paquetes aqui. |

---

## 6. Plan de implementacion

### Fase 1 — Base (sin tours)

| Paso | Descripcion | Archivos |
|------|-------------|----------|
| 1.1 | Instalar `driver.js` | `package.json` |
| 1.2 | Crear hook `useTour` | `hooks/useTour.ts` |
| 1.3 | Crear CSS custom para popovers (tema oscuro/glass) | `globals.css` |
| 1.4 | Agregar prop `forceVisible` a `FloatingToolbar` | `components/sky/FloatingToolbar.tsx` |

### Fase 2 — Tours

| Paso | Descripcion | Archivos |
|------|-------------|----------|
| 2.1 | Definir steps del tour `skies-welcome` | `tours/skiesWelcomeTour.ts` |
| 2.2 | Agregar atributos `data-tour` en SkiesPage | `pages/SkiesPage.tsx` |
| 2.3 | Integrar `useTour` en SkiesPage | `pages/SkiesPage.tsx` |
| 2.4 | Coordinar con StardustOnboarding (suprimir durante tour) | `pages/SkiesPage.tsx` |
| 2.5 | Definir steps del tour `sky-editor` | `tours/skyEditorTour.ts` |
| 2.6 | Integrar `useTour` en SkyPage con `forceVisible` | `pages/SkyPage.tsx` |
| 2.7 | Definir steps del tour `shop-intro` | `tours/shopIntroTour.ts` |
| 2.8 | Agregar atributos `data-tour` en ShopPage | `pages/ShopPage.tsx` |
| 2.9 | Integrar `useTour` en ShopPage | `pages/ShopPage.tsx` |

### Fase 3 — Polish

| Paso | Descripcion | Archivos |
|------|-------------|----------|
| 3.1 | Tests unitarios del hook `useTour` | `hooks/useTour.test.ts` |
| 3.2 | Verificacion visual mobile (375px) y desktop (1024px+) | Manual |
| 3.3 | Verificar que el build no excede 172 KB gz en critical path | `npm run build` |

---

## 7. Consideraciones tecnicas

### 7.1 z-index

driver.js usa `z-index: 1,000,000,000` para el popover. La app usa:
- FloatingToolbar: `z-30` (30)
- Creation mode hint: `z-20` (20)
- BottomSheets/modals: variable pero < 1000

**No hay conflicto.** driver.js estara siempre por encima. No se requiere ajuste.

### 7.2 FloatingToolbar auto-hide

El toolbar se oculta tras 3s de inactividad. Durante el tour `sky-editor`, los steps 2-4 apuntan a botones del toolbar.

**Solucion:** Agregar prop `forceVisible` a `FloatingToolbar`:

```typescript
// Cambio minimo en FloatingToolbar.tsx
interface FloatingToolbarProps {
  // ... props existentes
  forceVisible?: boolean  // Nuevo
}

// En el useEffect del auto-hide:
useEffect(() => {
  if (forceVisible || creationMode) {
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    return  // No iniciar timer
  }
  resetTimer()
  // ... listeners
}, [forceVisible, creationMode, resetTimer])
```

### 7.3 Canvas WebGL

SkyCanvas renderiza estrellas en un canvas WebGL — no hay elementos DOM individuales para seleccionar.

**Solucion:** Usar popover centrado sin `element` (step sin selector). driver.js muestra el popover en el centro de la pantalla con el overlay cubriendo todo. Esto comunica "mira el cielo en general" sin necesidad de apuntar a un elemento especifico.

### 7.4 Componentes lazy-loaded

`StarOverlay`, `StarFormSheet`, `SkySettingsSheet`, `CollaboratorsSheet` se cargan con `React.lazy()` y solo se montan cuando estan abiertos.

**Solucion:** No apuntar a estos componentes en el tour. Describir su funcionalidad en el texto del step que apunta al boton que los abre (ej. "Toca aqui para activar el modo de creacion" apunta al boton `+`, no al formulario).

### 7.5 Impacto en bundle

| Recurso | Tamaño | Carga |
|---------|--------|-------|
| driver.js (JS) | ~5 KB gz | Dynamic import (lazy) |
| driver.js (CSS) | ~2 KB gz | Dynamic import (lazy) |
| useTour.ts | < 1 KB | Tree-shaken si no se usa |
| Tour definitions | < 1 KB cada uno | Import estatico (negligible) |

**Critical path: sin cambio.** driver.js solo se carga cuando un tour se va a ejecutar. Si el usuario ya completo todos los tours, nunca se descarga.

### 7.6 Cleanup en SPA

El hook `useTour` ejecuta `driver.destroy()` en el cleanup del `useEffect` cuando el componente se desmonta (navegacion SPA). Esto previene:
- Overlay huerfano
- Listeners de eventos abandonados
- Memory leaks del timer

### 7.7 Mobile

driver.js posiciona los popovers automaticamente en mobile. Los `side` definidos en los steps son preferencias — driver.js reposiciona si no hay espacio.

Para el FloatingToolbar en mobile (posicion `bottom-6 left-1/2`), los popovers se muestran arriba (`top`) en lugar de a la derecha (`right`). Se puede definir con `side` en cada step, pero driver.js maneja esto nativamente.

### 7.8 Selectores estables

Se usan dos estrategias de selectores:
1. **`aria-label`** para botones del FloatingToolbar — ya existen y son estables (accesibilidad)
2. **`data-tour`** para elementos nuevos — atributos dedicados que no dependen de clases Tailwind ni estructura DOM

Los `data-tour` se agregan con impacto minimo:
```tsx
// Ejemplo en SkiesPage
<StardustBalance data-tour="stardust-balance" ... />
```

Si el componente no acepta props extra, wrappear en un `<div data-tour="...">` o pasar via `className`/spread.

### 7.9 DailyRewardModal

En SkiesPage, el `DailyRewardModal` puede mostrarse al cargar la pagina. El tour no debe iniciar mientras el modal este abierto.

**Solucion:** Condicionar el inicio del tour a que `showRewards === false`. Esto se pasa como parte de `enabled` en el hook. Con `delay: 500` y esta condicion, el tour espera a que el modal se cierre naturalmente antes de activarse.

```typescript
useTour({
  tourId: 'skies-welcome',
  steps: skiesWelcomeSteps,
  enabled: economy.loginStreak <= 1 && !showRewards,
  delay: 500,
})
```

---

## 8. Styling del popover

CSS custom para que los popovers coincidan con la estetica de la app (tema oscuro, glassmorphism):

```css
/* globals.css */
.cielo-tour-popover {
  background: rgba(15, 20, 35, 0.92) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 16px !important;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 64px rgba(140, 180, 255, 0.04) !important;
  color: var(--text-primary) !important;
}

.cielo-tour-popover .driver-popover-title {
  font-family: 'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif;
  font-weight: 300;
  letter-spacing: 0.03em;
  color: var(--text-primary) !important;
}

.cielo-tour-popover .driver-popover-description {
  font-size: 0.85rem;
  font-weight: 300;
  line-height: 1.6;
  color: var(--text-secondary) !important;
}

.cielo-tour-popover .driver-popover-progress-text {
  color: var(--text-muted) !important;
}

.cielo-tour-popover button.driver-popover-next-btn,
.cielo-tour-popover button.driver-popover-prev-btn,
.cielo-tour-popover button.driver-popover-done-btn {
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  color: var(--text-primary) !important;
  border-radius: 8px !important;
  font-size: 0.8rem;
  padding: 6px 14px;
  transition: background 0.15s;
}

.cielo-tour-popover button.driver-popover-next-btn:hover,
.cielo-tour-popover button.driver-popover-done-btn:hover {
  background: rgba(140, 180, 255, 0.12) !important;
}

.cielo-tour-popover .driver-popover-close-btn {
  color: var(--text-muted) !important;
}

.cielo-tour-popover .driver-popover-arrow {
  border-color: rgba(15, 20, 35, 0.92) !important;
}
```

---

## 9. Impacto en archivos existentes

| Archivo | Cambio |
|---------|--------|
| `frontend/package.json` | Agregar `driver.js: ^1.3.1` |
| `frontend/src/hooks/useTour.ts` | **Nuevo** — hook reutilizable |
| `frontend/src/tours/skiesWelcomeTour.ts` | **Nuevo** — steps del tour SkiesPage |
| `frontend/src/tours/skyEditorTour.ts` | **Nuevo** — steps del tour SkyPage |
| `frontend/src/tours/shopIntroTour.ts` | **Nuevo** — steps del tour ShopPage |
| `frontend/src/globals.css` | Agregar clases `.cielo-tour-popover` |
| `frontend/src/components/sky/FloatingToolbar.tsx` | Agregar prop `forceVisible` (3 lineas) |
| `frontend/src/pages/SkiesPage.tsx` | Agregar `data-tour` attrs + `useTour()` + coordinar con StardustOnboarding |
| `frontend/src/pages/SkyPage.tsx` | Agregar `useTour()` + `forceVisible` en FloatingToolbar |
| `frontend/src/pages/ShopPage.tsx` | Agregar `data-tour` attrs + `useTour()` |
| `frontend/src/hooks/useTour.test.ts` | **Nuevo** — tests del hook |

**Total:** 5 archivos nuevos, 5 archivos modificados (cambios quirurgicos).

---

## 10. Decisiones descartadas

| Alternativa | Razon de descarte |
|-------------|-------------------|
| **react-joyride** | ~15 KB gz, API mas compleja, depende de React portals que pueden conflictuar con BottomSheets. driver.js es mas ligero y framework-agnostic |
| **intro.js** | ~10 KB gz, licencia AGPL (comercial requiere pago). driver.js es MIT |
| **Custom (from scratch)** | Reinventar overlay + posicionamiento + scroll es semanas de trabajo para algo que driver.js resuelve en 5 KB |
| **Persistir en Firestore** | Mini-RFC requerido para modificar UserRecord. localStorage es suficiente para UX no-critica en SPA sin SSR. Si el usuario borra datos del navegador, ver el tour otra vez no es grave |
| **Tour multi-pagina (wizard)** | Fuerza al usuario a recorrer toda la app de una vez. Tours por pagina son menos invasivos y se activan en contexto |
| **Apuntar a elementos dentro del canvas** | WebGL no tiene DOM. Alternativas (overlay HTML sobre coordenadas del canvas) agregan complejidad desproporcionada. Un popover centrado es suficiente |

---

## 11. Verificacion

### Build

```bash
cd frontend && npm run build
# Verificar que no hay errores de TypeScript
# Verificar output: driver.js debe aparecer como chunk separado, NO en el critical path
```

### Tests

```bash
cd frontend && npm run test:run
# Todos los tests existentes deben pasar
# useTour.test.ts debe cubrir:
#   - No inicia si localStorage marca completado
#   - Inicia si no esta completado y enabled=true
#   - No inicia si enabled=false
#   - Limpia driver en unmount
#   - Marca completado en onDestroyed
```

### Checklist visual

- [ ] Tour `skies-welcome` se muestra al primer login
- [ ] Tour no se muestra si ya fue completado
- [ ] Tour no se muestra mientras DailyRewardModal esta abierto
- [ ] StardustOnboarding no se muestra durante el tour
- [ ] Tour `sky-editor` mantiene el FloatingToolbar visible
- [ ] Popover se posiciona correctamente en mobile (375px)
- [ ] Popover se posiciona correctamente en desktop (1024px+)
- [ ] Overlay cubre el canvas correctamente
- [ ] Botones "Siguiente"/"Anterior"/"Entendido" funcionan
- [ ] ESC cierra el tour y lo marca como completado
- [ ] Click en overlay cierra el tour
- [ ] No hay leak de memoria al navegar entre paginas durante un tour
- [ ] `npm run build` — critical path sigue en ~172 KB gz
- [ ] Tour `shop-intro` se muestra al primera visita a la tienda
- [ ] Los popovers usan la estetica glass/oscura de la app
