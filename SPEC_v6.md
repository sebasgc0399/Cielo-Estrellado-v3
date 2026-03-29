# SPEC v6 — Tours Guiados con driver.js (Referencia Lean)

Referencia lean de los recorridos guiados para usuarios nuevos. Para modelo base ver `SPEC.md`. Para economia ver `SPEC_v2.md`. Para video clips ver `SPEC_v3.md`. Para rendimiento ver `SPEC_v4.md`. Para seguridad ver `SPEC_v5.md`.

---

## 1. Resumen

Tours interactivos en 3 pantallas principales (SkiesPage, SkyPage, ShopPage) usando driver.js. Se activan automaticamente para usuarios nuevos y se muestran una sola vez.

| Dato | Valor |
|------|-------|
| Libreria | `driver.js ^1.3.1` (MIT) |
| Bundle | ~6 KB gz (JS) + ~1 KB gz (CSS) |
| Carga | Dynamic import (lazy) — 0 KB en critical path |
| Persistencia | localStorage por tour |
| Tests | 8 tests unitarios (`useTour.test.ts`) |

---

## 2. Tours implementados

### Tour 1: Bienvenida — SkiesPage (`skies-welcome`)

**Trigger:** `economy.loginStreak <= 1 && !showRewards` · Delay: 500ms

| # | Selector | Titulo |
|---|----------|--------|
| 1 | _(centrado)_ | ¡Bienvenido a Cielo Estrellado! ✦ |
| 2 | `[data-tour="stardust-balance"]` | Polvo Estelar |
| 3 | `[data-tour="streak-indicator"]` | Racha diaria |
| 4 | `[data-tour="store-button"]` | Tienda |
| 5 | `[data-tour="create-sky-fab"]` | Crea tu primer cielo |

Step 3 se filtra si el elemento no existe en el DOM (loginStreak === 0). `StardustOnboarding` se suprime mientras el tour esta activo.

### Tour 2: Editor — SkyPage (`sky-editor`)

**Trigger:** Primera visita a cualquier cielo · Delay: 800ms

| # | Selector | Titulo |
|---|----------|--------|
| 1 | _(centrado)_ | Tu cielo estrellado |
| 2 | `[aria-label="Crear estrella"]` | Crear una estrella |
| 3 | `[aria-label="Configuración"]` | Personaliza tu cielo |
| 4 | `[aria-label="Volver"]` | Volver |

Step 2 se filtra si el usuario es `viewer`. FloatingToolbar recibe `forceVisible={tourActive}` para evitar auto-hide durante el tour.

### Tour 3: Tienda — ShopPage (`shop-intro`)

**Trigger:** Primera visita a ShopPage · Delay: 500ms

| # | Selector | Titulo |
|---|----------|--------|
| 1 | `[data-tour="shop-balance"]` | Tu Polvo Estelar |
| 2 | `[data-tour="theme-grid"]` | Temas disponibles |
| 3 | `[data-tour="buy-stardust-cta"]` | Obtener mas Polvo Estelar |

---

## 3. Arquitectura

### Hook `useTour`

Hook reutilizable que maneja el ciclo completo del tour:

1. Verifica localStorage (`cielo-estrellado:tour-completed:{tourId}`)
2. Carga driver.js + CSS via dynamic import
3. Inicializa el driver con config estandar (overlay oscuro, glassmorphism, textos en español)
4. Ejecuta `driver.drive()` tras el delay
5. Marca completado en `onDestroyed`
6. Cleanup en unmount (`driver.destroy()`)

```typescript
const { isActive, restart, isCompleted } = useTour({
  tourId: 'skies-welcome',
  steps: filteredSteps,
  enabled: economy.loginStreak <= 1 && !showRewards,
  delay: 500,
  onComplete: () => { /* opcional */ },
})
```

### Estructura de archivos

```
frontend/src/
├── hooks/
│   ├── useTour.ts              # Hook reutilizable
│   └── useTour.test.ts         # 8 tests
├── tours/
│   ├── skiesWelcomeTour.ts     # 5 steps
│   ├── skyEditorTour.ts        # 4 steps
│   └── shopIntroTour.ts        # 3 steps
```

### Persistencia

| Clave localStorage | Tour |
|---------------------|------|
| `cielo-estrellado:tour-completed:skies-welcome` | Bienvenida SkiesPage |
| `cielo-estrellado:tour-completed:sky-editor` | Editor SkyPage |
| `cielo-estrellado:tour-completed:shop-intro` | Tienda ShopPage |

---

## 4. Detalle tecnico

### Selectores estables

Dos estrategias:
- **`aria-label`** para botones del FloatingToolbar — ya existian (accesibilidad)
- **`data-tour`** para elementos nuevos — atributos dedicados que no dependen de clases Tailwind ni estructura DOM

### FloatingToolbar `forceVisible`

Prop `forceVisible?: boolean` agregada al componente. Cuando `true`, desactiva el auto-hide de 3 segundos. Se usa durante el tour `sky-editor` para que los botones del toolbar permanezcan visibles mientras se destacan.

### Canvas WebGL

SkyCanvas renderiza estrellas en un canvas WebGL — no hay elementos DOM individuales. Se usa popover centrado sin `element` (step sin selector) para explicar el cielo como concepto general.

### Coordinacion con DailyRewardModal

El tour `skies-welcome` no inicia mientras `showRewards === true`. Cuando el modal se cierra, `showRewards` pasa a `false` y el tour arranca tras 500ms.

### Coordinacion con StardustOnboarding

`StardustOnboarding` se suprime con `!tourActive` en la condicion de renderizado. Evita overlap visual ya que el tour cubre la misma informacion.

### Filtrado de steps

Los steps se filtran en el componente antes de pasarlos al hook, no dentro de callbacks de driver.js:

```typescript
const steps = skiesWelcomeSteps.filter(step => {
  if (step.element === '[data-tour="streak-indicator"]') {
    return document.querySelector('[data-tour="streak-indicator"]') !== null
  }
  return true
})
```

### z-index

driver.js usa `z-index: 1,000,000,000`. La app usa z-30 (toolbar), z-20 (hints), <1000 (modals). Sin conflicto.

### Impacto en bundle

driver.js se carga exclusivamente via dynamic import. Chunk separado: `driver.js-DXsZKhPS.js` (6.16 KB gz). Critical path sin cambio (~172 KB gz).

---

## 5. Styling

Popover con glassmorphism oscuro via clase `.cielo-tour-popover` en `globals.css`:

- Background: `rgba(15, 20, 35, 0.92)` con blur 20px
- Titulos: fuente serif (Georgia), font-weight 300
- Botones: glass con hover accent azul
- Variables CSS del proyecto reutilizadas (`--text-primary`, `--text-secondary`, `--text-muted`)

---

## 6. Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `package.json` | Dependencia `driver.js: ^1.3.1` |
| `hooks/useTour.ts` | **Nuevo** — hook reutilizable |
| `hooks/useTour.test.ts` | **Nuevo** — 8 tests |
| `tours/skiesWelcomeTour.ts` | **Nuevo** — 5 steps |
| `tours/skyEditorTour.ts` | **Nuevo** — 4 steps |
| `tours/shopIntroTour.ts` | **Nuevo** — 3 steps |
| `styles/globals.css` | Clases `.cielo-tour-popover` |
| `components/sky/FloatingToolbar.tsx` | Prop `forceVisible` |
| `pages/SkiesPage.tsx` | `data-tour` attrs + `useTour` + supresion StardustOnboarding |
| `pages/SkyPage.tsx` | `useTour` + `forceVisible` en FloatingToolbar |
| `pages/ShopPage.tsx` | `data-tour` attrs + `useTour` |

---

## 7. Verificacion

```bash
cd frontend && npm run test:run   # 61 tests (8 nuevos de useTour)
cd frontend && npm run build      # driver.js en chunk separado, critical path sin cambio
```

### Probar tours manualmente

```javascript
// Consola del navegador — resetear tours
localStorage.removeItem('cielo-estrellado:tour-completed:skies-welcome')
localStorage.removeItem('cielo-estrellado:tour-completed:sky-editor')
localStorage.removeItem('cielo-estrellado:tour-completed:shop-intro')
// Recargar pagina
```

### Checklist

- Tour `skies-welcome` se muestra al primer login, no durante DailyRewardModal
- Tour `sky-editor` mantiene FloatingToolbar visible durante el recorrido
- Tour `shop-intro` se muestra en primera visita a la tienda
- Tours no se repiten tras completar o cerrar
- Popovers con estetica glassmorphism oscura
- Funciona en mobile (375px) y desktop (1024px+)
- Build: critical path ~172 KB gz sin cambio
