# SPEC v2 — Sistema de Economía y Temas

> Extensión del SPEC original. Define el sistema de moneda virtual "Polvo Estelar" y la personalización avanzada de cielos mediante temas desbloqueables.

---

## 1. Polvo Estelar — Moneda Virtual

### 1.1 Identidad

- **Nombre:** Polvo Estelar (Stardust)
- **Icono:** ✦ + número (ej: ✦ 350)
- **Alcance:** Por usuario (no por cielo)
- **Modelo:** Híbrido — se gana gratis jugando o se compra con dinero real
- **Bienvenida:** 150 PE al crear cuenta

### 1.2 Mecánicas de Ganancia

| Acción | Recompensa | Cooldown / Cap | Anti-exploit |
|--------|:----------:|---------------|-------------|
| Login diario | 15 PE | 1× por día calendario UTC | Campo `lastDailyRewardDate` idempotente |
| Crear una estrella | 5 PE | Máx 10 estrellas/día = 50 PE/día | Contador `createdStarsToday` reseteado por fecha |
| Primera estrella en cielo nuevo | 25 PE bonus | 1× por cielo (lifetime) | Query estrellas del usuario en ese cielo (excl. soft-deleted). Si count === 0, bonus. |
| Racha de 7 días consecutivos | 50 PE bonus | Se resetea al romper racha | Requiere login real cada día |
| Racha de 30 días consecutivos | 350 PE bonus | Se resetea al romper racha | No retroactivo — días perdidos no acumulan |
| Invitación aceptada | 30 PE | Máx 5 aceptadas/día | No acepta propias (ya enforced), cap diario via `acceptedInvitesToday` + `lastInviteAcceptDate` |
| Bonus semanal (login ≥1×/semana) | 20 PE | 1× por semana ISO UTC | Campo `weeklyBonusWeek` |
| Creación de cuenta | 150 PE | Lifetime (una vez) | Se otorga en `userSync` |

> **Nota:** El daily reward, weekly bonus y actualización de streak se procesan atómicamente en la primera llamada a `GET /api/user/economy` de cada día UTC. No existe endpoint separado para reclamarlos — el procesamiento es automático e idempotente.

### 1.3 Proyección de Ganancia Mensual

| Tipo de Usuario | Patrón Diario | PE/Mes Estimado |
|----------------|--------------|:---------------:|
| Casual (3×/semana, 1 estrella) | 15 login + 5 estrella = 20/sesión, 3×/sem + weekly | ~320 |
| Regular (diario, 3 estrellas) | 15 + 15 = 30/día + rachas + weekly | ~1,530 |
| Activo (diario, 5+ estrellas, invitaciones) | 15 + 25 + rachas + invites + weekly | ~2,580 |

**Tiempo al primer tema (800 PE):**
- Casual: ~7 semanas
- Regular: ~13 días
- Activo: ~8 días

### 1.4 Compra con Dinero Real (Fase 3)

**Plataforma de pagos:** Wompi (Bancolombia, Colombia)
**Razón:** Cobertura local (Nequi, PSE, tarjetas), persona natural con cédula, comisión competitiva (~2.5% + IVA), payout en 2-3 días.

**Paquetes de Polvo Estelar (precios en COP):**

| Paquete | Polvo Estelar | COP | USD aprox | Bonus |
|---------|:------------:|:----:|:---------:|:-----:|
| Puñado de Polvo | 500 | $5,000 | ~$1.25 | — |
| Bolsa de Polvo | 1,375 | $12,000 | ~$3.00 | +10% |
| Frasco de Polvo | 3,000 | $25,000 | ~$6.25 | +20% |
| Cofre Constelación | 7,000 | $50,000 | ~$12.50 | +40% |
| Bóveda Galáctica | 18,000 | $99,000 | ~$24.75 | +80% |

> **Nota sobre microtransacciones:** Los paquetes tienen un mínimo de $5,000 COP para que la comisión fija de Wompi no consuma un porcentaje excesivo del pago. El usuario compra PE y los gasta como quiera en la tienda.

**Métodos de pago soportados:**
- Nequi (prioritario — público joven colombiano)
- PSE (transferencia bancaria directa)
- Tarjeta crédito/débito (Visa, Mastercard)
- Bancolombia a la mano

**Flujo de compra:**

1. Usuario selecciona paquete en la app (SPA)
2. `POST /api/payments/create` → Cloud Function crea transacción en Wompi API
3. Redirect a checkout de Wompi (o widget embebido)
4. Usuario paga con Nequi/PSE/tarjeta
5. Wompi envía webhook a `POST /api/payments/webhook`
6. Cloud Function valida firma del webhook + estado de la transacción
7. Si `APPROVED`: acredita PE en transacción Firestore atómica (balance + log)
8. Si `DECLINED`/`ERROR`: no acredita, logea el evento
9. Frontend detecta el cambio via refetch de economía

**Modelo de datos (nuevas colecciones):**

```typescript
// payments/{paymentId} — registro de cada intento de pago
interface PaymentRecord {
  userId: string
  packageId: string          // 'pack-500', 'pack-1500', etc.
  amount: number             // COP
  stardustAmount: number     // PE a acreditar
  wompiTransactionId: string // ID de Wompi
  status: 'pending' | 'approved' | 'declined' | 'error' | 'voided'
  paymentMethod: string      // 'NEQUI', 'PSE', 'CARD', etc.
  createdAt: IsoDateString
  resolvedAt: IsoDateString | null
}
```

**Seguridad:**

- El webhook de Wompi se valida con la firma HMAC (`events_secret`)
- El monto y paquete se validan server-side (no confiar en el cliente)
- Los PE se acreditan SOLO en el webhook handler, nunca desde el cliente
- Doble acreditación prevenida por estado del `PaymentRecord` (idempotente)

**Configuración requerida:**

- Cuenta Wompi (wompi.co) verificada con cédula
- Variables de entorno en Cloud Functions:
  - `WOMPI_PUBLIC_KEY` — llave pública para el widget/redirect
  - `WOMPI_PRIVATE_KEY` — llave privada para crear transacciones
  - `WOMPI_EVENTS_SECRET` — secreto para validar webhooks
  - `WOMPI_INTEGRITY_SECRET` — secreto para firma de integridad
- Webhook URL configurado en Wompi: `https://api-{project}.a.run.app/api/payments/webhook`

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
  starColorRange: StarColorRange         // Paleta de estrellas de fondo (temp-based procedural)
  userStarColor: string                  // Color de estrellas del usuario
  userStarHighlightColor: string         // Color de estrella resaltada
  nebulaBaseStartColor: string           // Gradiente base — color stop inicio
  nebulaBaseEndColor: string             // Gradiente base — color stop fin
  nebulaAccentColor: string              // Base del hue shift procedural (10 círculos radiales)
  nebulaOverlayColor: string             // Overlay de profundidad (4 círculos radiales)
  shootingStarHeadColor: string          // Cabeza/punta de la estrella fugaz
  shootingStarTailColor: string          // Cola/fade de la estrella fugaz
  glowColor: string                      // Shadow/glow de estrellas de fondo
  pointerGlowCenterColor: string         // Centro de la luz ambiente del cursor
  pointerGlowMidColor: string            // Anillo medio de la luz ambiente del cursor
  userStarGlowColor: string              // Halo de estrellas del usuario
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
| `buildNebulaTexture()` | Lee `nebulaBaseStartColor`, `nebulaBaseEndColor`, `nebulaAccentColor`, `nebulaOverlayColor` del tema |
| `renderEffects()` | Lee `shootingStarHeadColor`, `shootingStarTailColor`, `pointerGlowCenterColor`, `pointerGlowMidColor` del tema |
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
3. Handler valida en orden: (1) `skyId` existe → 404, (2) usuario es owner del cielo → 403, (3) `themeId` es `'classic'` O existe en `users/{uid}/inventory/{themeId}` → 403 "Tema no poseído", (4) `themeId` existe en catálogo estático → 400 "Tema inválido".
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

1. Usuario abre la tienda. **Puntos de acceso:** (1) SkiesPage — botón en header, (2) SkySettingsSheet — link "Ver más temas en la tienda" debajo del ThemePicker, (3) Compra inline de sky-slot desde SkiesPage (§8.4).
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

  // Economía
  stardust: number                     // Balance de Polvo Estelar (default: 100)
  maxSkies: number                     // Límite de cielos como owner (default: 2, ver migración)
  maxMemberships: number               // Límite de cielos como miembro editor/viewer (default: 20)
  lastDailyRewardDate: string | null   // Fecha ISO "YYYY-MM-DD" UTC
  loginStreak: number                  // Días consecutivos (default: 0)
  previousStreak: number               // Racha anterior antes de reset (para notificación, default: 0)
  createdStarsToday: number            // Reset diario (default: 0)
  lastStarCreationDate: string | null  // Fecha ISO "YYYY-MM-DD" para reset diario
  weeklyBonusWeek: string | null       // Semana ISO "YYYY-Www" del último bonus semanal
  acceptedInvitesToday: number         // Invitaciones aceptadas hoy (default: 0, max 5)
  lastInviteAcceptDate: string | null  // Fecha ISO "YYYY-MM-DD" para reset diario

}
```

Valores default para usuarios existentes (se inicializan en `userSync` al primer login post-deploy):
- `stardust: 100`, `maxSkies: max(2, count de cielos donde el usuario es owner)`, `maxMemberships: 20`, `lastDailyRewardDate: null`, `loginStreak: 0`, `previousStreak: 0`, `createdStarsToday: 0`, `lastStarCreationDate: null`, `weeklyBonusWeek: null`, `acceptedInvitesToday: 0`, `lastInviteAcceptDate: null`

> **Migración de `maxSkies`:** Para usuarios existentes que ya tengan más de 2 cielos como owner, `maxSkies` se inicializa como `max(2, count actual)`. Esto evita que pierdan acceso a cielos que ya crearon. Se calcula en `userSync` al primer login post-deploy.

**`skies/{skyId}` — campo nuevo:**

```typescript
interface SkyRecord {
  // ...campos existentes (title, description, ownerUserId, etc.)...

  themeId: string | null  // ID del tema aplicado. null = 'classic'
}
```

`themeId` es campo top-level, separado de `personalization` — son conceptos independientes.

**Migración de `SkyPersonalization.theme`:** El campo `personalization.theme` existente (`'classic' | 'romantic' | 'deep-night'`) se **elimina del tipo** en contracts. Esos 3 temas no tenían efecto visual en el engine — eran solo strings sin implementación. El nuevo `themeId` top-level es el único sistema de temas. `SkyPersonalization` queda solo con: `density`, `nebulaEnabled`, `twinkleEnabled`, `shootingStarsEnabled`.

> **Estrategia de migración:** Los documentos existentes en Firestore conservan `personalization.theme` como campo legacy. **No se ejecuta migración masiva** — el campo simplemente deja de leerse en el código. `themeId: null` en el sky record equivale a `classic`.

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
| GET | `/api/user/economy` | Requerida | Retorna balance, racha, inventario. **Procesa automáticamente** daily reward, weekly bonus y streak en la primera llamada del día (idempotente). |
| GET | `/api/user/transactions` | Requerida | Historial de transacciones paginado. Query params: `limit` (default 20), `cursor` (ID del último item para paginación). |
| GET | `/api/shop/catalog` | Requerida | Retorna items del catálogo con `owned: boolean` por item |
| POST | `/api/shop/purchase` | Requerida | Compra un item. Body: `{ itemId: string }`. Transaccional. |
| PATCH | `/api/skies/{skyId}/theme` | Owner | Aplica tema al cielo. Body: `{ themeId: string }`. Valida propiedad (§2.5). |

**Tipo de respuesta de `GET /api/user/economy`:**

```typescript
interface EconomyResponse {
  stardust: number
  loginStreak: number
  previousStreak: number               // Racha anterior (para detectar streak roto)
  lastDailyRewardDate: string | null
  weeklyBonusWeek: string | null
  inventory: InventoryItem[]
  rewards: {
    daily: number                      // 0 si ya reclamado hoy
    weekly: number                     // 0 si ya reclamado esta semana ISO
    streak: number                     // 0 si no aplica (no completó 7 ni 30)
    streakDays: number                 // Días consecutivos actualizados
  }
}
```

> **Nota:** Si `rewards.daily > 0`, el frontend muestra el Modal de Bienvenida Diaria (§8.6). Si `previousStreak > 3` y `rewards.streakDays === 1`, se muestra notificación de streak roto (§8.2).

### 5.2 Endpoints Existentes Modificados

| Endpoint | Cambio |
|----------|--------|
| `POST /api/skies/{skyId}/stars` | Agregar grant de 5 PE por crear estrella (con cap diario). Grant de 25 PE si es primera estrella en ese cielo. |
| `POST /api/skies` | Enforzar `maxSkies` — si el usuario ya tiene `count >= maxSkies` cielos como owner, retornar 403. |
| `POST /api/invites/:token/accept` | Enforzar `maxMemberships` — si el usuario ya es miembro activo de `count >= maxMemberships` cielos (excluyendo owner), retornar 403 "Límite de cielos alcanzado". Agregar grant de 30 PE (con cap diario). |
| `userSync` (login trigger) | Inicializar campos economy con defaults si no existen. Calcular `maxSkies` como `max(2, cielos owner actuales)` para usuarios existentes. |

---

## 6. Estructura de Archivos Nuevos

### 6.1 Frontend

```
frontend/src/
  domain/
    themes.ts               # Definiciones de ThemeParams por cada tema
    shopCatalog.ts           # Catálogo estático de items + precios
    economy.ts               # Constantes: caps, rewards, amounts
  hooks/
    useUserEconomy.ts        # Fetch y cache de balance + inventario
  pages/
    ShopPage.tsx             # Página de tienda
  components/
    shop/
      ShopItemCard.tsx       # Card de item con MagicCard (spotlight effect)
      ThemePreview.tsx       # Mini SkyCanvas 200×120px con tema en demo
      ThemeFullPreview.tsx   # Preview full-screen con estrellas reales del usuario
      PurchaseDialog.tsx     # Confirmación de compra + chequeo de balance (reutilizable)
    sky/
      ThemePicker.tsx        # Selector de tema en SkySettingsSheet (horizontal scroll + BorderBeam)
    economy/
      DailyRewardModal.tsx   # Modal de bienvenida diaria con rewards (§8.6)
      StreakIndicator.tsx     # 7 círculos + progreso racha 30 días (§8.2)
      TransactionHistory.tsx  # Bottom sheet con historial paginado (§8.7)
      StardustBalance.tsx    # Balance en header con NumberTicker de Magic UI
    ui/
      StardustToast.tsx      # Toast animado "✦ +N razón" para rewards contextuales
```

### 6.2 Backend (functions)

```
functions/src/
  handlers/
    economy.ts              # Handlers: getEconomy (incluye daily reward), getTransactions
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
| `frontend/src/domain/contracts.ts` | Agregar tipos: `ThemeParams`, `ThemeColors`, `StarColorRange`, `ShopItem`, `InventoryItem`, `TransactionRecord`. Extender `UserRecord` con campos economy. Eliminar `SkyTheme` y `personalization.theme`. |
| `functions/src/domain/contracts.ts` | Espejo de los tipos anteriores (incluyendo eliminación de `SkyTheme`) |
| `functions/src/handlers/skies.ts` | Enforzar `maxSkies` en `createSky`. Agregar handler para `PATCH theme`. |
| `functions/src/handlers/stars.ts` | Agregar grant de PE en `createStar` |
| `functions/src/handlers/userSync.ts` | Inicializar campos economy para usuarios nuevos y existentes |
| `functions/src/router.ts` | Registrar nuevas rutas (`/api/user/*`, `/api/shop/*`) |
| `functions/src/index.ts` | Exportar nuevos handlers si es necesario |
| `frontend/src/components/sky/SkySettingsSheet.tsx` | Eliminar selector de tema viejo. Agregar `ThemePicker` (horizontal scroll de cards con preview) |
| `frontend/src/components/sky/SkyCanvas.tsx` | Pasar `ThemeParams` resuelto al engine via `SkyConfig` |
| `frontend/src/pages/SkyPage.tsx` | Resolver `themeId → ThemeParams` y pasarlo al canvas |
| `firestore.rules` | Agregar reglas de read para `inventory` y `transactions` |
| `frontend/src/lib/api/client.ts` | Agregar funciones para los nuevos endpoints |
| `functions/src/handlers/invitePublic.ts` | Enforzar `maxMemberships` en accept. Agregar grant de 30 PE (con cap diario). |

---

## 8. UX de Economía

### 8.1 Feedback Visual al Ganar Polvo Estelar

Dos mecanismos de feedback según el contexto:

- **`DailyRewardModal`** (§8.6) — para rewards pasivos (login, streak, weekly). Modal celebratorio al abrir la app.
- **`StardustToast`** — para rewards en contexto de acción: "✦ +5 Estrella creada", "✦ +25 Primera estrella en este cielo", "✦ +30 Invitación aceptada".
  - Duración: 3 segundos con auto-dismiss
  - Color dorado para ganancias (`earn`), rojo sutil para gastos (`spend`)
  - Se apila si hay múltiples rewards simultáneos (max 3 visibles)
- **`StardustBalance`** — componente en header con `NumberTicker` de Magic UI. El número de PE sube/baja con animación suave al cambiar.
- **Trigger:** Toasts se disparan cuando el balance local cambia post-API call dentro de la sesión. No en reload.

### 8.2 Indicador de Racha (Streak)

Visualización del progreso de login consecutivo:

- **`StreakIndicator`** — componente visual con dos niveles:
  - **7 círculos** representando los últimos 7 días: lleno = login confirmado, vacío = pendiente, día actual = pulsante con animación
  - Al completar 7/7: mini `Confetti` de Magic UI + toast "✦ +50 ¡Racha de 7 días!"
  - **Barra circular de 30 días:** `AnimatedCircularProgressBar` de Magic UI debajo de los 7 círculos, mostrando progreso hacia racha de 30
  - Texto contextual: "3 días más para ✦ 50" o "22/30 → ✦ 200"
- **Ubicación:** SkiesPage (página principal) y dentro del DailyRewardModal
- **Estado vacío:** Si `loginStreak === 0`, mostrar "Empieza tu racha — vuelve mañana"
- **Streak roto:** Si `previousStreak > 3` y `loginStreak === 1` (se acaba de resetear), el DailyRewardModal incluye mensaje empático: "Tu racha de N días se reinició. ¡Empieza de nuevo hoy!" donde N = `previousStreak`

### 8.3 Preview de Temas

**En la tienda (ShopPage):**

- **`ShopItemCard`** — cada tema se presenta como `MagicCard` de Magic UI (spotlight cursor effect)
  - Mini-canvas de 200×120px con `SkyCanvas` en modo demo mostrando el tema
  - Nombre del tema + precio + badge "Poseído" si aplica
  - Transición `BlurFade` de Magic UI al entrar a la vista

**Al tocar un tema:**

- **`ThemeFullPreview`** — transición a pantalla completa:
  - Reutiliza `SkyCanvas` con los `ThemeParams` del tema seleccionado
  - Usa las **estrellas reales** del cielo activo del usuario (no estrellas random) — así ve cómo se verá SU cielo
  - Overlay con nombre del tema + botón flotante: `PulsatingButton` de Magic UI "Desbloquear ✦ 800" (solo si tiene balance suficiente)
  - Si ya lo posee: botón cambia a "Aplicar a mi cielo"
  - Gesto de swipe horizontal para navegar entre temas disponibles
  - Al completar compra: `Confetti` de Magic UI + toast de confirmación
- **Fallback:** Si el usuario no tiene cielo activo, usar estrellas demo generadas proceduralmente

### 8.4 Compra Inline de Sky Slots

Cuando el usuario alcanza `maxSkies`, flujo de compra directa sin salir de SkiesPage:

1. El botón "Crear cielo" muestra badge visual "Máx" cuando `count >= maxSkies`
2. Al tocar: **bottom sheet** explicando el límite + CTA "Desbloquear slot extra (✦ 500)"
3. Muestra balance actual y balance después de compra
4. Confirmar → `POST /api/shop/purchase` con `itemId: 'sky-slot'`
5. Al éxito: `maxSkies` se incrementa, bottom sheet se cierra, usuario puede crear inmediatamente

**Flujo total: 2 taps** — "Crear cielo" → "Desbloquear slot" → cielo creado.

Reutiliza `PurchaseDialog` para la confirmación de compra (mismo componente que la tienda).

### 8.5 Balance Insuficiente

Cuando el usuario intenta comprar algo sin PE suficiente:

- **Barra de progreso visual:** `AnimatedCircularProgressBar` de Magic UI mostrando "✦ 570 / ✦ 800"
- **Cuánto falta:** "Te faltan ✦ 230"
- **Breakdown de cómo ganar lo que falta:**
  - "Login diario: +10 PE/día → ~23 días"
  - "Crea estrellas: +5 PE c/u → ~46 estrellas"
  - "Racha de 7 días: +50 PE bonus"
- CTA principal: "Seguir explorando" que cierre el diálogo
- (Fase 3) CTA secundario: comprar PE con dinero real via Wompi

### 8.6 Modal de Bienvenida Diaria

Al abrir la app, el frontend llama `GET /api/user/economy`. Si la respuesta incluye `rewards.daily > 0`, se muestra un modal celebratorio:

- **`DailyRewardModal`** — mini-modal centrado con overlay semitransparente:
  - Encabezado con `SparklesText` de Magic UI: "✦ Polvo Estelar"
  - `NumberTicker` de Magic UI animando el balance actualizado
  - Lista de rewards otorgados:
    - "✦ +10 Login diario"
    - "✦ +20 Bonus semanal" (si `rewards.weekly > 0`)
    - "✦ +50 ¡Racha de 7 días!" (si `rewards.streak > 0`)
  - `StreakIndicator` mostrando estado actual de la racha
  - **Streak roto:** Si `previousStreak > 3` y `rewards.streakDays === 1`, agregar mensaje empático: "Tu racha de {previousStreak} días se reinició. ¡Empieza de nuevo hoy!"
  - Botón "Genial" para cerrar (con `ShimmerButton`)
- **NO aparece** en reload si ya se reclamó (el endpoint es idempotente — `rewards.daily === 0` en llamadas subsiguientes del mismo día)
- **Animación:** `BlurFade` de Magic UI para entrada suave

> **Nota:** El `StardustToast` (§8.1) sigue existiendo para rewards en contexto de acción (crear estrella, comprar tema, invitación aceptada). El modal es solo para rewards pasivos del daily.

### 8.7 Historial de Transacciones

Vista del historial de PE accesible al usuario:

- **Acceso:** Tocar el balance de PE en el header (`StardustBalance`)
- **Formato:** Bottom sheet con lista scrolleable
- **Cada entrada:** Icono (✦ dorado para `earn`, rojo para `spend`) + razón localizada + monto con signo + fecha relativa ("hace 2h", "ayer")
- **Paginación:** Últimas 20 transacciones al abrir, scroll infinito carga más via `GET /api/user/transactions?cursor=`
- **Animación:** `AnimatedList` de Magic UI para entrada staggered de cada item
- **Empty state:** "Aún no tienes movimientos. ¡Crea una estrella para empezar!"
- **Razones legibles:**
  - `daily_login` → "Login diario"
  - `star_creation` → "Estrella creada"
  - `first_star_bonus` → "Primera estrella en cielo"
  - `streak_7` → "Racha de 7 días"
  - `streak_30` → "Racha de 30 días"
  - `invite_accepted` → "Invitación aceptada"
  - `weekly_bonus` → "Bonus semanal"
  - `welcome` → "Bienvenida"
  - `shop_purchase` → "Compra: {itemName}"

### 8.8 Onboarding de Polvo Estelar

Para nuevos usuarios que reciben sus 100 PE iniciales:

- **Trigger:** Primera sesión del usuario (detectable porque `lastDailyRewardDate` era `null` antes del economy call)
- **Formato:** Tooltip contextual sobre el balance en el header: "Tienes ✦ 100 de Polvo Estelar. Personaliza tus cielos en la tienda."
- **Flecha:** Apunta al acceso de la tienda en SkiesPage
- **Una sola vez:** Se trackea via `localStorage` (`onboarding_stardust_seen: true`). No se almacena en Firestore — es UI-only.
- **Dismiss:** Al tocar fuera del tooltip o después de 8 segundos

### 8.9 Componentes de Animación Premium (Magic UI)

Componentes de Magic UI utilizados para elevar la calidad visual de la experiencia de economía:

| Componente | Uso | Sección |
|-----------|-----|---------|
| `NumberTicker` | Balance de PE en header — cuenta arriba/abajo suavemente | §8.1 |
| `SparklesText` | Label "✦ Polvo Estelar" en modal de bienvenida y header de tienda | §8.6 |
| `Confetti` | Al completar compra exitosa y al completar racha 7/30 días | §8.2, §8.3 |
| `PulsatingButton` | CTA "Desbloquear" cuando el usuario tiene balance suficiente | §8.3 |
| `MagicCard` | Cards de temas en ShopPage (spotlight cursor effect) | §8.3 |
| `BorderBeam` | Indicador visual del tema actualmente activo en ThemePicker | §2.5 |
| `AnimatedCircularProgressBar` | Progreso hacia racha de 30 días y balance insuficiente | §8.2, §8.5 |
| `AnimatedList` | Historial de transacciones — entrada staggered de items | §8.7 |
| `BlurFade` | Transiciones de entrada en ShopPage, modales y cards | §8.3, §8.6 |
| `ShimmerButton` | CTAs premium (ya existe en el proyecto) | §8.6 |

> **Dependencia:** Magic UI ya está como dependencia del proyecto. Todos estos componentes se importan directamente.

---

## 9. Plan de Implementación por Fases

### Fase 1: Economía Base (MVP)

1. Extender `UserRecord` con campos economy en `contracts.ts` (frontend + functions). Eliminar `SkyTheme` y `personalization.theme` del tipo.
2. Crear subcollecciones `inventory` y `transactions`
3. Implementar `GET /api/user/economy` con procesamiento automático de daily reward, weekly bonus y streak (idempotente)
4. Implementar `GET /api/user/transactions` (paginado)
5. Agregar grant de PE en handler `createStar` existente (incluye first star bonus via query)
6. Agregar grant de PE en invitación aceptada (con cap diario via `acceptedInvitesToday`)
7. Enforzar `maxSkies` en handler `createSky`
8. Enforzar `maxMemberships` en handler de aceptar invitación
9. Hook `useUserEconomy` en frontend
10. `StardustBalance` — balance de PE en header con `NumberTicker` de Magic UI (§8.1)
11. `DailyRewardModal` — modal de bienvenida diaria con rewards (§8.6)
12. `StardustToast` — feedback visual para rewards contextuales (§8.1)
13. `StreakIndicator` — 7 círculos + progreso 30 días en SkiesPage (§8.2)
14. `TransactionHistory` — historial de PE accesible desde el balance (§8.7)
15. Onboarding de PE para nuevos usuarios (§8.8)
16. Migración: inicializar valores economy en `userSync` con grandfather de `maxSkies`
17. Compra de slots extra de cielos (`sky-slot` en shop) — incluye compra inline desde SkiesPage (§8.4)

### Fase 2: Engine de Temas + Tienda

1. Agregar `ThemeParams` a `SkyConfig` del SkyEngine, parametrizar todos los colores hardcodeados (mini-RFC aprobado en §2.2)
2. Crear `themes.ts` con los 7 temas de paleta de color (ThemeColors expandido §2.1)
3. Crear `shopCatalog.ts` con todos los items comprables
4. Implementar `POST /api/shop/purchase` (transaccional)
5. Implementar `GET /api/shop/catalog`
6. Implementar `PATCH /api/skies/{skyId}/theme` con validación completa (§2.5)
7. Construir `ShopPage` con `MagicCard`, `BlurFade` y mini-canvas previews (§8.3)
8. `ThemeFullPreview` — preview full-screen con estrellas reales + `Confetti` al comprar (§8.3)
9. `ThemePicker` en `SkySettingsSheet` (horizontal scroll + `BorderBeam` en tema activo)
10. UX de balance insuficiente con progreso visual y sugerencias (§8.5)
11. Wiring de resolución de tema en `SkyPage`
12. Actualizar `firestore.rules` para `inventory`/`transactions`
13. Acceso a tienda desde SkySettingsSheet ("Ver más temas en la tienda")

### Fase 3: Dinero Real + Temas Avanzados

| # | Tarea | Notas |
|---|-------|-------|
| 1 | Integrar Wompi (Bancolombia) | Requiere cuenta Wompi verificada |
| 2 | `POST /api/payments/create` + webhook handler | Nuevo endpoint con validación HMAC |
| 3 | Temas de efectos especiales (meteor shower, fireflies, constellation lines) | Extensión del engine — mini-RFC cada uno |
| 4 | Temas de forma de estrella (hearts, crystals, flowers) | Refactor significativo del engine |

### Fase 4: Ideas Futuras

- Temas estacionales de tiempo limitado (navidad, san valentín, halloween)
- Paletas custom creadas por el usuario (avanzado — define tus propios colores RGB)
- Badges de logros que otorgan PE
- Votación colaborativa de tema entre miembros de un cielo
- Sistema de regalos (enviar PE o items a otros usuarios)
- Música/sonido ambiente atado al tema

---

## 10. Verificación

### Economía
- Crear cuenta → verificar 100 PE iniciales
- Hacer login (primer economy call del día) → verificar +10 PE via DailyRewardModal
- Crear estrella → verificar +5 PE via StardustToast
- Crear 11 estrellas en un día → verificar que la 11ª no da PE (cap)
- Completar racha 7 días → verificar +50 PE bonus + Confetti
- Verificar que el bonus semanal se otorga al primer economy call de la semana ISO
- Aceptar 6 invitaciones en un día → verificar que la 6ª no da PE (cap de 5)
- Verificar que `GET /api/user/economy` es idempotente (2ª llamada del mismo día no duplica rewards)

### Tienda
- Abrir shop → ver items con precios y estado owned/locked
- Comprar tema con PE suficiente → verificar débito → verificar aparece en inventario → Confetti
- Intentar comprar con PE insuficiente → mostrar progreso visual "✦ 570 / ✦ 800" con sugerencias
- Intentar comprar item ya poseído → error apropiado
- Comprar sky-slot → verificar que `maxSkies` incrementó

### Temas
- Comprar tema → ir a SkySettings → ver tema en ThemePicker con BorderBeam → seleccionar → verificar que el canvas cambia colores
- Verificar que miembros (editor/viewer) ven el tema del owner
- Aplicar tema a cielo → verificar persistencia tras reload
- Tema `classic` siempre disponible sin compra
- Preview full-screen muestra estrellas reales del cielo del usuario
- Swipe horizontal navega entre temas en el preview

### Límite de Cielos y Membresía
- Tener 2 cielos → intentar crear 3° → mostrar badge "Máx" + bottom sheet de compra inline
- Comprar slot extra desde bottom sheet (2 taps) → crear cielo inmediatamente
- Verificar que el conteo de cielos solo cuenta cielos donde el usuario es owner
- Usuarios existentes con >2 cielos → verificar que maxSkies se inicializa con grandfather
- Intentar aceptar invitación con 20 membresías activas → verificar 403 "Límite alcanzado"

### UX de Economía
- DailyRewardModal aparece solo 1× al día, no en reload/refresh
- DailyRewardModal muestra todos los rewards (daily + weekly + streak) en una sola vista
- Streak roto (era >3, ahora 1) → mensaje empático en el modal
- StardustToast funciona para rewards contextuales (crear estrella, comprar tema)
- `StardustBalance` en header anima con NumberTicker al cambiar
- `StreakIndicator` muestra 7 círculos + progreso correcto
- Streak en 0 → mostrar "Empieza tu racha"
- Balance insuficiente → progreso visual + breakdown de cómo ganar
- Historial de transacciones accesible al tocar balance → paginación funciona
- Onboarding tooltip aparece solo 1× para nuevos usuarios
- Tienda accesible desde SkiesPage y SkySettingsSheet
- Componentes Magic UI renderizan correctamente (NumberTicker, Confetti, MagicCard, etc.)
