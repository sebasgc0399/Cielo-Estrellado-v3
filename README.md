# Cielo Estrellado

![Versión](https://img.shields.io/badge/versión-5.0.0-blueviolet)
![Node](https://img.shields.io/badge/node-22-339933)
![React](https://img.shields.io/badge/react-19-61DAFB)
![TypeScript](https://img.shields.io/badge/typescript-strict-3178C6)
![Firebase](https://img.shields.io/badge/firebase-12-FFCA28)
![Vite](https://img.shields.io/badge/vite-6-646CFF)
![Tailwind](https://img.shields.io/badge/tailwind-4-06B6D4)

Una aplicación web donde los recuerdos se convierten en estrellas.

---

## Qué es Cielo Estrellado

Cielo Estrellado es una SPA inmersiva donde los usuarios crean **cielos personalizados** llenos de estrellas. Cada estrella guarda un recuerdo: título, mensaje, imagen o video clip (1–6 segundos), y un año. Los cielos se comparten con otros usuarios mediante invitaciones por link, con roles diferenciados (owner / editor / viewer).

La experiencia visual es el centro: un canvas animado con paralaje, nebulosas, estrellas titilantes y estrellas fugaces, personalizable con **14 temas visuales** — desde Aurora Boreal hasta Corazones Celestiales.

Los usuarios acumulan **Polvo Estelar** (✦) realizando acciones cotidianas — logins diarios, rachas, crear estrellas, aceptar invitaciones — y con ese balance desbloquean temas premium en la tienda integrada. También pueden comprar Polvo Estelar con dinero real (COP) a través de **Wompi**.

---

## Tech Stack

| Capa | Tecnología | Versión |
|------|-----------|---------|
| **Framework** | React | 19.2 |
| **Build** | Vite | 6.4 |
| **Lenguaje** | TypeScript (strict) | 5.9 |
| **Estilos** | Tailwind CSS | 4.2 |
| **Componentes UI** | shadcn/ui, Magic UI | — |
| **Animaciones** | Motion (Framer Motion) | 12.38 |
| **Routing** | React Router | 7.13 |
| **Iconos** | Lucide React | 0.577 |
| **Toasts** | Sonner | 2.0 |
| **Firebase (cliente)** | Firebase SDK | 12.11 |
| **Backend** | Cloud Functions v2 gen2 | 7.2 |
| **Firebase (admin)** | Firebase Admin SDK | 13.7 |
| **Video processing** | FFmpeg (@ffmpeg-installer) | 1.1 |
| **Pagos** | Wompi (Bancolombia) | — |
| **Tests** | Vitest + Testing Library | 4.1 |
| **PWA** | vite-plugin-pwa | 1.2 |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        Navegador (SPA)                          │
│                                                                 │
│  pages/ ──► components/ ──► engine/SkyEngine.ts (Canvas 5 capas)│
│    │            │                                               │
│    └──► hooks/ ──► lib/api ──────────────────┐                  │
│                    lib/firebase ──┐           │                  │
│                                  │           │                  │
│                          onSnapshot (reads)  │ POST/PATCH/DELETE│
└──────────────────────────────────┼───────────┼──────────────────┘
                                   │           │
                                   ▼           ▼
                            ┌─────────┐  ┌───────────┐
                            │Firestore│  │ Cloud Fn   │
                            │         │  │ (API)      │
                            │ users/  │◄─┤ handlers/  │
                            │ skies/  │  │ middleware/ │
                            │ invites/│  │ domain/    │
                            │payments/│  └─────┬──────┘
                            └─────────┘        │
                                               ▼
                                        ┌─────────────┐
                                        │Cloud Storage │
                                        │              │
                                        │ stars/       │──► onObjectFinalized
                                        │ temp/        │         │
                                        └──────────────┘         ▼
                                                          ┌──────────────┐
                                                          │processVideo  │
                                                          │Clip (FFmpeg) │
                                                          │ trim+compress│
                                                          │ thumbnail    │
                                                          └──────────────┘
```

**Principio clave:** Los reads van directo desde el cliente via `onSnapshot` — la UI es reactiva en tiempo real. Los writes siempre pasan por Cloud Functions para garantizar seguridad, consistencia y atomicidad.

---

## Features principales

### Estrellas con media

- Título, mensaje, año del recuerdo
- Imagen (JPEG/PNG/WebP, hasta 5 MB)
- Video clip (1–6 segundos): el usuario recorta con VideoTrimmer en el cliente, sube el raw a Storage, y una Cloud Function lo procesa con FFmpeg (trim, compress a 720p, thumbnail)
- Posición personalizada en el canvas (coordenadas normalizadas 0–1)

### Cielos compartidos

- Cada usuario puede crear hasta 2 cielos (ampliable comprando sky-slots)
- Personalización: densidad de estrellas, nebulosa, twinkle, estrellas fugaces
- 14 temas visuales con colores y efectos únicos (luciérnagas, meteoros, constelaciones, formas de estrella)

### Sistema de invitaciones

- Invitaciones por link con token SHA-256 (válidas 7 días, TTL en Firestore)
- Roles: editor (CRUD de sus estrellas) o viewer (solo lectura)
- Preview público sin login, aceptación requiere cuenta
- Rate limits: máx 10 invitaciones pendientes por cielo, máx 50 miembros por cielo

### Economía — Polvo Estelar (✦)

| Acción | Recompensa |
|--------|:----------:|
| Bienvenida (registro) | +150 ✦ |
| Login diario | +15 ✦ |
| Bonus semanal | +20 ✦ |
| Crear estrella | +5 ✦ (máx 10/día) |
| Primera estrella | +25 ✦ |
| Invitación aceptada | +30 ✦ (máx 5/día) |
| Racha 7 días | +50 ✦ |
| Racha 30 días | +350 ✦ |

### Tienda de temas

14 temas disponibles (1 clásico gratuito + 13 premium, de 600 a 1500 ✦). Algunos incluyen efectos especiales: lluvia de meteoros, luciérnagas, líneas de constelación, estrellas con forma de flor/cristal/corazón.

Compras con transacciones Firestore atómicas (débito + inventario + audit log).

### Pagos con Wompi

Compra de paquetes de Polvo Estelar con dinero real (COP) via Nequi, PSE o tarjeta:

| Paquete | Polvo Estelar | Precio COP |
|---------|:-------------:|:----------:|
| pack-500 | 500 ✦ | $5.000 |
| pack-1500 | 1.375 ✦ | $12.000 |
| pack-3500 | 3.000 ✦ | $25.000 |
| pack-8000 | 7.000 ✦ | $50.000 |
| pack-20000 | 18.000 ✦ | $99.000 |

Flujo seguro: Cloud Function crea transacción → Wompi procesa → webhook valida firma SHA-256 → acredita PE atómicamente. Nunca se acredita desde el cliente.

---

## Estructura del proyecto

```
cielo-estrellado-v3/
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── sky/            # SkyCanvas, StarFormSheet, StarOverlay, VideoTrimmer, FloatingToolbar
│       │   ├── economy/        # StardustBalance, DailyRewardModal, StreakIndicator, TransactionHistory
│       │   ├── shop/           # BuyStardustSheet, ThemePreviewCard, PackageCard
│       │   └── ui/             # shadcn/ui + componentes custom (BottomSheet, BlurFade, ShimmerButton)
│       ├── domain/             # Contratos, temas, catálogo, policies (compartido con backend)
│       ├── engine/             # SkyEngine.ts — renderizado canvas puro (5 capas, paralaje, efectos)
│       ├── hooks/              # useSkyData, useSkyStars, useUserEconomy
│       ├── lib/
│       │   ├── api/            # Cliente API con auto-refresh de token
│       │   ├── auth/           # AuthContext, Google + email/password
│       │   └── firebase/       # Config, storage (upload imagen/video)
│       ├── pages/              # LoginPage, SkiesPage, SkyPage, ShopPage, ProfilePage, InvitePage
│       └── styles/             # globals.css (design tokens, animaciones custom)
│
├── functions/
│   └── src/
│       ├── handlers/           # HTTP handlers + Cloud Function triggers
│       │   ├── stars.ts, skies.ts, members.ts, invites.ts, invitePublic.ts
│       │   ├── economy.ts, shop.ts, payments.ts, userSync.ts
│       │   ├── processVideoClip.ts   # Storage trigger — FFmpeg trim+compress
│       │   └── cleanupZombieStars.ts # Scheduled — limpia videos stuck cada 15 min
│       ├── middleware/         # authenticateRequest (checkRevoked), CORS
│       ├── domain/             # contracts, economyRules, policies, shopCatalog, stardustPackages, defaults
│       ├── lib/                # firebaseAdmin, getSkyWithAccess, invite utils, ffmpeg wrapper
│       └── router.ts           # Router HTTP simple con path params
│
├── firestore.rules             # Reads limitados, writes bloqueados (solo Admin SDK)
├── storage.rules               # Permisos por tipo de contenido, size/type validation
├── firestore.indexes.json      # 7 índices compuestos
├── firebase.json               # Hosting config, rewrites /api → Cloud Function
└── audits/                     # Auditorías de seguridad detalladas
```

---

## Setup local

### Prerequisites

- **Node.js** v22+
- **Firebase CLI**: `npm install -g firebase-tools`
- Cuenta de Firebase con proyecto creado

### Instalación

```bash
# Clonar
git clone <url-del-repo>
cd cielo-estrellado-v3

# Instalar dependencias
cd frontend && npm install && cd ..
cd functions && npm install && cd ..

# Autenticarse con Firebase
firebase login
firebase use masmelito-f209c  # o tu proyecto

# Configurar variables de entorno del frontend
cp frontend/.env.example frontend/.env.local
# Editar con los datos de Firebase Console → Configuración → SDK
```

### Variables de entorno

**Frontend** (`frontend/.env.local`):

```env
VITE_FIREBASE_API_KEY=tu-api-key
VITE_FIREBASE_AUTH_DOMAIN=tu-proyecto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=tu-proyecto-id
VITE_FIREBASE_STORAGE_BUCKET=tu-proyecto.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=tu-sender-id
VITE_FIREBASE_APP_ID=tu-app-id
```

**Backend** (`functions/.env`):

```env
APP_URL=https://tu-app.web.app
WOMPI_PUBLIC_KEY=pub_...
WOMPI_PRIVATE_KEY=prv_...
WOMPI_EVENTS_SECRET=...
WOMPI_INTEGRITY_SECRET=...
WOMPI_API_URL=https://api-sandbox.co.uat.wompi.dev/v1
```

---

## Scripts disponibles

### Frontend

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Dev server (proxy /api → producción) |
| `npm run build` | Build de producción (tsc + vite build) |
| `npm run test` | Tests en modo watch |
| `npm run test:run` | Tests single run (CI) |
| `npm run test:coverage` | Tests con reporte de cobertura |

### Backend (functions)

| Comando | Descripción |
|---------|-------------|
| `npm run build` | Compilar TypeScript |
| `npm run serve` | Emuladores Firebase |
| `npm run test` | Tests en modo watch |
| `npm run test:run` | Tests single run (CI) |
| `npm run test:coverage` | Tests con reporte de cobertura |

---

## API endpoints

Todos los endpoints están bajo `/api`. Auth = token Firebase en header `Authorization: Bearer <token>`.

### User

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| POST | `/userSync` | Sincroniza usuario Firebase con Firestore (welcome bonus en primer login) | Si |

### Economy

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| GET | `/user/economy` | Obtiene balance, racha, rewards diarios (side-effect: calcula y otorga rewards) | Si |
| GET | `/user/transactions` | Historial de transacciones (paginado con cursor) | Si |

### Shop

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| GET | `/shop/catalog` | Catálogo completo con flag `owned` por item | Si |
| POST | `/shop/purchase` | Compra item con stardust (transacción atómica) | Si |

### Payments (Wompi)

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| POST | `/payments/create` | Inicia pago en Wompi, retorna signature para checkout | Si |
| POST | `/payments/webhook` | Webhook de Wompi (valida firma SHA-256, acredita PE) | No |
| GET | `/payments/:reference/status` | Estado de un pago | Si |

### Skies

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| GET | `/skies` | Lista cielos del usuario (como owner, editor o viewer) | Si |
| POST | `/skies` | Crea nuevo cielo | Si |
| GET | `/skies/:skyId` | Obtiene cielo + rol del usuario | Si |
| PATCH | `/skies/:skyId` | Actualiza título o personalización (owner) | Si |
| DELETE | `/skies/:skyId` | Elimina cielo + miembros + estrellas + media (owner) | Si |
| PATCH | `/skies/:skyId/theme` | Cambia tema visual del cielo (owner, requiere item en inventario) | Si |

### Stars

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| POST | `/skies/:skyId/stars` | Crea estrella (owner/editor, otorga rewards) | Si |
| PATCH | `/skies/:skyId/stars/:starId` | Actualiza estrella (owner o editor+autor) | Si |
| DELETE | `/skies/:skyId/stars/:starId` | Soft-delete estrella + limpia media de Storage | Si |

### Members

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| GET | `/skies/:skyId/members` | Lista miembros activos (owner) | Si |
| PATCH | `/skies/:skyId/members/:userId` | Cambia rol o revoca miembro (owner) | Si |
| POST | `/skies/:skyId/members/leave` | Abandonar cielo (no owner) | Si |

### Invites

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|:----:|
| POST | `/skies/:skyId/invites` | Crea invitación con token (owner, máx 10 pendientes) | Si |
| GET | `/skies/:skyId/invites` | Lista invitaciones pendientes (owner) | Si |
| DELETE | `/skies/:skyId/invites/:inviteId` | Revoca invitación (owner) | Si |
| GET | `/invites/:token/preview` | Preview público de invitación | No |
| POST | `/invites/:token/accept` | Acepta invitación y une al cielo (reward best-effort) | Si |

### Cloud Functions (event-driven)

| Trigger | Función | Descripción |
|---------|---------|-------------|
| `onObjectFinalized` (Storage) | `processVideoClip` | Procesa video raw: trim + compress FFmpeg (720p, H.264), genera thumbnail. 2 GiB RAM, 300s timeout |
| `onSchedule` (cada 15 min) | `cleanupZombieStars` | Resetea estrellas stuck en `mediaStatus: "processing"` por más de 15 minutos |

---

## Modelo de datos

### Firestore

| Colección | Campos principales |
|-----------|-------------------|
| `users/{uid}` | `displayName`, `email`, `stardust`, `maxSkies`, `maxMemberships`, `loginStreak`, `lastDailyRewardDate`, `createdStarsToday`, `videoProcessedToday` |
| `users/{uid}/inventory/{itemId}` | `itemId`, `category` (theme / sky-slot), `purchasedAt`, `source` |
| `users/{uid}/transactions/{txId}` | `type` (earn / spend), `amount`, `reason`, `balanceAfter`, `details` |
| `skies/{skyId}` | `title`, `ownerUserId`, `themeId`, `personalization` (density, nebula, twinkle, shootingStars), `privacy` |
| `skies/{skyId}/stars/{starId}` | `title`, `message`, `mediaType` (image/video), `mediaStatus` (processing/ready/error), `mediaPath`, `thumbnailPath`, `xNormalized`, `yNormalized`, `year`, `authorUserId`, `deletedAt` |
| `skies/{skyId}/members/{memberId}` | `userId`, `role` (owner/editor/viewer), `status` (active/revoked), `joinedAt` |
| `invites/{inviteId}` | `skyId`, `role`, `tokenHash` (SHA-256), `status` (pending/accepted/revoked), `expiresAt` (TTL 7 días) |
| `payments/{paymentId}` | `userId`, `packageId`, `amountInCents`, `currency` (COP), `stardustAmount`, `wompiReference`, `status` (pending/approved/declined/error/voided) |

---

## Sistema de seguridad

### Modelo de escritura

- **Todas las escrituras** ocurren via Cloud Functions (Admin SDK). Las Firestore rules bloquean writes directos del cliente.
- **Reads directos** solo permitidos para `skies/{skyId}/stars/{starId}` (miembros activos). Todo lo demás se lee a través de Cloud Functions.

### Autenticación

- Cada request protegido pasa por `authenticateRequest()`: verifica Firebase ID token con `checkRevoked: true`.
- CORS whitelistado: solo `localhost:5173` (dev) y `APP_URL` (prod).

### Storage

- **Imágenes**: máx 5 MB, solo JPEG/PNG/WebP. Upload solo si la estrella no tiene media.
- **Videos raw** (`temp/`): máx 50 MB, solo MP4/WebM/MOV. Solo create, no read.
- **Videos procesados** (`stars/`): solo lectura para miembros. Escritura exclusiva de Cloud Function.
- Catch-all: cualquier path no listado → bloqueado.

### Rate limits

| Recurso | Límite |
|---------|--------|
| Estrellas recompensadas por día | 10 |
| Invitaciones recompensadas por día | 5 |
| Videos procesados por día | 5 |
| Invitaciones pendientes por cielo | 10 |
| Miembros por cielo | 50 |
| Pagos pendientes concurrentes | 5 |

---

## Tests

Los tests viven al lado del código que prueban: `economy.ts` → `economy.test.ts`.

```bash
# Frontend
cd frontend && npm run test:run

# Backend
cd functions && npm run test:run

# Con cobertura
cd frontend && npm run test:coverage
cd functions && npm run test:coverage
```

**Patrones de testing:**

- **Backend**: `vi.hoisted()` + `vi.mock()` para Firebase Admin, `authenticateRequest`, Storage. `mockReset()` en `beforeEach`.
- **Frontend**: `vi.mock()` para `api()`, `useAuth()`. `@testing-library/react` para hooks y componentes. `jsdom` como environment.
- **Principio**: Los tests describen *qué* debe ocurrir, no *cómo* se implementa.

Consultar [`SPEC_Test.md`](SPEC_Test.md) para la guía completa de testing.

---

## Deploy

Siempre correr tests antes de desplegar.

```bash
# Solo functions
cd functions && npm run test:run && npm run build && cd .. && firebase deploy --only functions

# Solo hosting (frontend)
cd frontend && npm run test:run && npm run build && cd .. && firebase deploy --only hosting

# Solo reglas y índices
firebase deploy --only firestore:rules,firestore:indexes,storage

# Todo junto
cd functions && npm run test:run && npm run build && cd ..
cd frontend && npm run test:run && npm run build && cd ..
firebase deploy
```

El frontend se despliega como SPA en Firebase Hosting. Las rutas `/api/**` se reescriben a la Cloud Function `api`. Todas las demás rutas sirven `index.html` para routing client-side. Assets versionados cachean 1 año.

---

## Documentación adicional

- [`SPEC.md`](SPEC.md) — Features base: cielos, estrellas, miembros, invitaciones, auth, SkyEngine
- [`SPEC_v2.md`](SPEC_v2.md) — Economía (Polvo Estelar) y sistema de temas desbloqueables
- [`SPEC_v3.md`](SPEC_v3.md) — Video clips, pagos Wompi, temas avanzados
- [`SPEC_Test.md`](SPEC_Test.md) — Guía de testing: fases, archivos, patrones de mocking
- [`audits/`](audits/) — Auditorías de seguridad: Firestore rules, autenticación, pagos, atomicidad, validación de inputs, Storage uploads

---

## Licencia

MIT — ver [LICENSE](LICENSE) para más detalles.
