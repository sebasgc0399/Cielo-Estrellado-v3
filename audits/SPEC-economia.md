# SPEC: Correcciones al Sistema de Economia

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/07-economia.md` (auditoria de logica de economia)
**Archivos afectados:**
- `functions/src/handlers/economy.ts` (JSDoc en getEconomy, mapping en getTransactions)
- `functions/src/handlers/economy.test.ts` (tests nuevos para getTransactions)
- `frontend/src/domain/contracts.ts` (tipo TransactionRecord)
- `functions/src/domain/shopCatalog.test.ts` (tests de sincronizacion)

## Contexto

Una auditoria de la logica de economia identifico 1 hallazgo medio y 3 bajos. La logica es correcta y bien testeada — estos son mejoras defensivas, documentacion y un campo faltante descubierto durante la exploracion profunda. B2 (balanceAfter con multiples rewards) ya fue resuelto antes de esta SPEC. Un desarrollador puede implementar sin leer la auditoria original.

---

## Hallazgo resuelto: B2 — balanceAfter consolidado (YA CORREGIDO)

La auditoria reporto que multiples `TransactionRecord` con mismo `createdAt` podian tener `balanceAfter` parciales. El codigo actual ya consolida todos los rewards en un unico `TransactionRecord` con un array `details` dentro de la transaccion (`economy.ts:123-140`):

```typescript
const rewardDetails: Array<{ amount: number; reason: string }> = []
if (rewardsDaily > 0) rewardDetails.push({ amount: rewardsDaily, reason: 'daily_login' })
if (rewardsWeekly > 0) rewardDetails.push({ amount: rewardsWeekly, reason: 'weekly_bonus' })
if (rewardsStreak > 0) rewardDetails.push({ amount: rewardsStreak, reason: newStreak === 7 ? 'streak_7' : 'streak_30' })

if (rewardDetails.length > 0) {
  const txDocRef = userRef.collection('transactions').doc()
  transaction.set(txDocRef, {
    type: 'earn',
    amount: totalRewards,
    reason: 'daily_rewards',
    itemId: null,
    balanceAfter: newStardust,
    createdAt: nowISO,
    details: rewardDetails,
  } satisfies TransactionRecord)
}
```

Test existente (`economy.test.ts:318-341`) verifica que `transaction.set` se llama con un unico registro consolidado y que `mocks.add` NO fue llamado. **No requiere accion.**

---

## Fix 4: Streak bonus recurrente en multiplos de 30 [B1 — Decision de producto]

### Problema

El sistema otorga bonuses de racha unicamente en los dias exactos 7 (50 PE) y 30 (350 PE). Despues del dia 30, la racha es un numero decorativo — un usuario con racha de 45 dias recibe exactamente lo mismo que uno con racha de 2 dias.

**Codigo actual** (`economy.ts:95-101`):

```typescript
let rewardsStreak = 0
if (newStreak === 7) {
  rewardsStreak = STREAK_7_BONUS      // 50 PE
} else if (newStreak === 30) {
  rewardsStreak = STREAK_30_BONUS     // 350 PE
}
```

Igualdad estricta (`===`). No hay branch para valores > 30.

### Impacto economico: simulacion de usuario activo diario

Sin bonus recurrente (actual):
- Ingreso mensual: ~510 PE (15 daily × 30 + 20 weekly × 4 + 50 streak_7)
- Mes 1 tiene +350 PE extra por streak_30 = 860 PE
- Meses 2+: ~510 PE/mes constante
- Tiempo para comprar un tema de 800 PE: ~47 dias (1.5 meses)
- Tiempo para comprar un tema de 1500 PE: ~88 dias (3 meses)

Con bonus de 350 PE cada 30 dias (propuesto):
- Ingreso mensual: ~860 PE constante (+70% vs actual en meses 2+)
- Tiempo para tema de 800 PE: ~28 dias (~1 mes)
- Tiempo para tema de 1500 PE: ~53 dias (~1.8 meses)

El ciclo "quiero algo → lo puedo comprar" pasa de 1.5-3 meses a 1-1.8 meses. Significativo pero no destructivo — el usuario compra un tema extra cada ~2 meses en vez de cada ~3.

### Decision: Opcion 1 — Bonuses en multiplos de 30

Se evaluo tres opciones y se elige la Opcion 1 por razones de producto:

**Opcion 1 — Bonus de 350 PE cada 30 dias (ELEGIDA):**
- Crea un **evento recurrente anticipable**. "Manana cumplo 60 dias" es una razon para abrir la app.
- El usuario tiene una fecha en la cabeza → genera anticipacion y retencion.
- Economicamente predecible: +350 PE/mes, no es inflacionario.

**Opcion 2 — 25 PE semanales despues del dia 30 (DESCARTADA):**
- Psicologicamente debil: 25 PE no se siente como recompensa cuando el usuario ya esta acostumbrado a 350 PE.
- Diluye el momento de celebracion en incrementos pequenos que no generan anticipacion.

**Opcion 3 — Multiplicador 1.5x del daily reward (DESCARTADA):**
- Invisible para el usuario: ve "15 PE" que en realidad son 22. No hay momento de celebracion.
- Inflacion silenciosa sin feedback positivo explícito.
- La mas inflacionaria (~2,700 PE extra/año vs ~4,200 de Opcion 1) pero sin la ventaja psicologica.

### Dependencia critica: tamano del catalogo

El bonus de racha no es el factor limitante de la economia — **el catalogo lo es**. Actualmente hay 13 temas (600-1500 PE) y 1 sky-slot (500 PE). Un usuario muy activo con la Opcion 1 podria comprar todo en ~8-10 meses. Si el catalogo crece a un ritmo razonable (1-2 temas por mes), la economia se mantiene sana. Si el catalogo se estanca, ninguna opcion de streak lo salva — el usuario acumula PE sin nada que comprar.

### Archivo y ubicacion

`functions/src/handlers/economy.ts:95-101` — modificar condicion de streak bonus.

### Codigo propuesto

```typescript
let rewardsStreak = 0
if (newStreak === 7) {
  rewardsStreak = STREAK_7_BONUS
} else if (newStreak > 0 && newStreak % 30 === 0) {
  rewardsStreak = STREAK_30_BONUS
}
```

### Cambios clave

1. `newStreak === 30` cambia a `newStreak > 0 && newStreak % 30 === 0` — el bonus se otorga en el dia 30, 60, 90, 120, etc.
2. El `> 0` es un guard defensivo: `0 % 30 === 0` es true, pero `newStreak` nunca es 0 en este punto (minimo 1 despues del calculo de streak). Se incluye por claridad de intencion.
3. `STREAK_30_BONUS` (350 PE) se reutiliza sin cambios — no se necesita nueva constante.
4. El bonus de dia 7 (`STREAK_7_BONUS`) no cambia.
5. El bonus de dia 7 y el de dia 30 son mutuamente excluyentes por el `else if` — dia 7 siempre gana si coincidieran (no coinciden: 7 no es multiplo de 30).

### Cambios en frontend

Ningun cambio en frontend. El frontend no tiene logica de streak — solo muestra lo que el backend retorna en `rewards.streak` y `rewards.streakDays`.

---

## Fix 1: Documentar GET con side effects via JSDoc [M1 — Severidad Media]

### Problema

`GET /user/economy` calcula y acredita rewards (daily, weekly, streak) dentro de una transaccion Firestore. Esto viola la semantica HTTP de que GET es idempotente y sin side effects. El frontend lo llama en mount via `useUserEconomy` (`frontend/src/hooks/useUserEconomy.ts:42`).

### Decision: Aceptar como esta

Separar en `POST /user/economy/claim` agrega complejidad sin beneficio proporcional:
- Endpoint adicional y ruta en router
- Frontend necesitaria dos llamadas (POST claim + GET data) o logica extra
- Loading states adicionales y posible race condition entre claim y read
- El diseno actual es idempotente dentro del mismo dia UTC (check en linea 55-64)
- No hay vulnerabilidad de seguridad
- `Cache-Control: private, no-store` (linea 32) previene caching por proxies/CDN

### Archivo y ubicacion

`functions/src/handlers/economy.ts:30` — agregar JSDoc antes de la funcion.

### Codigo a agregar

```typescript
/**
 * GET /user/economy — Returns user economy data and triggers daily reward claiming.
 *
 * DESIGN NOTE: This GET endpoint has intentional side effects. It calculates and
 * credits daily login rewards, weekly bonuses, and streak bonuses within a Firestore
 * transaction. This design was chosen over a separate POST /claim endpoint because:
 *
 * 1. Rewards are idempotent within the same UTC day (lastDailyRewardDate check)
 * 2. Cache-Control: private, no-store prevents proxy/CDN caching
 * 3. A single endpoint is simpler than claim+read for frontend integration
 *
 * The frontend triggers this on mount via useUserEconomy hook.
 * See: audits/07-economia.md (M1) for full analysis.
 */
export async function getEconomy(req: Request, res: Response): Promise<void> {
```

### Decisiones de diseno

- JSDoc en vez de comentario inline: aparece en tooltips del editor y en documentacion generada.
- Referencia a la auditoria para trazabilidad.
- Explica el "por que" de la decision, no solo el "que".

---

## Fix 2: Campo `details` en frontend TransactionRecord + getTransactions mapping [NUEVO — Severidad Baja]

### Problema

El backend escribe `details?: Array<{ amount: number; reason: string }>` en `TransactionRecord` (`functions/src/domain/contracts.ts:102`), pero:

1. **Frontend contracts** (`frontend/src/domain/contracts.ts:95-102`) NO tiene el campo `details`.
2. **getTransactions** (`functions/src/handlers/economy.ts:203-213`) NO incluye `details` en el mapping de la respuesta.

El campo `details` se escribe en Firestore desde `economy.ts:138` pero nunca llega al cliente. Si el frontend muestra historial de transacciones con desglose de rewards, los datos no estarian disponibles.

### Archivo y ubicacion

**2a. `frontend/src/domain/contracts.ts:95-102`** — Agregar `details` al tipo:

```typescript
// ANTES:
export interface TransactionRecord {
  type: 'earn' | 'spend'
  amount: number
  reason: string
  itemId: string | null
  balanceAfter: number
  createdAt: IsoDateString
}

// DESPUES:
export interface TransactionRecord {
  type: 'earn' | 'spend'
  amount: number
  reason: string
  itemId: string | null
  balanceAfter: number
  createdAt: IsoDateString
  details?: Array<{ amount: number; reason: string }>
}
```

**2b. `functions/src/handlers/economy.ts:203-213`** — Incluir `details` en el mapping de getTransactions:

```typescript
// ANTES (linea 203-213):
const transactions = snap.docs.map((doc: QueryDocumentSnapshot) => {
  const data = doc.data()
  return {
    id: doc.id,
    type: data.type as TransactionRecord['type'],
    amount: data.amount as number,
    reason: data.reason as string,
    itemId: (data.itemId as string) ?? null,
    balanceAfter: data.balanceAfter as number,
    createdAt: data.createdAt as string,
  }
})

// DESPUES:
const transactions = snap.docs.map((doc: QueryDocumentSnapshot) => {
  const data = doc.data()
  return {
    id: doc.id,
    type: data.type as TransactionRecord['type'],
    amount: data.amount as number,
    reason: data.reason as string,
    itemId: (data.itemId as string) ?? null,
    balanceAfter: data.balanceAfter as number,
    createdAt: data.createdAt as string,
    ...(data.details ? { details: data.details as Array<{ amount: number; reason: string }> } : {}),
  }
})
```

### Decisiones de diseno

- El campo es opcional (`details?`) porque solo reward transactions lo usan. Shop purchases, star creation, invites, etc. no tienen details.
- Se usa spread condicional en getTransactions para no incluir `details: undefined` en transactions que no lo tienen — mantiene el payload limpio. **Nota:** `JSON.stringify` (usado por `res.json()`) ya omite claves con valor `undefined`, asi que `details: data.details` (sin spread) produciria el mismo JSON. El spread condicional es una buena practica de codigo limpio (la intencion es explicita), no un requisito funcional.
- No se requiere migracion de datos: el campo ya existe en Firestore desde que se implemento la consolidacion de rewards.

---

## Fix 3: Test de sincronizacion para catalogos duplicados [B3 — Severidad Baja]

### Problema

`shopCatalog.ts` y `economyRules.ts` existen como copias identicas en `frontend/` y `functions/`. No hay test que verifique que ambas copias se mantienen sincronizadas. Si alguien modifica un precio en el backend sin actualizar el frontend, el usuario veria un precio diferente al que paga.

### Archivo y ubicacion

`functions/src/domain/shopCatalog.test.ts` — agregar nuevo `describe` al final del archivo (despues de linea 54).

### Codigo a agregar

```typescript
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('frontend/backend catalog sync', () => {
  it('shopCatalog.ts es identico en frontend y functions', () => {
    const backendPath = resolve(process.cwd(), 'src/domain/shopCatalog.ts')
    const frontendPath = resolve(process.cwd(), '../frontend/src/domain/shopCatalog.ts')
    const backend = readFileSync(backendPath, 'utf-8')
    const frontend = readFileSync(frontendPath, 'utf-8')
    expect(backend).toBe(frontend)
  })

  it('economyRules.ts es identico en frontend y functions', () => {
    const backendPath = resolve(process.cwd(), 'src/domain/economyRules.ts')
    const frontendPath = resolve(process.cwd(), '../frontend/src/domain/economy.ts')
    const backend = readFileSync(backendPath, 'utf-8')
    const frontend = readFileSync(frontendPath, 'utf-8')
    expect(backend).toBe(frontend)
  })
})
```

**Nota:** Los imports de `node:fs` y `node:path` van al inicio del archivo, junto con los imports existentes.

### Decisiones de diseno

- **Comparacion textual** en vez de importar y comparar valores: detecta CUALQUIER diferencia (comments, whitespace, field order, tipos) no solo valores. Si los archivos deben ser copias identicas, la comparacion debe ser identica.
- **Test ubicado en functions/** porque el backend es la fuente de verdad. Si el frontend diverge, el error aparece al correr `cd functions && npx vitest`.
- **`process.cwd()` en vez de `__dirname`**: En vitest, `process.cwd()` siempre es el directorio donde esta `vitest.config.ts` (en nuestro caso `functions/`). Esto es mas robusto que `__dirname` porque no depende de como vitest resuelve el path del archivo de test — depende solo de donde se ejecuta vitest, que es determinista. Desde `functions/`, `../frontend/src/domain/` llega al archivo correcto.
- **Contenido verificado:** `economyRules.ts` (backend) y `economy.ts` (frontend) tienen nombres diferentes pero contenido identico — solo constantes exportadas, sin imports internos que referencien otros archivos por nombre. La comparacion textual funciona correctamente a pesar de los nombres diferentes.
- **Alternativa descartada (API como fuente unica):** Usar `GET /shop/catalog` como fuente en frontend eliminaria la duplicacion, pero agregaria un loading state al abrir la tienda y un punto de fallo de red. Los catalogos cambian muy raramente (nuevos temas cada semanas/meses), asi que un test de sync es la solucion mas simple.
- **Nota sobre economy.test.ts existente en frontend:** Ya existe un test en `frontend/src/domain/economy.test.ts` que verifica que las 10 constantes tienen valores esperados (hardcodeados). Ese test es complementario pero NO suficiente: si ambos archivos cambian al mismo valor incorrecto, ese test no detectaria la divergencia. El test de sync textual garantiza que ambos archivos sean siempre la misma copia.

---

## Plan de tests

### Tests existentes que necesitan modificacion (Fix 4)

| # | Test actual | Linea | Cambio requerido |
|---|-------------|-------|------------------|
| 1 | "otorga bonus de racha 30" | 195 | Sigue pasando — dia 30 es multiplo de 30. Sin cambios. |
| 2 | "NO otorga bonus en racha 13 y 20" | 211 | Sigue pasando — 13 y 20 no son multiplos de 30. Sin cambios. |

Ningun test existente necesita modificacion. Los tests de racha 30 ya cubren el caso `newStreak === 30` que sigue siendo true con `newStreak % 30 === 0`.

### Nuevos tests a agregar

#### En `functions/src/handlers/economy.test.ts` — describe `getEconomy` (Fix 4):

```typescript
it('otorga bonus de racha 60 (multiplo de 30)', async () => {
  mocks.transaction.get.mockResolvedValue(userSnap({
    stardust: 500,
    lastDailyRewardDate: YESTERDAY,
    loginStreak: 59,
    previousStreak: 0,
    weeklyBonusWeek: CURRENT_WEEK,
  }))

  const res = makeRes()
  await getEconomy(makeReq(), res)

  const body = res.json.mock.calls[0][0]
  expect(body.rewards.streak).toBe(350)
  expect(body.rewards.streakDays).toBe(60)
})

it('NO otorga bonus de racha en dia 31 (no es multiplo de 30)', async () => {
  mocks.transaction.get.mockResolvedValue(userSnap({
    stardust: 500,
    lastDailyRewardDate: YESTERDAY,
    loginStreak: 30,
    previousStreak: 0,
    weeklyBonusWeek: CURRENT_WEEK,
  }))

  const res = makeRes()
  await getEconomy(makeReq(), res)

  const body = res.json.mock.calls[0][0]
  expect(body.rewards.streak).toBe(0)
  expect(body.rewards.streakDays).toBe(31)
})

it('otorga bonus de racha 90 (multiplo de 30)', async () => {
  mocks.transaction.get.mockResolvedValue(userSnap({
    stardust: 500,
    lastDailyRewardDate: YESTERDAY,
    loginStreak: 89,
    previousStreak: 0,
    weeklyBonusWeek: CURRENT_WEEK,
  }))

  const res = makeRes()
  await getEconomy(makeReq(), res)

  const body = res.json.mock.calls[0][0]
  expect(body.rewards.streak).toBe(350)
  expect(body.rewards.streakDays).toBe(90)
})
```

#### En `functions/src/handlers/economy.test.ts` — describe `getTransactions` (Fix 2):

```typescript
it('incluye details cuando existen en la transaccion', async () => {
  mocks.queryGet.mockResolvedValue({
    docs: [
      {
        id: 'tx-1',
        data: () => ({
          type: 'earn',
          amount: 35,
          reason: 'daily_rewards',
          itemId: null,
          balanceAfter: 135,
          createdAt: '2026-01-15T12:00:00Z',
          details: [
            { amount: 15, reason: 'daily_login' },
            { amount: 20, reason: 'weekly_bonus' },
          ],
        }),
      },
    ],
  })

  const res = makeRes()
  await getTransactions(makeReq(), res)

  const body = res.json.mock.calls[0][0]
  expect(body.transactions[0].details).toEqual([
    { amount: 15, reason: 'daily_login' },
    { amount: 20, reason: 'weekly_bonus' },
  ])
})

it('omite details cuando no existen en la transaccion', async () => {
  mocks.queryGet.mockResolvedValue({
    docs: [
      {
        id: 'tx-1',
        data: () => ({
          type: 'spend',
          amount: 800,
          reason: 'shop_purchase',
          itemId: 'theme-aurora',
          balanceAfter: 200,
          createdAt: '2026-01-15T12:00:00Z',
        }),
      },
    ],
  })

  const res = makeRes()
  await getTransactions(makeReq(), res)

  const body = res.json.mock.calls[0][0]
  expect(body.transactions[0]).not.toHaveProperty('details')
})
```

#### En `functions/src/domain/shopCatalog.test.ts` (Fix 3):

Ver seccion Fix 3 arriba para codigo completo (2 tests de sincronizacion).

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | Fix 1 — JSDoc en getEconomy | Minima | Solo documentacion. Sin cambios logicos. Sin tests. |
| 2 | Fix 2 — details en frontend contracts + getTransactions | Baja | 1 campo en tipo, 1 linea en mapping, 2 tests nuevos. |
| 3 | Fix 3 — Test de sincronizacion | Baja | 2 tests nuevos. Sin cambios de produccion. |
| 4 | Fix 4 — Streak bonus recurrente cada 30 dias | Baja | 1 linea cambiada en economy.ts, 3 tests nuevos. |

### Dependencias entre cambios

- **Fix 2 y Fix 4** ambos modifican `economy.ts` y `economy.test.ts` — implementarlos en secuencia.
- Fix 1 (JSDoc) y Fix 3 (sync tests) no tienen dependencias con ningun otro fix.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/economy.test.ts
cd functions && npx vitest run src/domain/shopCatalog.test.ts
cd functions && npx tsc --noEmit
cd frontend && npx tsc --noEmit
```

### Conteo esperado de tests

**economy.test.ts:**
- Antes: 19 tests (14 getEconomy + 5 getTransactions)
- Despues: 24 tests (17 getEconomy + 7 getTransactions)
- Delta: +3 en getEconomy (Fix 4), +2 en getTransactions (Fix 2)

**shopCatalog.test.ts:**
- Antes: 9 tests
- Despues: 11 tests
- Delta: +2 (sync tests)

### Checklist

- [ ] JSDoc en getEconomy aparece en hover del editor
- [ ] `details` aparece en frontend TransactionRecord type
- [ ] `npx tsc --noEmit` pasa en frontend/ y functions/
- [ ] Sync test falla si se modifica un precio solo en un lado (verificar manualmente cambiando un precio, corriendo el test, y revirtiendo)
- [ ] getTransactions devuelve details para daily_rewards y las omite para shop_purchase
- [ ] Streak bonus se otorga en dia 60 y 90 (tests nuevos)
- [ ] Streak bonus NO se otorga en dia 31 (test nuevo)
- [ ] Test existente de racha 30 sigue pasando sin modificacion
- [ ] Todos los tests existentes siguen pasando sin modificacion

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| `process.cwd()` no apunta a `functions/` en CI | Muy baja | Vitest usa el directorio de `vitest.config.ts` como cwd. Nuestro CI ejecuta `cd functions && npx vitest`, que garantiza el cwd correcto. |
| Sync test demasiado estricto (falla por trailing newline o whitespace) | Muy baja | Intencional: los archivos deben ser copias identicas. Si se quiere flexibilidad, cambiar a comparacion por valores exportados, pero eso pierde deteccion de divergencias en tipos y estructura. |
| Spread condicional de `details` afecta performance con muchas transacciones | Muy baja | getTransactions tiene limit maximo de 50 docs. El costo del spread condicional es insignificante. |
