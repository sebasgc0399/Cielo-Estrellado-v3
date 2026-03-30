# SPEC v7 — Expansión del Sistema de Temas y Reorganización de Tienda

Referencia lean de la expansión del catálogo de temas y reorganización de la tienda. Para modelo base ver `SPEC.md`. Para economía ver `SPEC_v2.md`. Para video clips ver `SPEC_v3.md`. Para rendimiento ver `SPEC_v4.md`. Para seguridad ver `SPEC_v5.md`. Para tours ver `SPEC_v6.md`.

---

## 1. Resumen

Sistema para organizar, categorizar y escalar el catálogo de temas de 14 a 50+ sin perder la calidad individual de cada tema. Incluye taxonomía de categorías, proceso de diseño, reorganización de la UI de tienda, y estrategia de precios unificada.

| Dato | Valor |
|------|-------|
| Temas actuales | 14 (1 gratis + 13 de pago) |
| Categorías | 6 |
| Tiers de precio | 4 (gratis, esencia, paleta, especial) |
| Archivos nuevos | 4 componentes de UI (Fase 2) + 1 preview (Fase 3) |
| Fases | 3 incrementales |

**Filosofía:** Los temas NO se generan en masa. Cada tema se diseña individualmente — paleta curada, efectos coherentes, identidad propia. El sistema facilita agregar y organizar temas, no llenar un catálogo de golpe.

---

## 2. Anatomía de un Tema Bien Diseñado

### 2.1 Principios de Diseño

Un buen tema NO es "colores diferentes". Es una combinación curada que cuenta una historia visual:

**Coherencia cromática.** Los 13 campos de color cuentan una misma historia. "Aurora Boreal" son verdes-cyan específicos que dominan desde las estrellas hasta la nebulosa, las fugaces y el glow. Estrellas verdes con nebulosa rosa no es "Aurora Boreal" — es ruido visual.

**Contraste deliberado.** El fondo (`nebulaBase*`) es suficientemente oscuro para que las estrellas brillen. La diferencia de luminosidad entre fondo y `userStarColor` debe ser evidente. El `glowColor` es visible sin ser agresivo.

**Efecto como extensión, no como gimmick.** Si un tema tiene `meteorShower`, los colores de los meteoros pertenecen a la misma familia cromática. Si tiene `fireflies`, las luciérnagas complementan (no compiten con) las estrellas.

**Identidad en el nombre.** Evoca un lugar, momento o fenómeno. No técnico ("Tema Azul Oscuro"), no genérico ("Premium 3"). Es "Profundidades del Océano", "Jardín Encantado".

### 2.2 Espacio de Posibilidades del Engine

El SkyEngine (Canvas 2D, 5 capas) define el techo de lo posible sin cambiar código:

| Dimensión | Parámetros | Impacto visual |
|-----------|-----------|----------------|
| Paleta de estrellas | `starColorRange` (6 valores RGB min/max) | Color base de estrellas ambientales |
| Estrellas de usuario | `userStarColor`, `userStarHighlightColor`, `userStarGlowColor` | Estrellas colocadas por personas |
| Nebulosa | 4 colores RGBA: baseStart, baseEnd, accent, overlay | Fondo atmosférico — lo más impactante |
| Estrellas fugaces | `shootingStarHeadColor`, `shootingStarTailColor` | Destellos ocasionales |
| Glow | `glowColor`, `pointerGlowCenterColor`, `pointerGlowMidColor` | Resplandor ambiental y respuesta al cursor |
| Meteor shower | `frequency`, `trailLength`, `colors[]` | Lluvia constante de meteoros multicolor |
| Fireflies | `count`, `color`, `glowRadius`, `speed` | Partículas flotantes con pulso de brillo |
| Constellation lines | `maxDistance`, `color`, `opacity` | Líneas conectando estrellas cercanas |
| Star shape | `'circle'` \| `'heart'` \| `'crystal'` \| `'flower'` | Forma de estrellas de usuario |

**Combinaciones:** Todos los efectos son independientes y combinables. Un tema puede tener `meteorShower` + `fireflies` + `starShape:'heart'` simultáneamente. La única restricción: `starShape` es un valor único (no se mezclan formas).

**No configurable por tema** (hardcoded en engine):
- Cantidad de estrellas (derivada del área del canvas)
- Radios por capa (far: 0.4-1.1, mid: 0.6-1.6, near: 0.9-2.4)
- Parallax (far: 1.5%, mid: 3.5%, near: 6%)
- Algoritmo de nebulosa (10 accent blobs + 4 overlay blobs, compositing screen+overlay)
- Física de fugaces (ángulo, velocidad base, vida)

### 2.3 Los 13 Campos de Color

Cada tema define exactamente 13 colores con formatos y alphas estándar:

| Campo | Formato | Alpha típico | Qué controla |
|-------|---------|:------------:|-------------|
| `starColorRange` | `{rMin,rMax,gMin,gMax,bMin,bMax}` | — | Rango RGB para generación procedural de estrellas |
| `userStarColor` | `rgb(R,G,B)` | 1.0 | Color principal de estrellas de usuario |
| `userStarHighlightColor` | `rgb(R,G,B)` | 1.0 | Highlight al seleccionar estrella |
| `nebulaBaseStartColor` | `rgba(R,G,B,A)` | 0.9 | Inicio del gradiente de nebulosa |
| `nebulaBaseEndColor` | `rgba(R,G,B,A)` | 0.9 | Fin del gradiente de nebulosa |
| `nebulaAccentColor` | `rgba(R,G,B,A)` | 0.25 | Acento radial de nebulosa (blend screen) |
| `nebulaOverlayColor` | `rgba(R,G,B,A)` | 0.18 | Overlay de nebulosa (blend overlay) |
| `shootingStarHeadColor` | `rgba(R,G,B,A)` | 0.9 | Cabeza de estrella fugaz |
| `shootingStarTailColor` | `rgba(R,G,B,A)` | 0.35 | Cola de estrella fugaz |
| `glowColor` | `rgba(R,G,B,A)` | 0.45 | Glow general de estrellas |
| `pointerGlowCenterColor` | `rgba(R,G,B,A)` | 0.25 | Centro del glow del cursor |
| `pointerGlowMidColor` | `rgba(R,G,B,A)` | 0.12 | Anillo medio del glow del cursor |
| `userStarGlowColor` | `rgba(R,G,B,A)` | 0.6 | Glow alrededor de estrellas de usuario |

### 2.4 Template para Diseñar un Tema Nuevo

Ficha para completar antes de tocar código:

```
FICHA DE TEMA
═══════════════════════════════════

Nombre: ___________________________
ID (kebab-case): ___________________________
Descripción (1 línea): ___________________________
Categoría: [ ] Cielos Serenos  [ ] Horizontes  [ ] Cosmos Profundo
           [ ] Fenómenos  [ ] Formas Celestes  [ ] Edición Especial
Tags: ___________________________
Tier de precio: [ ] Esencia (600)  [ ] Paleta (800)  [ ] Especial (1500)

HISTORIA VISUAL
¿Qué lugar/momento/fenómeno evoca? ___________________________
Color dominante: ___________________________
Color de acento: ___________________________
Emoción: ___________________________

PALETA
───────────────────────────────────
Estrellas ambientales (starColorRange):
  R: ___ a ___   G: ___ a ___   B: ___ a ___

Estrellas de usuario:
  userStarColor: rgb(___, ___, ___)
  userStarHighlightColor: rgb(___, ___, ___)
  userStarGlowColor: rgba(___, ___, ___, 0.6)

Nebulosa:
  nebulaBaseStartColor: rgba(___, ___, ___, 0.9)
  nebulaBaseEndColor: rgba(___, ___, ___, 0.9)
  nebulaAccentColor: rgba(___, ___, ___, 0.25)
  nebulaOverlayColor: rgba(___, ___, ___, 0.18)

Estrellas fugaces:
  shootingStarHeadColor: rgba(___, ___, ___, 0.9)
  shootingStarTailColor: rgba(___, ___, ___, 0.35)

Glow:
  glowColor: rgba(___, ___, ___, 0.45)
  pointerGlowCenterColor: rgba(___, ___, ___, 0.25)
  pointerGlowMidColor: rgba(___, ___, ___, 0.12)

EFECTOS (opcionales)
───────────────────────────────────
[ ] meteorShower → frequency: ___  trailLength: ___  colors: [...]
[ ] fireflies → count: ___  color: ___  glowRadius: ___  speed: ___
[ ] constellationLines → maxDistance: ___  color: ___  opacity: ___
[ ] starShape: [ ] heart  [ ] crystal  [ ] flower

CHECKLIST
───────────────────────────────────
[ ] Fondo suficientemente oscuro (nebula base alpha = 0.9)
[ ] Estrellas de usuario visibles contra la nebulosa
[ ] Glow visible sin ser agresivo
[ ] Nombre evocador, no técnico
[ ] Colores de efectos coherentes con la paleta
[ ] Preview card muestra la esencia del tema
```

### 2.5 Proceso para Agregar un Tema

**Paso 1 — Diseño:** Completar la ficha de tema (§2.4).

**Paso 2 — Código:** Agregar en 3 archivos:
- `frontend/src/domain/themes.ts` — definición completa con category, tags, addedAt
- `frontend/src/domain/shopCatalog.ts` — entrada de ShopItem con precio
- `functions/src/domain/shopCatalog.ts` — entrada idéntica al frontend

**Paso 3 — Tests:** `cd frontend && npm run test:run` — `themes.test.ts` valida:
- 13 campos de ThemeColors presentes
- category es valor válido de ThemeCategory
- tags es array de ThemeTag válidos
- addedAt parsea como fecha ISO
- themeId en shopCatalog tiene definición correspondiente en themes.ts

**Paso 4 — Verificación visual:**
- `cd frontend && npm run dev`
- Navegar a `/shop` — verificar que la preview card muestra la esencia del tema
- Comprar el tema (en dev) y aplicarlo a un cielo — verificar que el engine renderiza correctamente
- Si tiene efectos: verificar que los meteoros/luciérnagas/líneas/formas se ven bien

**Paso 5 — Deploy:** Seguir flujo normal (tests → build → firebase deploy).

---

## 3. Categorías y Organización

### 3.1 Taxonomía

6 categorías con nombres evocadores. Cada tema pertenece a exactamente una.

| ID | Nombre | Criterio |
|----|--------|----------|
| `cielos-serenos` | Cielos Serenos | Paletas pastel o neutras, sin efectos |
| `horizontes` | Horizontes | Paletas ricas inspiradas en paisajes, sin efectos |
| `cosmos-profundo` | Cosmos Profundo | Tonos saturados o dramáticos, sin efectos |
| `fenomenos` | Fenómenos | Tiene meteorShower, fireflies, o constellationLines |
| `formas-celestes` | Formas Celestes | Tiene starShape ≠ circle |
| `edicion-especial` | Edición Especial | Temporada o edición limitada (vacía al lanzamiento) |

### 3.2 Asignación de Temas Existentes

| Tema | Categoría |
|------|-----------|
| classic | cielos-serenos |
| frost-crystal | cielos-serenos |
| rose-garden | cielos-serenos |
| aurora-borealis | horizontes |
| sunset-horizon | horizontes |
| ocean-depths | horizontes |
| golden-night | horizontes |
| purple-cosmos | cosmos-profundo |
| meteor-shower | fenómenos |
| fireflies | fenómenos |
| constellations | fenómenos |
| enchanted-garden | formas-celestes |
| diamond-crystal | formas-celestes |
| celestial-hearts | formas-celestes |

### 3.3 Tags

Opcionales, no exclusivos. Para filtrado cruzado futuro.

**Tags definidos:**

| Tag | Significado |
|-----|-------------|
| `calido` | Tonos cálidos dominantes |
| `frio` | Tonos fríos dominantes |
| `romantico` | Paletas románticas/emotivas |
| `naturaleza` | Inspirado en fenómenos naturales |
| `intenso` | Colores saturados/dramáticos |
| `minimalista` | Paletas sobrias/elegantes |
| `animado` | Tiene efecto dinámico (partículas, líneas) |

**Asignación actual:**

| Tema | Tags |
|------|------|
| classic | minimalista |
| aurora-borealis | frio, naturaleza |
| sunset-horizon | calido, naturaleza |
| purple-cosmos | intenso |
| rose-garden | calido, romantico |
| ocean-depths | frio, naturaleza |
| golden-night | calido, intenso |
| frost-crystal | frio, minimalista |
| meteor-shower | calido, intenso, animado |
| fireflies | calido, naturaleza, animado |
| constellations | frio, animado |
| enchanted-garden | calido, romantico, naturaleza |
| diamond-crystal | frio, minimalista |
| celestial-hearts | calido, romantico |

**Nota:** El tag `nuevo` no se almacena. Se deriva: `Date.now() - Date.parse(theme.addedAt) < 30 días`.

### 3.4 Cambios a la Interfaz ThemeDefinition

```typescript
// Nuevos tipos en themes.ts

type ThemeCategory =
  | 'cielos-serenos'
  | 'horizontes'
  | 'cosmos-profundo'
  | 'fenomenos'
  | 'formas-celestes'
  | 'edicion-especial'

type ThemeTag =
  | 'calido' | 'frio' | 'romantico' | 'naturaleza'
  | 'intenso' | 'minimalista' | 'animado'

// ThemeDefinition actualizada
interface ThemeDefinition {
  id: string
  name: string
  description: string
  category: ThemeCategory         // NUEVO
  tags: ThemeTag[]                // NUEVO
  addedAt: string                 // NUEVO — ISO date string
  colors: ThemeColors
  effects?: ThemeEffects
}
```

`getThemeById()` sigue devolviendo `ThemeParams | null` sin cambios. Los campos nuevos son metadata para la tienda, no para el engine.

### 3.5 Metadata de Categorías (para UI)

```typescript
const THEME_CATEGORIES: { id: ThemeCategory; name: string; description: string }[] = [
  { id: 'cielos-serenos', name: 'Cielos Serenos', description: 'Paletas suaves y calmas' },
  { id: 'horizontes', name: 'Horizontes', description: 'Inspiración terrenal' },
  { id: 'cosmos-profundo', name: 'Cosmos Profundo', description: 'Paletas intensas y profundas' },
  { id: 'fenomenos', name: 'Fenómenos', description: 'Efectos dinámicos' },
  { id: 'formas-celestes', name: 'Formas Celestes', description: 'Estrellas con formas especiales' },
  { id: 'edicion-especial', name: 'Edición Especial', description: 'Edición limitada' },
]
```

### 3.6 Helpers Nuevos

```typescript
function getThemesByCategory(category: ThemeCategory): ThemeDefinition[]
function getThemesByTag(tag: ThemeTag): ThemeDefinition[]
function isNewTheme(theme: ThemeDefinition): boolean  // addedAt < 30 días
function getCategoriesWithThemes(): ThemeCategoryMeta[]  // solo categorías con ≥1 tema
```

---

## 4. Reorganización de la Tienda

### 4.1 Layout Nuevo (de arriba a abajo)

```
┌──────────────────────────────────┐
│  ← Tienda              ✦ 1,250  │  Header (sin cambios)
├──────────────────────────────────┤
│  ┌────────┐ ┌────────┐ ┌──────  │
│  │Featured│ │Featured│ │Featu   │  Carrusel horizontal (180px alto)
│  └────────┘ └────────┘ └──────  │
├──────────────────────────────────┤
│  Todo│Serenos│Horizont│Cosmos│…  │  Category pills (scroll horizontal)
├──────────────────────────────────┤
│  Todos │ Sin adquirir │ Adquir  │  Filtro de propiedad
├──────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │Theme │ │Theme │ │Theme │    │  Grid de temas (2-3 cols)
│  │Card  │ │Card  │ │Card  │    │
│  └──────┘ └──────┘ └──────┘    │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │  …   │ │  …   │ │  …   │    │
│  └──────┘ └──────┘ └──────┘    │
├──────────────────────────────────┤
│  🌌 Espacio para cielo   ✦ 500  │  Sky-slot CTA (separado)
├──────────────────────────────────┤
│  [ Obtén más Polvo Estelar ]    │  Buy stardust CTA (sin cambios)
└──────────────────────────────────┘
```

### 4.2 Sección Destacados

Carrusel horizontal al inicio, antes de las categorías. Cards más grandes (180px alto vs 132px).

```typescript
// En themes.ts
const FEATURED_THEME_IDS: string[] = ['constellations', 'meteor-shower', 'enchanted-garden']
```

- Muestra nombre + descripción + precio
- Scroll horizontal con snap
- Se actualiza manualmente (decisión editorial, no algorítmica)
- Si el array está vacío, la sección no se renderiza

### 4.3 Category Pills

Pills horizontales con scroll, debajo de destacados.

- "Todo" es el default (muestra todos)
- Solo mostrar categorías con ≥1 tema (`getCategoriesWithThemes()`)
- Al seleccionar: grid se filtra client-side instantáneamente
- Pill activa: fondo `rgba(255,255,255,0.12)`, texto `var(--text-primary)`
- Pill inactiva: fondo transparente, texto `var(--text-muted)`, borde sutil

### 4.4 Filtro de Propiedad

Debajo de los pills: `Todos` | `Sin adquirir` | `Adquiridos`

Estado local en ShopPage. Se combina con la categoría activa. Puramente client-side.

### 4.5 Badge "Nuevo"

Temas con `addedAt` < 30 días: badge verde en esquina superior izquierda de la preview card.

- Coexiste con el badge "Especial" existente (que va en la esquina derecha)
- Estilo: fondo `rgba(134, 239, 172, 0.15)`, borde `rgba(134, 239, 172, 0.3)`, texto verde

### 4.6 Sky-Slot Separado

El item "Espacio para cielo" se saca del grid de temas. Se muestra como CTA horizontal independiente entre el grid y el botón de comprar stardust.

**Razón:** Es un producto fundamentalmente diferente. Mezclarlo con temas confunde la jerarquía visual.

### 4.7 Preview a Pantalla Completa (Fase 3)

Al hacer tap en el cuerpo de la card (no en "Comprar"), se abre dialog fullscreen:
- Mini SkyEngine canvas con el tema en vivo (solo estrellas ambientales + nebulosa + efectos, sin estrellas de usuario)
- Calidad `'low'` para rendimiento
- Nombre, descripción, precio y botón de compra
- Dynamic import (lazy) del componente

**Nota:** Fase 3. En Fases 1-2 se mantiene la preview estática actual.

### 4.8 Rendimiento

| Rango de temas | Estrategia |
|:-:|---|
| ≤30 | Sin optimización especial. El grid actual maneja bien. |
| 30-50 | `content-visibility: auto` en el contenedor del grid |
| 50+ | Evaluar `react-window` o virtualización por categoría |

**Bundle size de themes.ts:**
- 14 temas: ~17 KB raw → ~4 KB gzip
- 50 temas: ~58 KB raw → ~12 KB gzip
- 100 temas: ~117 KB raw → ~24 KB gzip

Aceptable hasta ~100 temas. Si supera 100 KB raw, considerar split por categoría con dynamic imports.

---

## 5. Estrategia de Precios

### 5.1 Cuatro Tiers

| Tier | Precio (PE) | Qué incluye | Justificación |
|------|:-----------:|-------------|---------------|
| **Gratis** | 0 | Solo `classic` | Siempre disponible, base del producto |
| **Esencia** | 600 | Paletas suaves sin efecto especial | ~1 mes de grind o ~$5,000 COP |
| **Paleta** | 800 | Paletas ricas sin efecto especial | ~6 semanas de grind o ~$8,000 COP |
| **Especial** | 1,500 | Cualquier efecto (partículas, líneas, formas) | ~2.5 meses de grind o ~$12,000 COP |

### 5.2 Reclasificación

| Tema | Precio actual | Precio nuevo | Cambio |
|------|:---:|:---:|---|
| meteor-shower | 1,200 | 1,500 | Unificar tier Especial |
| fireflies | 1,200 | 1,500 | Unificar tier Especial |
| (resto) | — | — | Sin cambios |

Usuarios que ya compraron no se ven afectados (ya está en inventario).

### 5.3 Criterios para Asignar Tier a Temas Nuevos

- **Esencia (600):** Solo cambio de paleta. Colores pastel, suaves, sin efecto ni forma especial.
- **Paleta (800):** Paleta rica/elaborada. Colores vibrantes o contrastantes, sin efecto ni forma especial.
- **Especial (1,500):** Tiene al menos un efecto (`meteorShower`, `fireflies`, `constellationLines`) O una forma especial (`starShape` ≠ circle). Los efectos requieren más trabajo de diseño y son visualmente más impactantes.

### 5.4 Temas Gratuitos

Mantener exactamente 1 (classic). No agregar más gratis por ahora. Si en el futuro se quiere un segundo tema gratuito como incentivo de onboarding, tratarlo como decisión de producto separada.

### 5.5 Referencia de Economía

| Fuente de PE | Cantidad |
|---|---:|
| Bono de bienvenida | 150 |
| Login diario | 15 |
| Crear estrella | 5 |
| Racha de 7 días | 50 |
| Invitar amigo | 30 |
| 1 semana de grind activo | ~135 |
| 1 mes de grind constante | ~600 |
| Paquete mínimo ($5,000 COP) | 500 |
| Paquete medio ($12,000 COP) | 1,375 |

---

## 6. Implementación Técnica

### 6.1 Archivos Duales (shopCatalog.ts)

Las categorías y tags **NO** se agregan a `shopCatalog.ts`. Son metadata de presentación que vive solo en `themes.ts` (frontend). El backend solo necesita itemId + price para validar compras.

Los `shopCatalog.ts` siguen idénticos en frontend y backend. Solo cambian los precios de meteor-shower y fireflies.

### 6.2 Tests Nuevos (themes.test.ts)

```typescript
// Agregar a themes.test.ts:
- Todos los temas tienen campo `category` válido de ThemeCategory
- Todos los temas tienen `tags` como array de ThemeTag válidos
- Todos los temas tienen `addedAt` que parsea como fecha ISO
- Temas con meteorShower/fireflies/constellationLines → category 'fenomenos'
- Temas con starShape ≠ circle → category 'formas-celestes'
- getThemesByCategory() devuelve temas correctos
- isNewTheme() funciona con fechas dentro/fuera de 30 días
- getCategoriesWithThemes() excluye categorías vacías
```

### 6.3 Fases de Implementación

#### Fase 1 — Datos y Organización (sin cambios de UI)

| Tarea | Archivo |
|-------|---------|
| Agregar `ThemeCategory`, `ThemeTag` types | `frontend/src/domain/themes.ts` |
| Agregar `category`, `tags`, `addedAt` a las 14 definiciones | `frontend/src/domain/themes.ts` |
| Agregar helpers: `getThemesByCategory`, `getThemesByTag`, `isNewTheme`, `getCategoriesWithThemes` | `frontend/src/domain/themes.ts` |
| Agregar `THEME_CATEGORIES` y `FEATURED_THEME_IDS` | `frontend/src/domain/themes.ts` |
| Actualizar precios meteor-shower y fireflies: 1200→1500 | `frontend/src/domain/shopCatalog.ts` + `functions/src/domain/shopCatalog.ts` |
| Actualizar y agregar tests | `frontend/src/domain/themes.test.ts` |

**Verificación:** `npm run test:run` en frontend y functions. La tienda sigue funcionando exactamente igual.

#### Fase 2 — Shop UI Reorganizado

| Tarea | Archivo |
|-------|---------|
| CategoryPills component | `frontend/src/components/shop/CategoryPills.tsx` (nuevo) |
| OwnershipFilter component | `frontend/src/components/shop/OwnershipFilter.tsx` (nuevo) |
| FeaturedCarousel component | `frontend/src/components/shop/FeaturedCarousel.tsx` (nuevo) |
| SkySlotCard component | `frontend/src/components/shop/SkySlotCard.tsx` (nuevo) |
| Badge "Nuevo" en ThemePreviewCard | `frontend/src/components/shop/ThemePreviewCard.tsx` |
| Refactor ShopPage con nuevo layout | `frontend/src/pages/ShopPage.tsx` |
| Actualizar tour shop-intro | `frontend/src/tours/shopIntroTour.ts` |

**Verificación:** Categorías filtran. Filtro de propiedad funciona. Featured muestra temas correctos. Tour funciona. Responsive en 375px y 1024px+. `npm run build` sin error.

#### Fase 3 — Preview Completa (post-lanzamiento)

| Tarea | Archivo |
|-------|---------|
| ThemeFullPreview dialog con mini SkyEngine | `frontend/src/components/shop/ThemeFullPreview.tsx` (nuevo) |
| Click en card → preview, click en "Comprar" → PurchaseDialog | `ThemePreviewCard.tsx`, `ShopPage.tsx` |

**Verificación:** Preview abre y cierra sin memory leaks. Engine renderiza correctamente. Performance aceptable en mobile.

### 6.4 Resumen de Archivos

| Archivo | Cambio | Fase |
|---------|--------|:----:|
| `frontend/src/domain/themes.ts` | +types, +campos en 14 temas, +helpers, +constantes | 1 |
| `frontend/src/domain/themes.test.ts` | +tests de category, tags, addedAt, helpers | 1 |
| `frontend/src/domain/shopCatalog.ts` | Precios: meteor-shower, fireflies 1200→1500 | 1 |
| `functions/src/domain/shopCatalog.ts` | Ídem frontend | 1 |
| `frontend/src/components/shop/CategoryPills.tsx` | **Nuevo** | 2 |
| `frontend/src/components/shop/OwnershipFilter.tsx` | **Nuevo** | 2 |
| `frontend/src/components/shop/FeaturedCarousel.tsx` | **Nuevo** | 2 |
| `frontend/src/components/shop/SkySlotCard.tsx` | **Nuevo** | 2 |
| `frontend/src/components/shop/ThemePreviewCard.tsx` | +badge "Nuevo" | 2 |
| `frontend/src/pages/ShopPage.tsx` | Refactor: layout, filtros, categorías | 2 |
| `frontend/src/tours/shopIntroTour.ts` | Actualizar selectores | 2 |
| `frontend/src/components/shop/ThemeFullPreview.tsx` | **Nuevo** — preview fullscreen | 3 |

---

## 7. Combinaciones sin Explorar

Referencia para inspiración al diseñar temas nuevos. Combinaciones de efectos + paletas que los 14 temas actuales NO usan:

| Combinación | Ejemplo posible |
|-------------|----------------|
| meteorShower + paleta fría | Lluvia de meteoros azul-hielo |
| meteorShower + starShape | Meteoros + estrellas de cristal |
| fireflies + paleta fría | Luciérnagas azules en bosque invernal |
| fireflies + starShape | Luciérnagas + estrellas de flor |
| constellationLines + paleta cálida | Constelaciones doradas/ámbar |
| constellationLines + starShape | Constelaciones + estrellas de corazón |
| meteorShower + fireflies | Lluvia de meteoros con luciérnagas |
| meteorShower + constellationLines | Meteoros entre constelaciones |
| fireflies + constellationLines | Luciérnagas y constelaciones |
| 3 efectos combinados | Meteoros + luciérnagas + constelaciones |
| Paleta monocromática extrema | Solo rojos, solo blancos, solo verdes |
| Paleta de alto contraste | Nebulosa muy oscura con estrellas muy brillantes |

**Esto es referencia, no roadmap.** Cada combinación se evalúa caso a caso al diseñar un tema específico.

---

## 8. Decisiones de Diseño

**¿Por qué las categorías viven en themes.ts, no en shopCatalog.ts?**
Son metadata de presentación. El backend (`handlers/shop.ts`) solo llama `getShopItem(itemId)` para validar existencia y precio. No necesita categorías. Agregarlas forzaría sincronizar campos extra entre los archivos duales sin beneficio.

**¿Por qué exactamente 4 tiers de precio?**
El sistema actual tiene 4 tiers implícitos (0, 600, 800, 1200/1500) que consolidamos en 3 pagos + 1 gratis. Más tiers crean parálisis de decisión. Menos (fusionar 600 y 800) eliminan el gradiente de valor entre paletas simples y ricas.

**¿Por qué la sección destacados es curada manualmente?**
Un "destacados" algorítmico (más nuevo, más comprado) crea feedback loops y pierde control editorial. El propósito es mostrar los temas que mejor demuestran las capacidades del sistema a visitantes nuevos.

**¿Por qué el sky-slot se separa del grid?**
Es un producto fundamentalmente diferente. Mezclarlo con temas confunde la jerarquía visual. `getShopItemsByCategory('theme')` ya lo filtra del grid, pero merece su propio CTA visual.

**¿Por qué ThemeFullPreview es Fase 3?**
La preview estática actual (gradiente + estrellas CSS + overlays de efectos) comunica bien la identidad del tema. Una preview con SkyEngine en vivo es la mejora correcta a largo plazo, pero involucra complejidad no trivial (lifecycle del engine en dialog, cleanup de memoria, performance mobile). No es prioridad.

---

## 9. Dirección Creativa — Colecciones Planeadas

Las siguientes colecciones representan la visión a largo plazo del catálogo. Cada tema dentro de una colección tiene identidad propia pero pertenece a una familia visual coherente. Se agregan de a pocos, con calidad sobre cantidad.

### 9.1 Constelaciones del Zodíaco (12 temas)

Cada signo con su constelación dibujada en el cielo, colores asociados al elemento, y efecto que evoque la personalidad del signo.

| Elemento | Signos | Paleta dominante |
|----------|--------|-----------------|
| Fuego | Aries, Leo, Sagitario | Rojos, naranjos, dorados |
| Agua | Cáncer, Escorpio, Piscis | Azules, verdes agua, turquesa |
| Tierra | Tauro, Virgo, Capricornio | Marrones, verdes bosque, ámbar |
| Aire | Géminis, Libra, Acuario | Blancos, celestes, plateados |

**Identidad por tema:** No es "cielo azul con etiqueta Acuario". Es un cielo que *se siente* como Acuario — fluido, etéreo, con luciérnagas azules que evocan corrientes de agua. Leo no es rojo genérico — es dorado intenso con meteoros ardientes que cruzan un cielo majestuoso.

**Requiere engine nuevo:** Sí. Necesita `constellationPattern` para dibujar formas específicas (ver §10.1).

### 9.2 Constelaciones Famosas (5-10 temas)

Orión, Osa Mayor, Cruz del Sur, Casiopea, Escorpio, etc. Cada una con su forma dibujada como efecto y paleta que evoque su mitología.

| Constelación | Atmósfera | Paleta |
|-------------|-----------|--------|
| Orión | Cazador épico, cielo invernal | Azules profundos, blancos brillantes |
| Osa Mayor | Navegación, norte, guía | Azules fríos, plateados |
| Cruz del Sur | Hemisferio sur, exploración | Blancos puros, violetas suaves |
| Casiopea | Realeza, vanidad, elegancia | Púrpuras, dorados |

**Requiere engine nuevo:** Sí. Mismo `constellationPattern` que Zodíaco (ver §10.1).

### 9.3 Fases Lunares (4-6 temas)

La luna como protagonista visual. Cada fase con iluminación y atmósfera diferentes.

| Fase | Efecto visual | Atmósfera |
|------|--------------|-----------|
| Luna Llena | Luna grande y brillante con resplandor | Iluminación máxima, nebulosa tenue |
| Cuarto Creciente | Media luna con sombra suave | Misterio, expectativa |
| Luna Nueva | Solo estrellas, oscuridad total | Intimidad, profundidad |
| Eclipse Lunar | Luna rojiza con corona | Dramatismo, rareza |

**Requiere engine nuevo:** Sí. Necesita `celestialBody` para renderizar luna con fases (ver §10.2).

### 9.4 Estaciones en Detalle (4-8 temas)

No "Primavera" genérico sino temas con identidad específica dentro de cada estación.

| Tema | Estación | Efecto clave | Paleta |
|------|----------|-------------|--------|
| Cerezo en Flor | Primavera | Pétalos rosa descendentes | Rosa suave, blancos |
| Tormenta de Verano | Verano | Relámpagos como flash | Azul oscuro, grises, destellos blancos |
| Hojas de Otoño | Otoño | Partículas naranjas descendentes | Naranjas, rojos, marrones |
| Primera Nevada | Invierno | Partículas blancas tipo nieve | Blancos, grises, azul pálido |
| Noche Tropical | Verano | Luciérnagas verdes + calor | Verdes oscuros, ámbar |
| Aurora de Invierno | Invierno | Cortinas verdes (nebulosa animada) | Verdes, púrpuras, azules |

**Requiere engine nuevo:** Parcialmente. "Noche Tropical" y "Aurora de Invierno" son posibles con el engine actual (fireflies + paleta). Los temas con partículas descendentes (pétalos, nieve, hojas) y relámpagos necesitan nuevos efectos (ver §10.3, §10.4).

### 9.5 Emociones / Momentos (5-8 temas)

Temas que evocan estados emocionales, no fenómenos físicos.

| Tema | Emoción | Paleta | Efecto |
|------|---------|--------|--------|
| Nostalgia | Melancolía suave | Tonos sepia, ámbar apagado | Nebulosa difusa, sin efectos |
| Celebración | Alegría, festejo | Dorados, multicolor | Partículas tipo confetti |
| Calma | Paz profunda | Azules profundos, lavanda | Movimiento ultra lento (fireflies speed: 0.2) |
| Energía | Vitalidad | Neón (cyan, magenta, verde) | Meteoros rápidos (frequency: 4+) |
| Intimidad | Cercanía | Rosas cálidos, ámbar | Luciérnagas tenues + starShape: heart |
| Misterio | Enigma | Púrpuras oscuros, negro | Constelaciones apenas visibles |

**Requiere engine nuevo:** Parcialmente. "Nostalgia", "Calma", "Energía", "Intimidad" y "Misterio" son posibles HOY con combinaciones de efectos existentes. "Celebración" necesita partículas descendentes (ver §10.3).

### 9.6 Resumen: Qué se Puede Hacer Hoy vs Qué Necesita Engine Nuevo

| Colección | Temas posibles hoy | Temas que requieren engine nuevo |
|-----------|:------------------:|:-------------------------------:|
| Zodíaco (12) | 0* | 12 (necesita constellationPattern) |
| Constelaciones Famosas (5-10) | 0* | 5-10 (necesita constellationPattern) |
| Fases Lunares (4-6) | 0 | 4-6 (necesita celestialBody) |
| Estaciones (4-8) | 2 | 2-6 (necesita fallingParticles, lightning) |
| Emociones (5-8) | 5 | 0-3 (necesita fallingParticles) |

*\*Los temas de Zodíaco y Constelaciones Famosas podrían hacerse con paleta + `constellationLines` (proximidad), pero NO tendrían la forma específica de cada constelación. Serían temas de paleta temática sin la constelación dibujada — perderían su identidad principal.*

**Total estimado:** ~7 temas creables hoy con el engine actual + ~30-40 que requieren nuevas capacidades del engine.

---

## 10. Gaps del Engine — Capacidades Futuras

Este SPEC (v7) se limita a lo que el engine actual ya soporta. Las siguientes capacidades serían necesarias para las colecciones de §9 y se documentan aquí como referencia para un futuro SPEC del engine.

### 10.1 Constellation Pattern (dibujar constelaciones específicas)

**Gap:** El efecto actual `constellationLines` conecta estrellas cercanas por **proximidad** (O(n²) distance check sobre near-layer stars). No puede dibujar formas específicas como Orión o Aries.

**Lo que se necesitaría:**
```typescript
type ConstellationPatternEffect = {
  stars: { x: number; y: number }[]     // posiciones normalizadas (0-1) de las estrellas de la constelación
  lines: [number, number][]              // pares de índices que definen las líneas
  color: string                          // color de las líneas
  starColor: string                      // color de las estrellas de la constelación
  opacity: number                        // opacidad base
  scale: number                          // escala relativa al canvas (0.3 = 30%)
  position: { x: number; y: number }     // centro de la constelación en el canvas
}
```

**Implementación estimada:** Media. Renderizar estrellas fijas + líneas entre ellas en la capa fx. La complejidad está en que las estrellas del patrón deben ser visualmente distintas de las ambientales y responder al parallax de forma coherente.

**Colecciones que desbloquea:** Zodíaco (12), Constelaciones Famosas (5-10).

### 10.2 Celestial Body (luna y otros cuerpos)

**Gap:** No existe renderizado de cuerpos celestes. No hay forma de mostrar una luna, sol, planeta, etc.

**Lo que se necesitaría:**
```typescript
type CelestialBodyEffect = {
  type: 'moon'                           // extensible a 'sun', 'planet'
  phase: number                          // 0 = nueva, 0.5 = llena, 1 = nueva (ciclo)
  size: number                           // fracción del canvas (0.08 = 8%)
  position: { x: number; y: number }     // posición normalizada
  color: string                          // color principal
  glowColor: string                      // resplandor alrededor
  glowRadius: number                     // radio del glow
}
```

**Implementación estimada:** Media-alta. Renderizar la luna con fases requiere clipping paths o compositing para la sombra. El glow es un radial gradient. La luna debe integrarse en la jerarquía de capas (¿entre nebulosa y far stars? ¿entre mid y near?). Performance no debería ser problema (un solo objeto).

**Colecciones que desbloquea:** Fases Lunares (4-6).

### 10.3 Falling Particles (partículas descendentes)

**Gap:** Las `fireflies` usan movimiento Browniano (random wandering). No hay sistema de partículas con gravedad que caigan de arriba hacia abajo. Nieve, pétalos, hojas, confetti — todos necesitan dirección descendente.

**Lo que se necesitaría:**
```typescript
type FallingParticlesEffect = {
  count: number                          // cantidad de partículas
  type: 'snow' | 'petals' | 'leaves' | 'confetti'  // afecta forma y movimiento
  color: string | string[]               // color(es) de las partículas
  speed: number                          // velocidad de caída (1 = normal)
  wind: number                           // drift horizontal (-1 a 1, 0 = sin viento)
  size: number                           // tamaño base de partícula
  opacity: number                        // opacidad base
}
```

**Implementación estimada:** Media. Similar a fireflies pero con velocidad vertical positiva constante + drift sinusoidal horizontal. Cada tipo tiene rendering diferente: snow = circles blancos con blur, petals = elipses rotadas, leaves = formas irregulares con rotación, confetti = rectángulos multicolor con tumble. Wrap vertical (desaparecen abajo, reaparecen arriba).

**Colecciones que desbloquea:** Estaciones con partículas (Cerezo en Flor, Hojas de Otoño, Primera Nevada), Emociones con confetti (Celebración).

### 10.4 Lightning Flash (relámpagos)

**Gap:** No existe efecto de flash o destello. No hay forma de simular relámpagos.

**Lo que se necesitaría:**
```typescript
type LightningEffect = {
  frequency: number                      // flashes por minuto (0.5 = 1 cada 2 min)
  intensity: number                      // 0-1, qué tan brillante es el flash
  color: string                          // color del destello
  duration: number                       // duración en ms (100-300ms típico)
}
```

**Implementación estimada:** Baja. Un flash es simplemente un overlay blanco/azul semitransparente sobre todo el canvas con fade-in/fade-out rápido. Timer aleatorio basado en frequency. Opcionalmente, renderizar un rayo (branching lines) sería más complejo pero el flash solo es trivial.

**Colecciones que desbloquea:** Estaciones (Tormenta de Verano).

### 10.5 Prioridad Sugerida de Engine Features

| Feature | Complejidad | Temas que desbloquea | Prioridad sugerida |
|---------|:-----------:|:--------------------:|:------------------:|
| `constellationPattern` | Media | 17-22 | Alta — desbloquea las 2 colecciones más grandes |
| `fallingParticles` | Media | 4-7 | Media — desbloquea variedad en Estaciones y Emociones |
| `celestialBody` | Media-alta | 4-6 | Media — colección completa pero independiente |
| `lightning` | Baja | 1-2 | Baja — pocos temas, efecto de nicho |

**Cada feature es un SPEC independiente del engine.** No se implementa como parte de este SPEC_v7. El proceso: diseñar el efecto → mini-RFC (como requiere CLAUDE.md para cambios al engine) → implementar → agregar los temas que lo usan.
