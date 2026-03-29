# SPEC v2 — Sistema de Economia y Temas (Referencia Lean)

Referencia lean del sistema de moneda virtual, temas y pagos. Para modelo base ver `SPEC.md`. Para video clips ver `SPEC_v3.md`.

---

## 1. Polvo Estelar — Moneda Virtual

### 1.1 Identidad

- **Nombre:** Polvo Estelar (PE)
- **Icono:** ✦ + numero (ej: ✦ 350)
- **Alcance:** Por usuario, no por cielo
- **Bienvenida:** 150 PE al crear cuenta

### 1.2 Mecanicas de Ganancia

| Accion | Recompensa | Cap |
|--------|:----------:|-----|
| Login diario | 15 PE | 1x/dia UTC |
| Crear estrella | 5 PE | Max 10 estrellas/dia |
| Primera estrella en cielo nuevo | 25 PE bonus | 1x por cielo (lifetime) |
| Racha 7 dias | 50 PE | Se resetea al romper |
| Racha 30 dias | 350 PE | Se resetea al romper |
| Invitacion aceptada | 30 PE | Max 5/dia |
| Bonus semanal (login >=1x/semana) | 20 PE | 1x/semana ISO UTC |
| Creacion de cuenta | 150 PE | Lifetime |

Daily reward, weekly bonus y streak se procesan automaticamente en `GET /api/user/economy` (idempotente).

### 1.3 Anti-Exploit

- Todo grant server-side via Cloud Functions. Nunca desde el cliente.
- Caps diarios en `UserRecord` con reset por fecha UTC.
- Login idempotente via `lastDailyRewardDate`.
- Maximo teorico diario: ~217 PE.

### 1.4 Compra con Dinero Real

**Plataforma:** Wompi (Bancolombia, Colombia). Metodos: Nequi, PSE, tarjetas, Bancolombia a la mano.

| Paquete | PE | COP | Bonus |
|---------|:--:|:---:|:-----:|
| Punado de Polvo | 500 | $5,000 | — |
| Bolsa de Polvo | 1,375 | $12,000 | +10% |
| Frasco de Polvo | 3,000 | $25,000 | +20% |
| Cofre Constelacion | 7,000 | $50,000 | +40% |
| Boveda Galactica | 18,000 | $99,000 | +80% |

**Flujo:** Frontend selecciona paquete → `POST /api/payments/create` → Wompi checkout → webhook `POST /api/payments/webhook` → acredita PE atomicamente si `APPROVED`.

**Seguridad:** Firma HMAC del webhook, validacion server-side de monto/paquete, PE solo desde webhook handler, doble acreditacion prevenida por estado de `PaymentRecord`.

---

## 2. Sistema de Temas

### 2.1 Arquitectura

El SkyEngine recibe `ThemeParams` (colores parametrizados). La resolucion `themeId → ThemeParams` es client-side via lookup estatico en `themes.ts`.

```typescript
type ThemeColors = {
  starColorRange: { rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number }
  userStarColor: string
  userStarHighlightColor: string
  nebulaBaseStartColor: string
  nebulaBaseEndColor: string
  nebulaAccentColor: string
  nebulaOverlayColor: string
  shootingStarHeadColor: string
  shootingStarTailColor: string
  glowColor: string
  pointerGlowCenterColor: string
  pointerGlowMidColor: string
  userStarGlowColor: string
}

type ThemeParams = { colors: ThemeColors }
```

### 2.2 Catalogo de Temas

**Paleta de Color:**

| ID | Nombre | Precio |
|----|--------|:------:|
| `classic` | Clasico | Gratis |
| `aurora-borealis` | Aurora Boreal | 800 PE |
| `sunset-horizon` | Horizonte Atardecer | 800 PE |
| `purple-cosmos` | Cosmos Purpura | 800 PE |
| `rose-garden` | Jardin de Rosas | 600 PE |
| `ocean-depths` | Profundidades del Oceano | 800 PE |
| `golden-night` | Noche Dorada | 800 PE |
| `frost-crystal` | Cristal de Hielo | 600 PE |

**Efectos Especiales:**

| ID | Nombre | Precio |
|----|--------|:------:|
| `meteor-shower` | Lluvia de Meteoros | 1,200 PE |
| `fireflies` | Luciernagas | 1,500 PE |
| `constellation-lines` | Constelaciones | 1,500 PE |

### 2.3 Propiedad

- Temas pertenecen al **usuario**, no al cielo.
- Owner aplica un tema que posee a cualquier cielo donde sea owner.
- `skies/{skyId}.themeId: string | null` (null = `classic`).
- Todos los miembros ven el tema del owner.

---

## 3. Tienda

### 3.1 Items

| Item | Categoria | Precio PE |
|------|-----------|:---------:|
| 8 temas de paleta | `theme` | 600-800 |
| 3 temas de efecto | `theme` | 1,200-1,500 |
| Slot extra de cielo (+1) | `sky-slot` | 500 |

### 3.2 Flujo de Compra

`POST /api/shop/purchase` con `{ itemId }` → transaccion atomica Firestore: debita PE + agrega a inventario + log. Para `sky-slot`: incrementa `maxSkies`.

---

## 4. Modelo de Datos

### 4.1 `users/{uid}` — campos de economia

```typescript
interface UserRecord {
  // ...campos base (SPEC.md)...
  stardust: number
  maxSkies: number                    // default: 2
  maxMemberships: number              // default: 20
  lastDailyRewardDate: string | null
  loginStreak: number
  previousStreak: number
  createdStarsToday: number
  lastStarCreationDate: string | null
  weeklyBonusWeek: string | null
  acceptedInvitesToday: number
  lastInviteAcceptDate: string | null
  videoProcessedToday: number         // SPEC_v3
  lastVideoProcessDate: string | null // SPEC_v3
}
```

### 4.2 `users/{uid}/inventory/{itemId}`

```typescript
interface InventoryItem {
  itemId: string
  category: 'theme' | 'sky-slot'
  purchasedAt: IsoDateString
  source: 'shop' | 'gift' | 'promo'
}
```

### 4.3 `users/{uid}/transactions/{txId}`

```typescript
interface TransactionRecord {
  type: 'earn' | 'spend'
  amount: number
  reason: string       // daily_login | star_creation | first_star_bonus | streak_7 | streak_30
                       // invite_accepted | weekly_bonus | welcome | shop_purchase
  itemId: string | null
  balanceAfter: number
  createdAt: IsoDateString
  details?: Array<{ amount: number; reason: string }>
}
```

### 4.4 `payments/{paymentId}`

```typescript
type PaymentStatus = 'pending' | 'approved' | 'declined' | 'error' | 'voided'

interface PaymentRecord {
  userId: string
  packageId: string
  amountInCents: number
  currency: 'COP'
  stardustAmount: number
  wompiTransactionId: string | null
  wompiReference: string
  status: PaymentStatus
  paymentMethod: string | null
  createdAt: IsoDateString
  resolvedAt: IsoDateString | null
}
```

### 4.5 `skies/{skyId}` — campo de tema

```typescript
themeId: string | null  // null = 'classic'
```

### 4.6 Reglas Firestore

```
inventory, transactions: read propio, write solo Admin SDK.
```

---

## 5. API Endpoints

### 5.1 Economia

| Metodo | Ruta | Auth | Descripcion |
|--------|------|:----:|-------------|
| GET | `/api/user/economy` | Si | Balance + racha + inventario. Procesa daily/weekly/streak automaticamente. |
| GET | `/api/user/transactions` | Si | Historial paginado. Query: `limit`, `cursor`. |

### 5.2 Tienda

| Metodo | Ruta | Auth | Descripcion |
|--------|------|:----:|-------------|
| GET | `/api/shop/catalog` | Si | Items con `owned: boolean` |
| POST | `/api/shop/purchase` | Si | Compra atomica. Body: `{ itemId }` |

### 5.3 Pagos (Wompi)

| Metodo | Ruta | Auth | Descripcion |
|--------|------|:----:|-------------|
| POST | `/api/payments/create` | Si | Crea transaccion Wompi |
| POST | `/api/payments/webhook` | Publica | Webhook Wompi (firma HMAC) |
| GET | `/api/payments/:reference/status` | Si | Estado del pago |

### 5.4 Temas

| Metodo | Ruta | Auth | Descripcion |
|--------|------|:----:|-------------|
| PATCH | `/api/skies/{skyId}/theme` | Owner | Aplica tema. Body: `{ themeId }`. Valida propiedad. |

### 5.5 Endpoints Modificados (vs SPEC.md)

| Endpoint | Cambio |
|----------|--------|
| `POST /api/skies/{skyId}/stars` | +5 PE por estrella (+25 PE primera en cielo) |
| `POST /api/skies` | Enforzar `maxSkies` |
| `POST /api/invites/:token/accept` | Enforzar `maxMemberships` + 30 PE |

---

## 6. Estructura de Archivos

### Backend

```
functions/src/
  handlers/economy.ts          # getEconomy, getTransactions
  handlers/shop.ts             # getCatalog, purchase
  handlers/payments.ts         # createPayment, wompiWebhook, getPaymentStatus
  domain/economyRules.ts       # Constantes: caps, rewards
  domain/stardustPackages.ts   # Paquetes Wompi
  domain/shopCatalog.ts        # Catalogo server-side
```

### Frontend

```
frontend/src/
  domain/themes.ts             # ThemeParams por tema
  domain/shopCatalog.ts        # Catalogo estatico
  domain/economy.ts            # Constantes mirrors
  hooks/useUserEconomy.ts      # Balance + inventario
  pages/ShopPage.tsx           # Tienda
  components/economy/          # StardustBalance, DailyRewardModal, StreakIndicator,
                               # TransactionHistory, StardustToast, PurchaseDialog,
                               # StardustOnboarding
  components/shop/             # ThemePreviewCard, PackageCard, BuyStardustSheet
  components/sky/ThemePicker.tsx
```

---

## 7. Configuracion Wompi

Variables de entorno en Cloud Functions:
- `WOMPI_PUBLIC_KEY` — llave publica
- `WOMPI_PRIVATE_KEY` — llave privada
- `WOMPI_EVENTS_SECRET` — secreto webhooks
- `WOMPI_INTEGRITY_SECRET` — firma de integridad

Webhook URL: `https://api-{project}.a.run.app/api/payments/webhook`
