# SPEC v2 — Sistema de Economía y Temas

> Extensión del SPEC original. Define el sistema de moneda virtual "Polvo Estelar" y la personalización avanzada de cielos mediante temas desbloqueables.

---

## 1. Polvo Estelar — Moneda Virtual

### 1.1 Identidad

- **Nombre:** Polvo Estelar (Stardust)
- **Icono:** ✦ + número (ej: ✦ 350)
- **Alcance:** Por usuario (no por cielo)
- **Modelo:** Híbrido — se gana gratis jugando o se compra con dinero real
- **Bienvenida:** 100 PE al crear cuenta

### 1.2 Mecánicas de Ganancia

| Acción | Recompensa | Cooldown / Cap | Anti-exploit |
|--------|:----------:|---------------|-------------|
| Login diario | 10 PE | 1× por día calendario UTC | Campo `lastDailyRewardDate` idempotente |
| Crear una estrella | 5 PE | Máx 10 estrellas/día = 50 PE/día | Contador `createdStarsToday` reseteado por fecha |
| Primera estrella en cielo nuevo | 25 PE bonus | 1× por cielo (lifetime) | Flag por sky en transacción |
| Racha de 7 días consecutivos | 50 PE bonus | Se resetea al romper racha | Requiere login real cada día |
| Racha de 30 días consecutivos | 200 PE bonus | Se resetea al romper racha | No retroactivo — días perdidos no acumulan |
| Invitación aceptada | 30 PE | Máx 5 aceptadas/día | No acepta propias (ya enforced), cap diario |
| Bonus semanal (login ≥1×/semana) | 20 PE | 1× por semana ISO UTC | Campo `weeklyBonusWeek` |
| Creación de cuenta | 100 PE | Lifetime (una vez) | Se otorga en `userSync` |

### 1.3 Proyección de Ganancia Mensual

| Tipo de Usuario | Patrón Diario | PE/Mes Estimado |
|----------------|--------------|:---------------:|
| Casual (3×/semana, 1 estrella) | 10 login + 5 estrella = 15/sesión, 3×/sem | ~330 |
| Regular (diario, 2-3 estrellas) | 10 + 15 = 25/día | ~950 |
| Activo (diario, 5+ estrellas, invitaciones) | 10 + 25 + 15 = 50/día | ~2,200 |

**Tiempo al primer tema (800 PE):**
- Casual: ~2.5 meses
- Regular: ~25 días
- Activo: ~12 días

### 1.4 Compra con Dinero Real (Fase 3)

| Paquete | Polvo Estelar | USD | Bonus |
|---------|:------------:|:---:|:-----:|
| Puñado de Polvo | 500 | $0.99 | — |
| Bolsa de Polvo | 1,200 | $1.99 | +20% |
| Frasco de Polvo | 3,000 | $4.99 | +20% |
| Cofre Constelación | 8,000 | $9.99 | +60% |
| Bóveda Galáctica | 20,000 | $19.99 | +100% |

Requiere integración con Stripe o RevenueCat. No se implementa hasta Fase 3.

### 1.5 Anti-Exploit

1. **Todo server-side.** Ningún grant de PE ocurre en el cliente. Solo Cloud Functions otorgan PE.
2. **Caps diarios por acción.** Almacenados como campos en `UserRecord` con reset por fecha UTC.
3. **Login idempotente.** `lastDailyRewardDate` se compara contra `new Date().toISOString().slice(0, 10)`. Si coincide, no grant.
4. **Estrellas requieren contenido.** El handler `createStar` ya valida `title` obligatorio (max 200 chars). No hay farming de estrellas vacías.
5. **Invitaciones propias bloqueadas.** Ya está enforced — un usuario no puede aceptar su propia invitación.
6. **No retroactivo.** Días perdidos no acumulan. Rachas se rompen al faltar un día.
7. **Máximo teórico diario: ~217 PE.** Incluso un power user necesita ~4 días para un tema barato.

---

## 2. Sistema de Temas

### 2.1 Arquitectura: ThemeParams

El SkyEngine no entiende "temas" como concepto. Se extiende `SkyConfig` con un objeto `ThemeParams` que contiene los parámetros visuales actualmente hardcodeados. El engine sigue siendo un renderer puro. La resolución `themeId → ThemeParams` ocurre en el frontend como lookup estático.

```typescript
type StarColorRange = {
  rMin: number; rMax: number
  gMin: number; gMax: number
  bMin: number; bMax: number
}

type ThemeColors = {
  starColorRange: StarColorRange         // Paleta de estrellas de fondo
  userStarColor: string                  // Color de estrellas del usuario
  userStarHighlightColor: string         // Color de estrella resaltada
  nebulaBaseColor: string                // Gradiente base de la nebula
  nebulaAccentColor: string              // Acentos de la nebula
  nebulaOverlayColor: string             // Overlay de profundidad
  shootingStarColor: string              // Cabeza de la estrella fugaz
  shootingStarTailColor: string          // Cola/fade de la estrella fugaz
  glowColor: string                      // Shadow/glow de estrellas de fondo
  pointerGlowColor: string              // Luz ambiente del cursor
  userStarGlowColor: string             // Halo de estrellas del usuario
}

type ThemeParams = {
  colors: ThemeColors
}
```

**Extensión de SkyConfig (requiere mini-RFC):**

```typescript
type SkyConfig = {
  twinkle: boolean
  nebula: boolean
  shootingStars: boolean
  quality: 'high' | 'low'
  motion: 'mouse' | 'gyro'
  theme?: ThemeParams  // NUEVO — undefined = valores hardcodeados actuales
}
```

### 2.2 Cambios al SkyEngine (Mini-RFC)

**Qué cambia:**

| Método del Engine | Cambio |
|-------------------|--------|
| `createStars()` | Lee colores de `config.theme?.colors.starColorRange` en vez de hardcoded |
| `buildUserStar()` | Lee `userStarColor` y `userStarHighlightColor` del tema |
| `buildNebulaTexture()` | Lee `nebulaBaseColor`, `nebulaAccentColor`, `nebulaOverlayColor` del tema |
| `renderEffects()` | Lee colores de shooting stars y pointer glow del tema |
| `renderStars()` | Lee `glowColor` del tema |

**Qué NO cambia:**
- No hay métodos nuevos en la API pública del engine
- No hay conceptos nuevos de rendering
- No cambia estructura de capas, parallax, ni gestión de canvas
- El engine sigue siendo framework-agnostic
- Todo comportamiento existente se preserva cuando `theme` es `undefined`

**Riesgo:** Params inválidos podrían hacer estrellas invisibles. Mitigación: validar en catálogo (compile-time) y clampear valores en el engine.

### 2.3 Catálogo de Temas

El catálogo es **datos estáticos en el bundle del frontend** (`themes.ts` + `shopCatalog.ts`). No se almacena en Firestore.

**Fase 1 — Temas de Paleta de Color:**

| ID | Nombre | Precio | Descripción Visual |
|----|--------|:------:|-------------------|
| `classic` | Clásico | Gratis | Paleta azul-blanca actual (siempre disponible) |
| `aurora-borealis` | Aurora Boreal | 800 PE | Estrellas verde-cyan, nebula verde-púrpura, shooting stars cyan |
| `sunset-horizon` | Horizonte Atardecer | 800 PE | Estrellas naranja-ámbar, nebula rosa-cálida, shooting stars doradas |
| `purple-cosmos` | Cosmos Púrpura | 800 PE | Estrellas púrpura-magenta, nebula violeta profunda, shooting stars lavanda |
| `rose-garden` | Jardín de Rosas | 600 PE | Estrellas rosa-rosadas, nebula suave rosada, shooting stars rose-gold |
| `ocean-depths` | Profundidades del Océano | 800 PE | Estrellas teal-cyan, nebula azul profunda, shooting stars aqua |
| `golden-night` | Noche Dorada | 800 PE | Estrellas oro-ámbar, nebula dorada cálida, shooting stars gold |
| `frost-crystal` | Cristal de Hielo | 600 PE | Estrellas blanco-azuladas, nebula pálida azul, shooting stars blancas |

**Fase 2 — Temas de Efectos Especiales:**

| ID | Nombre | Precio | Extensión del Engine |
|----|--------|:------:|---------------------|
| `meteor-shower` | Lluvia de Meteoros | 1,200 PE | Aumentar frecuencia y tamaño de shooting stars |
| `fireflies` | Luciérnagas | 1,500 PE | Nuevo sistema de partículas cálidas en capa fx |
| `constellation-lines` | Constelaciones | 1,500 PE | Nuevo render pass dibujando líneas entre user stars cercanas |

**Fase 3 — Temas de Forma de Estrella:**

| ID | Nombre | Precio | Extensión del Engine |
|----|--------|:------:|---------------------|
| `heart-stars` | Estrellas Corazón | 1,000 PE | Reemplazar `arc()` con path-based rendering |
| `crystal-stars` | Estrellas Cristal | 1,000 PE | Rendering de polígonos diamante |
| `flower-stars` | Estrellas Flor | 1,000 PE | Paths complejos de pétalos |

### 2.4 Modelo de Propiedad

- Los temas pertenecen al **usuario**, no al cielo.
- Un owner aplica un tema que posee a cualquier cielo donde sea owner.
- El cielo almacena `themeId: string | null` (null = `classic`).
- Si el owner pierde el tema (reembolso, etc.), el cielo cae automáticamente a `classic`.
- **Todos los miembros** del cielo ven el tema que el owner eligió.

### 2.5 Flujo de Aplicación de Tema

1. En `SkySettingsSheet`, el **ThemePicker** muestra temas del inventario del usuario + `classic` (siempre gratis).
2. Seleccionar tema → `PATCH /api/skies/{skyId}/theme` con `{ themeId }`.
3. Handler valida: usuario es owner del cielo + posee el tema (o es `classic`).
4. Se actualiza `skies/{skyId}.themeId`.
5. En `SkyPage`, `useSkyData` trae el `themeId`, se resuelve a `ThemeParams` via lookup estático en `themes.ts`.
6. `ThemeParams` se pasa a `SkyCanvas` → `SkyEngine.setConfig()`.
7. Engine re-renderiza con la nueva paleta. Cambio inmediato.

### 2.6 Preview de Temas

Al navegar la tienda, tocar un tema muestra un mini `<SkyCanvas>` en modo demo con los `ThemeParams` de ese tema aplicados. Reutiliza el componente existente — solo se pasa un config diferente.

---

## 3. Tienda (Shop)

### 3.1 Items Disponibles

| Item | Categoría | Precio PE | Fase | Notas |
|------|-----------|:---------:|:----:|-------|
| 7 temas de paleta | `theme` | 600-800 | 2 | Ver catálogo §2.3 |
| 3 temas de efecto | `theme` | 1,200-1,500 | 2-3 | Requieren extensión del engine |
| 3 temas de forma | `theme` | 1,000 | 3 | Requieren refactor del engine |
| Slot extra de cielo (+1) | `sky-slot` | 500 | 1 | Incremental, se puede comprar múltiples veces |

### 3.2 Flujo de Compra

1. Usuario abre la tienda (página `/shop` o sheet desde SkiesPage).
2. Navega items por categoría. Toca uno para ver preview (mini canvas para temas).
3. Toca "Desbloquear". Frontend llama `POST /api/shop/purchase` con `{ itemId }`.
4. Cloud Function valida en este orden:
   - Item existe en catálogo (hardcodeado server-side también).
   - Usuario tiene balance de PE suficiente.
   - Usuario no posee el item ya (excepto `sky-slot` que es acumulable).
5. **En transacción Firestore atómica:**
   - Debita PE de `users/{uid}.stardust`.
   - Agrega item a `users/{uid}/inventory/{itemId}`.
   - Registra transacción en `users/{uid}/transactions/{txId}`.
   - Para `sky-slot`: incrementa `users/{uid}.maxSkies` en 1.
6. Retorna éxito con nuevo balance. Frontend actualiza estado.

### 3.3 Catálogo Estático

El catálogo se define como datos estáticos en el código (`shopCatalog.ts` en frontend y `functions`). No se almacena en Firestore — cambia con deploys de código, no en runtime. Esto sigue la filosofía de simplicidad extrema.

```typescript
type ShopItem = {
  id: string
  category: 'theme' | 'sky-slot'
  name: string
  description: string
  price: number                     // en Polvo Estelar
  previewThemeParams?: ThemeParams  // para preview de temas
  sortOrder: number
  phase: number                     // fase de implementación
}
```

---

## 4. Modelo de Datos

### 4.1 Cambios a Colecciones Existentes

**`users/{uid}` — campos nuevos:**

```typescript
interface UserRecord {
  // ...campos existentes (displayName, email, photoURL, etc.)...

  stardust: number                     // Balance de Polvo Estelar (default: 100)
  maxSkies: number                     // Límite de cielos (default: 2)
  lastDailyRewardDate: string | null   // Fecha ISO "YYYY-MM-DD" UTC
  loginStreak: number                  // Días consecutivos (default: 0)
  createdStarsToday: number            // Reset diario (default: 0)
  lastStarCreationDate: string | null  // Fecha ISO "YYYY-MM-DD" para reset diario
  weeklyBonusWeek: string | null       // Semana ISO "YYYY-Www" del último bonus semanal
}
```

Valores default para usuarios existentes (se inicializan en `userSync` al primer login post-deploy):
- `stardust: 100`, `maxSkies: 2`, `lastDailyRewardDate: null`, `loginStreak: 0`, `createdStarsToday: 0`, `lastStarCreationDate: null`, `weeklyBonusWeek: null`

**`skies/{skyId}` — campo nuevo:**

```typescript
interface SkyRecord {
  // ...campos existentes (title, description, ownerUserId, etc.)...

  themeId: string | null  // ID del tema aplicado. null = 'classic'
}
```

`themeId` es campo top-level, separado de `personalization` — son conceptos independientes.

### 4.2 Colecciones Nuevas

**`users/{uid}/inventory/{itemId}` — items desbloqueados:**

```typescript
interface InventoryItem {
  itemId: string
  category: 'theme' | 'sky-slot'
  purchasedAt: IsoDateString
  source: 'shop' | 'gift' | 'promo'
}
```

**`users/{uid}/transactions/{txId}` — log de auditoría:**

```typescript
interface TransactionRecord {
  type: 'earn' | 'spend'
  amount: number
  reason: string          // 'daily_login' | 'star_creation' | 'first_star_bonus' |
                          // 'streak_7' | 'streak_30' | 'invite_accepted' |
                          // 'weekly_bonus' | 'welcome' | 'shop_purchase'
  itemId: string | null   // para compras
  balanceAfter: number
  createdAt: IsoDateString
}
```

Colección de solo escritura (append). Fuente de verdad del balance es `users/{uid}.stardust`. Existe para auditoría y debugging.

### 4.3 Reglas de Firestore

```
match /users/{uid}/inventory/{itemId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;  // solo Admin SDK via Cloud Functions
}

match /users/{uid}/transactions/{txId} {
  allow read: if request.auth != null && request.auth.uid == uid;
  allow write: if false;  // solo Admin SDK via Cloud Functions
}
```

### 4.4 Índices de Firestore

```json
{
  "collectionGroup": "inventory",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "category", "order": "ASCENDING" },
    { "fieldPath": "purchasedAt", "order": "DESCENDING" }
  ]
}
```

---

## 5. API Endpoints

### 5.1 Endpoints Nuevos

| Método | Ruta | Auth | Descripción |
|--------|------|:----:|-------------|
| GET | `/api/user/economy` | Requerida | Retorna balance, racha, inventario completo |
| POST | `/api/user/daily-reward` | Requerida | Reclama reward diario. Idempotente — llamar 2× en el mismo día no duplica. |
| GET | `/api/shop/catalog` | Requerida | Retorna items del catálogo con `owned: boolean` por item |
| POST | `/api/shop/purchase` | Requerida | Compra un item. Body: `{ itemId: string }`. Transaccional. |
| PATCH | `/api/skies/{skyId}/theme` | Owner | Aplica tema al cielo. Body: `{ themeId: string }`. Valida propiedad. |

### 5.2 Endpoints Existentes Modificados

| Endpoint | Cambio |
|----------|--------|
| `POST /api/skies/{skyId}/stars` | Agregar grant de 5 PE por crear estrella (con cap diario). Grant de 25 PE si es primera estrella en ese cielo. |
| `POST /api/skies` | Enforzar `maxSkies` — si el usuario ya tiene `count >= maxSkies` cielos, retornar 403. |
| `userSync` (login trigger) | Inicializar campos economy con defaults si no existen. |

---

## 6. Estructura de Archivos Nuevos

### 6.1 Frontend

```
frontend/src/
  domain/
    themes.ts              # Definiciones de ThemeParams por cada tema
    shopCatalog.ts          # Catálogo estático de items + precios
    economy.ts              # Constantes: caps, rewards, amounts
  hooks/
    useUserEconomy.ts       # Fetch y cache de balance + inventario
  pages/
    ShopPage.tsx            # Página de tienda
  components/
    shop/
      ShopItemCard.tsx      # Card de item individual
      ThemePreview.tsx       # Mini SkyCanvas con tema aplicado en demo
      PurchaseDialog.tsx    # Confirmación de compra + chequeo de balance
    sky/
      ThemePicker.tsx       # Selector de tema en SkySettingsSheet (reemplaza SegmentedControl actual)
```

### 6.2 Backend (functions)

```
functions/src/
  handlers/
    economy.ts              # Handlers: dailyReward, getEconomy
    shop.ts                 # Handlers: getCatalog, purchase
  domain/
    shopCatalog.ts          # Catálogo server-side (para validación)
    economyRules.ts         # Constantes de caps, rewards, amounts
```

---

## 7. Archivos Existentes a Modificar

| Archivo | Cambio |
|---------|--------|
| `frontend/src/engine/SkyEngine.ts` | Parametrizar colores hardcodeados con `ThemeParams` |
| `frontend/src/domain/contracts.ts` | Agregar tipos: `ThemeParams`, `ThemeColors`, `StarColorRange`, `ShopItem`, `InventoryItem`, `TransactionRecord`. Extender `UserRecord` con campos economy. |
| `functions/src/domain/contracts.ts` | Espejo de los tipos anteriores |
| `functions/src/handlers/skies.ts` | Enforzar `maxSkies` en `createSky`. Agregar handler para `PATCH theme`. |
| `functions/src/handlers/stars.ts` | Agregar grant de PE en `createStar` |
| `functions/src/handlers/userSync.ts` | Inicializar campos economy para usuarios nuevos y existentes |
| `functions/src/router.ts` | Registrar nuevas rutas (`/api/user/*`, `/api/shop/*`) |
| `functions/src/index.ts` | Exportar nuevos handlers si es necesario |
| `frontend/src/components/sky/SkySettingsSheet.tsx` | Reemplazar SegmentedControl de tema con `ThemePicker` |
| `frontend/src/components/sky/SkyCanvas.tsx` | Pasar `ThemeParams` resuelto al engine via `SkyConfig` |
| `frontend/src/pages/SkyPage.tsx` | Resolver `themeId → ThemeParams` y pasarlo al canvas |
| `firestore.rules` | Agregar reglas de read para `inventory` y `transactions` |
| `frontend/src/lib/api/client.ts` | Agregar funciones para los nuevos endpoints |

---

## 8. Plan de Implementación por Fases

### Fase 1: Economía Base (MVP)

1. Extender `UserRecord` con campos economy en `contracts.ts` (frontend + functions)
2. Crear subcollecciones `inventory` y `transactions`
3. Implementar `POST /api/user/daily-reward` (idempotente)
4. Agregar grant de PE en handler `createStar` existente
5. Implementar `GET /api/user/economy`
6. Enforzar `maxSkies` en handler `createSky`
7. Hook `useUserEconomy` en frontend
8. Mostrar balance de PE en UI (header de SkiesPage, perfil)
9. Migración: inicializar valores economy en `userSync`
10. Compra de slots extra de cielos (`sky-slot` en shop)

### Fase 2: Engine de Temas + Tienda

1. Mini-RFC del SkyEngine: agregar `ThemeParams` a `SkyConfig`, parametrizar todos los colores hardcodeados
2. Crear `themes.ts` con los 7 temas de paleta de color
3. Crear `shopCatalog.ts` con todos los items comprables
4. Implementar `POST /api/shop/purchase` (transaccional)
5. Implementar `GET /api/shop/catalog`
6. Implementar `PATCH /api/skies/{skyId}/theme`
7. Construir `ShopPage` con cards y previews
8. `ThemePicker` en `SkySettingsSheet`
9. Wiring de resolución de tema en `SkyPage`
10. Actualizar `firestore.rules` para `inventory`/`transactions`

### Fase 3: Dinero Real + Temas Avanzados

1. Integrar proveedor de pagos (Stripe Checkout o RevenueCat)
2. Endpoint `POST /api/shop/purchase-iap` con validación de recibo
3. Temas de efectos especiales (meteor shower, fireflies, constellation lines) — extensión del engine
4. Temas de forma de estrella (hearts, crystals, flowers) — refactor significativo del engine
5. Temas de fondo/ambiente (imágenes de fondo detrás del canvas)

### Fase 4: Ideas Futuras

- Temas estacionales de tiempo limitado (navidad, san valentín, halloween)
- Paletas custom creadas por el usuario (avanzado — define tus propios colores RGB)
- Badges de logros que otorgan PE
- Votación colaborativa de tema entre miembros de un cielo
- Sistema de regalos (enviar PE o items a otros usuarios)
- Música/sonido ambiente atado al tema

---

## 9. Verificación

### Economía
- Crear cuenta → verificar 100 PE iniciales
- Hacer login → verificar +10 PE
- Crear estrella → verificar +5 PE
- Crear 11 estrellas en un día → verificar que la 11ª no da PE (cap)
- Completar racha 7 días → verificar +50 PE bonus
- Verificar que el bonus semanal se otorga al primer login de la semana

### Tienda
- Abrir shop → ver items con precios y estado owned/locked
- Comprar tema con PE suficiente → verificar débito → verificar aparece en inventario
- Intentar comprar con PE insuficiente → error apropiado
- Intentar comprar item ya poseído → error apropiado
- Comprar sky-slot → verificar que `maxSkies` incrementó

### Temas
- Comprar tema → ir a SkySettings → ver tema en ThemePicker → seleccionar → verificar que el canvas cambia colores
- Verificar que miembros (editor/viewer) ven el tema del owner
- Aplicar tema a cielo → verificar persistencia tras reload
- Tema `classic` siempre disponible sin compra

### Límite de Cielos
- Tener 2 cielos → intentar crear 3° → error "máximo alcanzado"
- Comprar slot extra → crear 3° cielo → éxito
- Verificar que el conteo de cielos solo cuenta cielos donde el usuario es owner
