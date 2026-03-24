# SPEC_Test.md — Estrategia de Testing para Cielo Estrellado v3

## Estado actual

- **Tests existentes:** Cero
- **Framework:** No instalado
- **Infraestructura:** No configurada

## Framework elegido: Vitest

**Por que Vitest y no Jest:**
- Nativo de Vite (el frontend ya usa Vite 6)
- Configuracion minima (reutiliza vite.config.ts)
- Compatible con TypeScript strict sin config extra
- API compatible con Jest (misma sintaxis describe/it/expect)
- Mas rapido que Jest para proyectos Vite

## Fase 0 — Setup (prerequisito para todo)

### Frontend

```bash
cd frontend
npm install -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

Crear `frontend/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Crear `frontend/src/test/setup.ts`:
```typescript
import '@testing-library/jest-dom/vitest'
```

Agregar script en `frontend/package.json`:
```json
"scripts": {
  "test": "vitest",
  "test:run": "vitest run",
  "test:ui": "vitest --ui"
}
```

### Backend (Functions)

```bash
cd functions
npm install -D vitest
```

Crear `functions/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
```

Agregar script en `functions/package.json`:
```json
"scripts": {
  "test": "vitest",
  "test:run": "vitest run"
}
```

### Estructura de archivos de test

Los tests van al lado del archivo que testean:
```
functions/src/
  handlers/
    economy.ts
    economy.test.ts        ← test al lado del handler
  domain/
    economyRules.ts
    economyRules.test.ts
  lib/
    acceptInvite.ts
    acceptInvite.test.ts

frontend/src/
  domain/
    themes.ts
    themes.test.ts
  hooks/
    useUserEconomy.ts
    useUserEconomy.test.ts
  components/
    economy/
      StardustBalance.tsx
      StardustBalance.test.tsx
```

---

## Fase 1 — Tests unitarios de dominio (sin mocks)

**Prioridad:** Alta
**Complejidad:** Baja
**Dependencias:** Solo Vitest

Estos tests no necesitan mocks ni Firestore. Son funciones puras o datos estaticos.

### 1.1 Backend: economyRules.ts
```
Archivo: functions/src/domain/economyRules.test.ts
Verificar:
- Todas las constantes existen y son numeros positivos
- WELCOME_BONUS === 100
- MAX_STARS_REWARD_PER_DAY === 10
- MAX_INVITE_REWARDS_PER_DAY === 5
```

### 1.2 Backend: shopCatalog.ts
```
Archivo: functions/src/domain/shopCatalog.test.ts
Verificar:
- SHOP_CATALOG tiene 8 items (7 temas + 1 sky-slot)
- getShopItem('sky-slot') retorna item con price 500
- getShopItem('theme-aurora-borealis') retorna item con category 'theme'
- getShopItem('no-existe') retorna undefined
- getShopItemsByCategory('theme') retorna 7 items
- getShopItemsByCategory('sky-slot') retorna 1 item
- Todos los items tienen itemId, name, category, price
- Todos los temas tienen themeId
- Los precios coinciden con SPEC_v2.md (600 o 800)
```

### 1.3 Frontend: themes.ts
```
Archivo: frontend/src/domain/themes.test.ts
Verificar:
- getAllThemes() retorna 8 temas
- getThemeById(null) retorna null
- getThemeById('classic') retorna null (engine usa DEFAULT_THEME)
- getThemeById('aurora-borealis') retorna ThemeParams con colors
- getThemeById('no-existe') retorna null
- getThemeDefinition('classic') retorna ThemeDefinition con name, description, colors
- Todos los temas tienen las 13 propiedades de ThemeColors
- Los IDs de temas en themes.ts coinciden con los themeIds de shopCatalog.ts
```

### 1.4 Frontend: economy.ts
```
Archivo: frontend/src/domain/economy.test.ts
Verificar:
- Todas las constantes coinciden con functions/src/domain/economyRules.ts
- Son los mismos 10 valores
```

### 1.5 Frontend: StardustBalance formatCompact
```
Archivo: frontend/src/components/economy/StardustBalance.test.ts
Verificar (exportar formatCompact si no esta exportado):
- formatCompact(0) === '0'
- formatCompact(999) === '999'
- formatCompact(1000) === '1000'
- formatCompact(9999) === '9999'
- formatCompact(10000) === '10K'
- formatCompact(12500) === '12.5K'
- formatCompact(100000) === '100K'
- formatCompact(999999) === '1000K' o '1M'
- formatCompact(1000000) === '1M'
- formatCompact(1500000) === '1.5M'
- formatCompact(99999999) === '100M'
```

### 1.6 Frontend: TransactionHistory formatRelativeDate
```
Archivo: frontend/src/components/economy/TransactionHistory.test.ts
Verificar (exportar formatRelativeDate si no esta exportado):
- Fecha de hace 5 minutos → "Hace 5m"
- Fecha de hace 3 horas → "Hace 3h"
- Fecha de ayer → "Ayer"
- Fecha de hace 3 dias (misma semana) → nombre del dia
- Fecha de hace 2 semanas → "DD mmm"
```

---

## Fase 2 — Tests unitarios de logica de negocio (con mocks de Firestore)

**Prioridad:** Alta
**Complejidad:** Media
**Dependencias:** Vitest + mocks manuales

### Estrategia de mocking

NO usar el emulador de Firebase (es lento y requiere Java). En su lugar, mockear `db` y `auth` de `../lib/firebaseAdmin.js`:

```typescript
// functions/src/test/mocks/firebaseAdmin.ts
import { vi } from 'vitest'

export const mockTransaction = {
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  set: vi.fn(),
}

export const mockDb = {
  collection: vi.fn().mockReturnThis(),
  doc: vi.fn().mockReturnThis(),
  get: vi.fn(),
  set: vi.fn(),
  update: vi.fn(),
  add: vi.fn(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  startAfter: vi.fn().mockReturnThis(),
  collectionGroup: vi.fn().mockReturnThis(),
  runTransaction: vi.fn(async (fn) => fn(mockTransaction)),
}

export const mockAuth = {
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
}

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: mockDb,
  auth: mockAuth,
}))
```

### 2.1 economy.ts — getEconomy
```
Archivo: functions/src/handlers/economy.test.ts

Test: "otorga daily reward en primera llamada del dia"
- Mock: usuario con stardust=100, lastDailyRewardDate=null
- Expect: transaction.update con stardust=110, loginStreak=1
- Expect: response con rewards.daily=10

Test: "es idempotente en segunda llamada del mismo dia"
- Mock: usuario con lastDailyRewardDate=hoy
- Expect: transaction.update NO llamado
- Expect: response con rewards.daily=0

Test: "calcula streak correctamente — dia consecutivo"
- Mock: usuario con lastDailyRewardDate=ayer, loginStreak=5
- Expect: loginStreak=6

Test: "resetea streak con gap"
- Mock: usuario con lastDailyRewardDate=anteayer, loginStreak=5
- Expect: loginStreak=1, previousStreak=5

Test: "otorga bonus de racha 7"
- Mock: usuario con loginStreak=6, lastDailyRewardDate=ayer
- Expect: rewardsStreak=50 (STREAK_7_BONUS)

Test: "otorga bonus de racha 30"
- Mock: usuario con loginStreak=29, lastDailyRewardDate=ayer
- Expect: rewardsStreak=200 (STREAK_30_BONUS)

Test: "NO otorga bonus en racha 14 ni 21"
- Mock: loginStreak=13/20
- Expect: rewardsStreak=0

Test: "otorga weekly bonus una vez por semana ISO"
- Mock: weeklyBonusWeek=null
- Expect: rewardsWeekly=20

Test: "NO otorga weekly bonus si ya fue otorgado esta semana"
- Mock: weeklyBonusWeek=semana-actual
- Expect: rewardsWeekly=0

Test: "resetea contadores solo si son de dia anterior"
- Mock: lastStarCreationDate=hoy, createdStarsToday=5
- Expect: createdStarsToday NO se resetea a 0

Test: "resetea contadores si son de dia anterior"
- Mock: lastStarCreationDate=ayer, createdStarsToday=5
- Expect: createdStarsToday=0

Test: "variables de reward se resetean en retry de transaccion"
- Simular que runTransaction ejecuta el callback 2 veces
- Expect: rewards finales son los del ultimo intento, no acumulados
```

### 2.2 economy.ts — getTransactions
```
Test: "retorna transacciones paginadas"
- Mock: 3 docs en transactions
- Expect: response con transactions.length=3, nextCursor

Test: "respeta limit"
- Mock: limit=2
- Expect: transactions.length=2, nextCursor != null

Test: "retorna 404 si usuario no existe"
- Mock: userSnap.exists=false
- Expect: status 404
```

### 2.3 shop.ts — purchase
```
Archivo: functions/src/handlers/shop.test.ts

Test: "compra exitosa de tema"
- Mock: stardust=1000, item=theme-aurora-borealis (800 PE), no owned
- Expect: stardust=200, inventory tiene item

Test: "rechaza si balance insuficiente"
- Mock: stardust=500, item price=800
- Expect: status 400, error 'Balance insuficiente'

Test: "rechaza si tema ya comprado"
- Mock: item ya en inventory
- Expect: status 400, error 'Ya posees este item'

Test: "sky-slot incrementa maxSkies"
- Mock: stardust=1000, maxSkies=2
- Expect: maxSkies=3

Test: "sky-slot permite multiples compras"
- Mock: sky-slot ya en inventory
- Expect: compra exitosa (no duplica check para sky-slots)

Test: "rechaza itemId invalido"
- Mock: itemId='no-existe'
- Expect: status 400

Test: "crea TransactionRecord de audit"
- Expect: add() llamado en users/{uid}/transactions con type='spend'
```

### 2.4 stars.ts — createStar rewards
```
Archivo: functions/src/handlers/stars.test.ts

Test: "otorga STAR_CREATION_REWARD al crear estrella"
- Mock: createdStarsToday=0
- Expect: stardust += 5

Test: "otorga FIRST_STAR_BONUS si es primera estrella en cielo"
- Mock: query de estrellas retorna vacio
- Expect: stardust += 25

Test: "respeta cap diario de MAX_STARS_REWARD_PER_DAY"
- Mock: createdStarsToday=10
- Expect: creationReward=0

Test: "resetea contador si es nuevo dia"
- Mock: lastStarCreationDate=ayer, createdStarsToday=10
- Expect: createdStarsToday=0, luego reward otorgado

Test: "reward es best-effort — estrella se crea aunque reward falle"
- Mock: transaction de reward lanza error
- Expect: response status=201, starId presente
```

### 2.5 invitePublic.ts — acceptInvite rewards
```
Archivo: functions/src/handlers/invitePublic.test.ts

Test: "valida maxMemberships antes de aceptar"
- Mock: memberships activas = 20, maxMemberships=20
- Expect: status 403

Test: "otorga INVITE_ACCEPTED_REWARD"
- Mock: acceptedInvitesToday=0
- Expect: stardust += 30

Test: "respeta cap diario de invitaciones"
- Mock: acceptedInvitesToday=5
- Expect: stardustEarned=0
```

### 2.6 userSync.ts — migracion
```
Archivo: functions/src/handlers/userSync.test.ts

Test: "crea usuario nuevo con campos economy"
- Mock: userSnap.exists=false
- Expect: set() con stardust=100, maxSkies=2, etc.

Test: "migra usuario existente sin stardust"
- Mock: userSnap.exists=true, stardust=undefined
- Expect: update() con stardust=100, maxSkies=max(2, ownerCount)

Test: "no migra usuario ya migrado"
- Mock: stardust=500
- Expect: update() SIN campos economy

Test: "migracion es idempotente"
- Simular 2 llamadas
- Expect: solo 1 transaccion de welcome
```

### 2.7 skies.ts — maxSkies y updateSkyTheme
```
Archivo: functions/src/handlers/skies.test.ts

Test: "rechaza crear cielo si maxSkies alcanzado"
- Mock: maxSkies=2, ownerCount=2
- Expect: status 403

Test: "updateSkyTheme valida themeId contra catalogo"
- Mock: themeId='fake-theme'
- Expect: status 400

Test: "updateSkyTheme permite classic sin inventario"
- Mock: themeId='classic', inventory vacio
- Expect: status 200

Test: "updateSkyTheme rechaza tema no poseido"
- Mock: themeId='aurora-borealis', inventory vacio
- Expect: status 403
```

---

## Fase 3 — Tests de hooks (frontend)

**Prioridad:** Media
**Complejidad:** Media
**Dependencias:** Vitest + @testing-library/react + mocks de API

### Estrategia de mocking para hooks

Mockear `api()` de `@/lib/api/client`:
```typescript
vi.mock('@/lib/api/client', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message) }
  },
}))
```

Mockear `useAuth()`:
```typescript
vi.mock('@/lib/auth/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { uid: 'test-uid' }, loading: false })),
}))
```

### 3.1 useUserEconomy
```
Archivo: frontend/src/hooks/useUserEconomy.test.ts

Test: "fetcha economia al montar con usuario autenticado"
- Mock: api retorna EconomyData
- Expect: economy tiene stardust, loginStreak, etc.

Test: "no fetcha sin usuario"
- Mock: useAuth retorna user=null
- Expect: economy=null, loading=false

Test: "refetch re-ejecuta el fetch"
- Llamar refetch()
- Expect: api llamado 2 veces

Test: "addStardust actualiza optimistamente"
- Mock: economy.stardust=100
- Llamar addStardust(50)
- Expect: economy.stardust=150 (sin fetch)

Test: "error se expone en el hook"
- Mock: api lanza error
- Expect: error no es null, economy es null
```

---

## Fase 4 — Tests de componentes (frontend)

**Prioridad:** Baja
**Complejidad:** Media-Alta
**Dependencias:** @testing-library/react + mocks

### 4.1 StardustBalance
```
Test: "muestra balance con NumberTicker cuando < 10K"
Test: "muestra formato compacto cuando >= 10K y compact=true"
Test: "llama onClick al hacer click"
```

### 4.2 DailyRewardModal
```
Test: "no renderiza si rewards.daily === 0"
Test: "muestra total correcto (daily + weekly + streak)"
Test: "muestra mensaje de streak roto si previousStreak > 3 y streakDays === 1"
Test: "llama onClose al hacer click en Genial"
```

### 4.3 StardustOnboarding
```
Test: "renderiza cuando condiciones se cumplen"
Test: "llama onDismiss despues de 8 segundos"
Test: "llama onDismiss al click en X"
```

### 4.4 StreakIndicator
```
Test: "muestra 0 circulos completados con streak 0"
Test: "muestra 3 circulos con streak 3"
Test: "muestra 7 circulos con streak 7"
Test: "muestra 1 circulo con streak 8 (nuevo ciclo)"
Test: "muestra barra de progreso con streak >= 7" — NOTA: barra eliminada en refactor
Test: "muestra texto '🔥 N dias' cuando streak >= 7"
```

---

## Fase 5 — Tests de integracion (opcional, futuro)

**Prioridad:** Baja
**Dependencias:** Firebase Emulator Suite (requiere Java)

Solo si el proyecto crece significativamente. Actualmente los tests unitarios con mocks cubren el 95% de los casos.

```
- Emulador de Firestore para tests de transacciones reales
- Emulador de Auth para tests de autenticacion
- Tests end-to-end con Playwright/Cypress (paginas completas)
```

---

## Cobertura objetivo por fase

| Fase | Archivos | Tests aprox | Cobertura |
|------|----------|-------------|-----------|
| 0 | Setup | 0 | 0% |
| 1 | 6 archivos dominio | ~30 tests | Dominio 100% |
| 2 | 7 handlers backend | ~45 tests | Backend 80% |
| 3 | 1 hook | ~5 tests | Hooks 60% |
| 4 | 4 componentes | ~15 tests | Componentes 40% |
| **Total** | **18 archivos** | **~95 tests** | **~70% backend, ~50% frontend** |

## Orden de implementacion recomendado

```
Fase 0 (setup)
  └→ Fase 1.1 (economyRules) — validar que el setup funciona
  └→ Fase 1.2 (shopCatalog)
  └→ Fase 1.3 (themes)
  └→ Fase 1.4 (economy constants)
  └→ Fase 1.5 (formatCompact)
  └→ Fase 1.6 (formatRelativeDate)
  └→ Fase 2.1 (getEconomy) — primer test con mocks
  └→ Fase 2.2 (getTransactions)
  └→ Fase 2.3 (purchase)
  └→ Fase 2.4 (createStar rewards)
  └→ Fase 2.5 (acceptInvite rewards)
  └→ Fase 2.6 (userSync)
  └→ Fase 2.7 (skies)
  └→ Fase 3.1 (useUserEconomy)
  └→ Fase 4.x (componentes)
```

## Principios de testing (alineados con CLAUDE.md)

1. **Simplicidad.** Un test por comportamiento. No testear implementacion, testear resultado.
2. **Sin abstracciones prematuras.** No crear test helpers ni factories hasta que haya 3+ tests que los necesiten.
3. **Mocks minimos.** Solo mockear lo que es externo (Firestore, API, Auth). La logica de negocio se testea directamente.
4. **Tests independientes.** Cada test puede correr solo, sin depender de otros.
5. **Naming claro.** `"otorga daily reward en primera llamada del dia"` — describe el comportamiento esperado.

## Comandos

```bash
# Frontend
cd frontend && npm run test          # Watch mode
cd frontend && npm run test:run      # Single run (CI)

# Backend
cd functions && npm run test         # Watch mode
cd functions && npm run test:run     # Single run (CI)
```
