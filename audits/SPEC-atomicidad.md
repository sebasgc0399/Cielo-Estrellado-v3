# SPEC: Correcciones de Atomicidad en Transacciones

**Fecha:** 2026-03-27
**Estado:** Pendiente
**Origen:** `audits/04-atomicidad.md` (auditoria de atomicidad)
**Archivos afectados:**
- `functions/src/handlers/stars.ts` (fix critico + audit logs)
- `functions/src/handlers/shop.ts` (audit log atomico)
- `functions/src/handlers/invitePublic.ts` (audit log atomico + documentacion)
- `functions/src/handlers/economy.ts` (refactor variables + audit logs consolidados)
- `functions/src/domain/contracts.ts` (tipo TransactionRecord)
- `functions/src/handlers/stars.test.ts` (tests actualizados + nuevos)
- `functions/src/handlers/shop.test.ts` (test actualizado)
- `functions/src/handlers/invitePublic.test.ts` (test nuevo)
- `functions/src/handlers/economy.test.ts` (test nuevo)
- `frontend/src/components/economy/TransactionHistory.tsx` (nuevo label en REASON_LABELS)

## Contexto

Una auditoria de atomicidad identifico 5 hallazgos (1 critico, 2 medios, 2 bajos) en las transacciones de la economia. El hallazgo critico es una race condition explotable en `createStar` que permite duplicar `FIRST_STAR_BONUS` (25 PE) mediante requests paralelos. Los hallazgos medios son un patron sistematico de audit logs escritos fuera de transacciones. Los bajos son mejoras de robustez y documentacion.

**Nota:** `SPEC-Pagos-Wompi.md` Fix 3 ya cubre el audit log de `payments.ts`. Este SPEC NO duplica esa correccion.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 1: isFirstStar dentro de transaccion + audit logs atomicos en createStar [C1+M1 — Severidad Critica]

### Problema

En `createStar`, el check de `isFirstStar` ocurre FUERA de la transaccion. Si dos requests llegan simultaneamente:
1. Ambos ejecutan la query (linea 118-124) y ven `existingStarsSnap.empty === true`
2. Ambos crean la estrella (linea 126)
3. Ambos entran al `runTransaction` con `isFirstStar === true`
4. Ambos acreditan `FIRST_STAR_BONUS` (25 PE cada uno, duplicando la recompensa)

Ademas, los audit logs (lineas 169-188) se escriben fuera de la transaccion con `Promise.all` — si crashea entre el commit y los writes, el balance cambia sin registro.

### Codigo actual (`stars.ts:118-192`)

```typescript
const existingStarsSnap = await db
  .collection('skies').doc(skyId).collection('stars')
  .where('authorUserId', '==', decoded.uid)
  .where('deletedAt', '==', null)
  .limit(1)
  .get()
const isFirstStar = existingStarsSnap.empty

await starRef.set(starData)

const userRef = db.collection('users').doc(decoded.uid)
let stardustEarned = 0
try {
  const rewardResult = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const userData = userSnap.data()
    if (!userData) return null

    const todayUTC = new Date().toISOString().slice(0, 10)
    let createdStarsToday = typeof userData.createdStarsToday === 'number' ? userData.createdStarsToday : DEFAULT_USER_ECONOMY.createdStarsToday
    const lastStarCreationDate = typeof userData.lastStarCreationDate === 'string' ? userData.lastStarCreationDate : DEFAULT_USER_ECONOMY.lastStarCreationDate
    const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : DEFAULT_USER_ECONOMY.stardust

    if (lastStarCreationDate !== todayUTC) {
      createdStarsToday = 0
    }

    let creationReward = 0
    if (createdStarsToday < MAX_STARS_REWARD_PER_DAY) {
      creationReward = STAR_CREATION_REWARD
      createdStarsToday += 1
    }

    let firstStarReward = 0
    if (isFirstStar) {
      firstStarReward = FIRST_STAR_BONUS
    }

    const totalReward = creationReward + firstStarReward
    if (totalReward > 0) {
      const newBalance = currentStardust + totalReward
      transaction.update(userRef, {
        stardust: newBalance,
        createdStarsToday,
        lastStarCreationDate: todayUTC,
      })
      return { totalReward, creationReward, firstStarReward, newBalance, currentStardust }
    }
    return null
  })

  if (rewardResult) {
    stardustEarned = rewardResult.totalReward
    const txNow = new Date().toISOString()
    const txPromises: Promise<DocumentReference>[] = []

    if (rewardResult.creationReward > 0) {
      const tx: TransactionRecord = {
        type: 'earn', amount: rewardResult.creationReward, reason: 'star_creation',
        itemId: null, balanceAfter: rewardResult.currentStardust + rewardResult.creationReward, createdAt: txNow,
      }
      txPromises.push(userRef.collection('transactions').add(tx))
    }
    if (rewardResult.firstStarReward > 0) {
      const tx: TransactionRecord = {
        type: 'earn', amount: rewardResult.firstStarReward, reason: 'first_star_bonus',
        itemId: null, balanceAfter: rewardResult.newBalance, createdAt: txNow,
      }
      txPromises.push(userRef.collection('transactions').add(tx))
    }
    await Promise.all(txPromises)
  }
} catch (rewardError) {
  console.error('Star creation reward failed (non-blocking):', rewardError)
}
```

### Codigo propuesto

Reemplaza lineas 118-192 (desde `const existingStarsSnap` hasta el cierre del `catch`):

```typescript
await starRef.set(starData)

const userRef = db.collection('users').doc(decoded.uid)
let stardustEarned = 0
try {
  const rewardResult = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef)
    const userData = userSnap.data()
    if (!userData) return null

    // isFirstStar DENTRO de la transaccion — previene race condition
    const existingStarsSnap = await transaction.get(
      db.collection('skies').doc(skyId).collection('stars')
        .where('authorUserId', '==', decoded.uid)
        .where('deletedAt', '==', null)
        .limit(1)
    )
    const isFirstStar = existingStarsSnap.empty

    const todayUTC = new Date().toISOString().slice(0, 10)
    let createdStarsToday = typeof userData.createdStarsToday === 'number' ? userData.createdStarsToday : DEFAULT_USER_ECONOMY.createdStarsToday
    const lastStarCreationDate = typeof userData.lastStarCreationDate === 'string' ? userData.lastStarCreationDate : DEFAULT_USER_ECONOMY.lastStarCreationDate
    const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : DEFAULT_USER_ECONOMY.stardust

    if (lastStarCreationDate !== todayUTC) {
      createdStarsToday = 0
    }

    let creationReward = 0
    if (createdStarsToday < MAX_STARS_REWARD_PER_DAY) {
      creationReward = STAR_CREATION_REWARD
      createdStarsToday += 1
    }

    let firstStarReward = 0
    if (isFirstStar) {
      firstStarReward = FIRST_STAR_BONUS
    }

    const totalReward = creationReward + firstStarReward
    if (totalReward === 0) return null

    const newBalance = currentStardust + totalReward
    transaction.update(userRef, {
      stardust: newBalance,
      createdStarsToday,
      lastStarCreationDate: todayUTC,
    })

    // Audit logs DENTRO de la transaccion
    const txNow = new Date().toISOString()
    if (creationReward > 0) {
      const txDocRef = userRef.collection('transactions').doc()
      transaction.set(txDocRef, {
        type: 'earn', amount: creationReward, reason: 'star_creation',
        itemId: null, balanceAfter: currentStardust + creationReward, createdAt: txNow,
      } satisfies TransactionRecord)
    }
    if (firstStarReward > 0) {
      const txDocRef = userRef.collection('transactions').doc()
      transaction.set(txDocRef, {
        type: 'earn', amount: firstStarReward, reason: 'first_star_bonus',
        itemId: null, balanceAfter: newBalance, createdAt: txNow,
      } satisfies TransactionRecord)
    }

    return { totalReward }
  })

  if (rewardResult) {
    stardustEarned = rewardResult.totalReward
  }
} catch (rewardError) {
  console.error('Star creation reward failed (non-blocking):', rewardError)
}
```

### Cambios clave

1. **`isFirstStar` movido dentro de `runTransaction`** — La query de stars ahora usa `transaction.get()` en vez de `db.collection().get()`. **Importante: la proteccion contra la race condition viene de la contencion en `userRef`, no del `transaction.get()` de stars per se.** El mecanismo es: ambas transacciones hacen `transaction.get(userRef)` y luego `transaction.update(userRef)`. Firestore detecta el conflicto en `userRef` (ambas leyeron el mismo documento que ambas intentan escribir) y reintenta la transaccion que pierde. En el retry, `starRef.set()` (que esta fuera de la transaccion y se ejecuto antes de `runTransaction`) ya committeo, asi que la query de stars ve la estrella existente y `isFirstStar === false`. La lectura transaccional de stars no genera contencion por si sola — es el conflicto en `userRef` el que fuerza el retry.
2. **`starRef.set(starData)` permanece fuera** — La creacion de la estrella es el contenido del usuario. Si la transaccion de reward falla o reintenta, la estrella ya existe. Esto es intencional: el reward es best-effort, la estrella no.
3. **Audit logs dentro de la transaccion** — Usan `transaction.set()` con `.doc()` (auto-ID) en vez de `.add()`. Firestore transactions no soportan `.add()` directamente.
4. **`DocumentReference` ya no se necesita en imports** — Se elimina del import en linea 7 ya que `txPromises: Promise<DocumentReference>[]` desaparece.
5. **`rewardResult` simplificado** — Solo retorna `{ totalReward }`. Los valores internos (`creationReward`, `firstStarReward`, `newBalance`, `currentStardust`) ya no se necesitan fuera de la transaccion porque los audit logs se escriben dentro.

### Cambio en imports

**Linea 7 — eliminar import no usado:**

```typescript
// ANTES:
import type { DocumentReference } from '@google-cloud/firestore'

// DESPUES: (eliminar la linea completa)
```

### Decisiones de diseno

- **`transaction.get()` para query cross-coleccion.** Firestore soporta reads de multiples colecciones en una transaccion. La query de stars es `limit(1)`, asi que el costo adicional es minimo.
- **Por que no usar un flag `firstStarClaimed` en UserRecord.** La alternativa mencionada en la auditoria (un booleano idempotente) evitaria la query pero introduce un campo extra que solo se usa una vez. La query dentro de la transaccion es la solucion mas simple y no requiere cambios en el modelo de datos.
- **Por que no mover `starRef.set()` dentro de la transaccion.** Si lo movieramos, un retry de transaccion podria fallar con "document already exists" si el primer intento creo la estrella antes de que la transaccion hiciera commit. Mantenerlo fuera es mas robusto: la estrella siempre se crea, el reward es bonus.
- **Atomicidad total del reward.** Balance + audit logs (hasta 4 operaciones: 1 update + 1-2 set) son atomicos. Si cualquiera falla, ninguno se aplica.

---

## Fix 2: TransactionRecord dentro de la transaccion en shop.ts [M1 — Severidad Media]

### Problema

El `TransactionRecord` de auditoria se escribe FUERA del `runTransaction` en linea 89. Si la funcion crashea despues del commit de la transaccion pero antes del write, el balance se actualiza sin registro.

### Codigo actual (`shop.ts:77-89`)

```typescript
    return { newBalance, itemId: item.itemId }
  })

  // Audit log (append-only, outside transaction)
  const txRecord: TransactionRecord = {
    type: 'spend',
    amount: item.price,
    reason: 'shop_purchase',
    itemId: item.itemId,
    balanceAfter: result.newBalance,
    createdAt: nowISO,
  }
  await userRef.collection('transactions').add(txRecord)
```

### Codigo propuesto

Reemplaza lineas 74-89 (desde `const newDocRef` hasta `await userRef.collection`):

```typescript
    const newDocRef = userRef.collection('inventory').doc()
    transaction.create(newDocRef, inventoryDoc)

    // Audit log DENTRO de la transaccion
    const txDocRef = userRef.collection('transactions').doc()
    transaction.set(txDocRef, {
      type: 'spend',
      amount: item.price,
      reason: 'shop_purchase',
      itemId: item.itemId,
      balanceAfter: newBalance,
      createdAt: nowISO,
    } satisfies TransactionRecord)

    return { newBalance, itemId: item.itemId }
  })
```

### Cambios clave

1. **`transaction.set()` en vez de `.add()`** — Misma estrategia que SPEC-Pagos-Wompi Fix 3: `.doc()` genera auto-ID, `.set()` escribe dentro de la transaccion.
2. **Eliminado bloque post-transaccion** — Las lineas 80-89 (comentario + txRecord + await add) se eliminan completamente.
3. **`result.newBalance` → `newBalance`** — Se usa directamente la variable local dentro del callback.
4. **4 operaciones en transaccion** — update user, create inventory, set audit log, mas el get inicial. Muy por debajo del limite de 500 de Firestore.

### Decisiones de diseno

- **Mismo patron que SPEC-Pagos-Wompi Fix 3.** Consistencia en el approach de audit logs atomicos.
- **Sin try/catch extra.** Si el audit log falla, toda la transaccion falla — la compra no se aplica. Esto es correcto: para compras, preferimos que falle todo a que el balance cambie sin registro. Diferente al patron de `economy.ts` donde el reward es best-effort.

---

## Fix 3: TransactionRecord dentro de la transaccion en invitePublic.ts [M1 — Severidad Media]

### Problema

En `acceptInviteHandler`, el audit log de reward se escribe FUERA de la transaccion de reward (linea 122). Si crashea entre el commit y el write, el balance cambia sin registro.

### Codigo actual (`invitePublic.ts:107-123`)

```typescript
        return { reward: INVITE_ACCEPTED_REWARD, newBalance }
      })

      if (rewardResult) {
        stardustEarned = rewardResult.reward
        const tx: TransactionRecord = {
          type: 'earn',
          amount: rewardResult.reward,
          reason: 'invite_accepted',
          itemId: null,
          balanceAfter: rewardResult.newBalance,
          createdAt: new Date().toISOString(),
        }
        await userRef.collection('transactions').add(tx)
      }
```

### Codigo propuesto

Reemplaza lineas 101-123 (desde `const newBalance` hasta `await userRef.collection`):

```typescript
        const newBalance = currentStardust + INVITE_ACCEPTED_REWARD
        transaction.update(userRef, {
          stardust: newBalance,
          acceptedInvitesToday,
          lastInviteAcceptDate: todayUTC,
        })

        // Audit log DENTRO de la transaccion
        const txDocRef = userRef.collection('transactions').doc()
        transaction.set(txDocRef, {
          type: 'earn',
          amount: INVITE_ACCEPTED_REWARD,
          reason: 'invite_accepted',
          itemId: null,
          balanceAfter: newBalance,
          createdAt: new Date().toISOString(),
        } satisfies TransactionRecord)

        return { reward: INVITE_ACCEPTED_REWARD }
      })

      if (rewardResult) {
        stardustEarned = rewardResult.reward
      }
```

### Cambios clave

1. **Audit log dentro de la transaccion** — `transaction.set()` con auto-ID doc.
2. **`newBalance` eliminado del return** — Ya no se necesita fuera de la transaccion porque el audit log se escribe dentro.
3. **Bloque post-transaccion simplificado** — Solo asigna `stardustEarned`.

### Decisiones de diseno

- **La transaccion de reward SIGUE siendo separada de `acceptInvite()`.** Ver Fix 5 para documentacion de este trade-off.
- **Best-effort preservado.** El try/catch exterior (linea 124-126) sigue capturando errores de la transaccion de reward sin bloquear la respuesta de aceptacion de invite.

---

## Fix 4: Refactorizar variables mutables + consolidar audit logs en economy.ts [B1+M1 — Severidad Baja]

### Problema

1. **Variables mutables fuera de transaccion** (`economy.ts:39-42`): `rewardsDaily`, `rewardsWeekly`, `rewardsStreak`, `streakDays` se declaran fuera del `runTransaction` y se mutan dentro. El patron es fragil — si se agrega logica entre la declaracion y la transaccion, los valores quedan stale.
2. **1-3 audit logs fuera de transaccion** (lineas 147-191): Si crashea entre el commit y los writes, el balance cambia sin registro. El `try/catch` en lineas 187-191 silencia errores, que es una mitigacion parcial.

### Codigo actual (`economy.ts:39-49, 132-191`)

```typescript
// Variables mutables fuera de transaccion (lineas 39-42)
let rewardsDaily = 0
let rewardsWeekly = 0
let rewardsStreak = 0
let streakDays = 0

const result = await db.runTransaction(async (transaction: Transaction) => {
  // Reset en cada intento (lineas 46-49)
  rewardsDaily = 0
  rewardsWeekly = 0
  rewardsStreak = 0
  streakDays = 0

  // ... logica de transaccion ...

  return {
    stardust: newStardust,
    loginStreak: newStreak,
    previousStreak: newPreviousStreak,
    lastDailyRewardDate: todayUTC,
    weeklyBonusWeek: newWeeklyBonusWeek,
    previousStardust: stardust,
  }
})

// ... (lineas 147-191: 1-3 audit logs fuera de transaccion) ...
const txPromises: Promise<DocumentReference>[] = []

if (rewardsDaily > 0) {
  const tx: TransactionRecord = { ... }
  txPromises.push(userRef.collection('transactions').add(tx))
}
if (rewardsWeekly > 0) {
  const tx: TransactionRecord = { ... }
  txPromises.push(userRef.collection('transactions').add(tx))
}
if (rewardsStreak > 0) {
  const tx: TransactionRecord = { ... }
  txPromises.push(userRef.collection('transactions').add(tx))
}

try {
  await Promise.all(txPromises)
} catch (logError) {
  console.error('Failed to create audit log (balance already updated):', logError instanceof Error ? logError.message : logError)
}
```

### Cambios requeridos

#### 4a. Agregar campo `details` a TransactionRecord (`contracts.ts:95-102`)

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

#### 4b. Refactorizar economy.ts

**Eliminar variables mutables** (lineas 39-42) y **eliminar el import de `DocumentReference`** (linea 5):

```typescript
// ANTES (linea 5):
import type { DocumentReference, QueryDocumentSnapshot, Transaction } from '@google-cloud/firestore'

// DESPUES:
import type { QueryDocumentSnapshot, Transaction } from '@google-cloud/firestore'
```

**Reemplazar la transaccion y audit logs** (lineas 39-191). El nuevo codigo retorna rewards como parte del resultado de la transaccion y escribe un solo audit log consolidado dentro:

```typescript
const result = await db.runTransaction(async (transaction: Transaction) => {
  const userSnap = await transaction.get(userRef)

  if (!userSnap.exists) {
    return null
  }

  const rawData = userSnap.data()!

  const stardust = typeof rawData.stardust === 'number' ? rawData.stardust : DEFAULT_USER_ECONOMY.stardust
  const loginStreak = typeof rawData.loginStreak === 'number' ? rawData.loginStreak : DEFAULT_USER_ECONOMY.loginStreak
  const previousStreak = typeof rawData.previousStreak === 'number' ? rawData.previousStreak : DEFAULT_USER_ECONOMY.previousStreak
  const lastDailyRewardDate = typeof rawData.lastDailyRewardDate === 'string' ? rawData.lastDailyRewardDate : DEFAULT_USER_ECONOMY.lastDailyRewardDate
  const weeklyBonusWeek = typeof rawData.weeklyBonusWeek === 'string' ? rawData.weeklyBonusWeek : DEFAULT_USER_ECONOMY.weeklyBonusWeek

  if (lastDailyRewardDate === todayUTC) {
    return {
      stardust,
      loginStreak,
      previousStreak,
      lastDailyRewardDate,
      weeklyBonusWeek,
      previousStardust: stardust,
      rewards: { daily: 0, weekly: 0, streak: 0, streakDays: 0 },
    }
  }

  // Daily login reward
  const rewardsDaily = DAILY_LOGIN_REWARD

  // Streak calculation
  let newStreak: number
  let newPreviousStreak = previousStreak
  const yesterday = getYesterday(todayUTC)

  if (lastDailyRewardDate === yesterday) {
    newStreak = loginStreak + 1
  } else {
    newPreviousStreak = loginStreak
    newStreak = 1
  }

  // Streak bonuses
  let rewardsStreak = 0
  if (newStreak === 7) {
    rewardsStreak = STREAK_7_BONUS
  } else if (newStreak === 30) {
    rewardsStreak = STREAK_30_BONUS
  }

  // Weekly bonus
  let rewardsWeekly = 0
  let newWeeklyBonusWeek = weeklyBonusWeek
  if (weeklyBonusWeek !== currentWeek) {
    rewardsWeekly = WEEKLY_BONUS
    newWeeklyBonusWeek = currentWeek
  }

  const totalRewards = rewardsDaily + rewardsWeekly + rewardsStreak
  const newStardust = stardust + totalRewards

  const updatePayload: Record<string, unknown> = {
    stardust: newStardust,
    lastDailyRewardDate: todayUTC,
    loginStreak: newStreak,
    previousStreak: newPreviousStreak,
    weeklyBonusWeek: newWeeklyBonusWeek,
  }

  const lastStarDate = typeof rawData.lastStarCreationDate === 'string' ? rawData.lastStarCreationDate : null
  const lastInviteDate = typeof rawData.lastInviteAcceptDate === 'string' ? rawData.lastInviteAcceptDate : null

  if (lastStarDate !== todayUTC) {
    updatePayload.createdStarsToday = 0
    updatePayload.lastStarCreationDate = null
  }

  if (lastInviteDate !== todayUTC) {
    updatePayload.acceptedInvitesToday = 0
    updatePayload.lastInviteAcceptDate = null
  }

  transaction.update(userRef, updatePayload)

  // Audit log consolidado DENTRO de la transaccion
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

  return {
    stardust: newStardust,
    loginStreak: newStreak,
    previousStreak: newPreviousStreak,
    lastDailyRewardDate: todayUTC,
    weeklyBonusWeek: newWeeklyBonusWeek,
    previousStardust: stardust,
    rewards: { daily: rewardsDaily, weekly: rewardsWeekly, streak: rewardsStreak, streakDays: newStreak },
  }
})

if (result === null) {
  res.status(404).json({ error: 'Usuario no encontrado' })
  return
}
```

**Actualizar la respuesta** (lineas 193-213). Reemplazar el uso de variables externas por `result.rewards`:

```typescript
// Read inventory
const inventorySnap = await userRef.collection('inventory').get()

const inventory: InventoryItem[] = inventorySnap.docs.map(
  (doc: QueryDocumentSnapshot) => doc.data() as InventoryItem,
)

res.status(200).json({
  stardust: result.stardust,
  loginStreak: result.loginStreak,
  previousStreak: result.previousStreak,
  lastDailyRewardDate: result.lastDailyRewardDate,
  weeklyBonusWeek: result.weeklyBonusWeek,
  inventory,
  rewards: result.rewards,
})
```

### Cambios clave

1. **Variables mutables eliminadas.** `rewardsDaily`, `rewardsWeekly`, `rewardsStreak`, `streakDays` ya no existen fuera del closure. Se declaran como `const`/`let` DENTRO del callback de transaccion y se retornan en `result.rewards`.
2. **1-3 audit logs → 1 audit log consolidado.** Un solo `TransactionRecord` con `reason: 'daily_rewards'`, `amount: totalRewards`, y `details: [...]` que preserva el desglose. Reduce writes de 1-3 a 1.
3. **Audit log dentro de la transaccion.** `transaction.set()` con auto-ID. Si falla, el balance NO se actualiza. Atomicidad total.
4. **try/catch de audit eliminado.** Ya no es necesario: el audit log es parte de la transaccion. Si falla, todo falla.
5. **`DocumentReference` eliminado del import.** Ya no hay `txPromises: Promise<DocumentReference>[]`.

### Decisiones de diseno

- **Un solo documento con `details[]` en vez de 1-3 documentos separados.** El campo `amount` tiene el total, `details` preserva el desglose para debugging. `getTransactions` retorna `reason` y `amount` del doc principal — el frontend no necesita parsear `details`. Esto tambien simplifica la logica: 1 `transaction.set()` en vez de 1-3 `add()` condicionales.
- **`details?` es opcional** para backward compatibility. Los `TransactionRecord` existentes sin `details` son validos.
- **`reason: 'daily_rewards'` en vez de `'daily_login'`.** El log consolidado agrupa todas las recompensas del login diario. El `reason` principal ya no es `'daily_login'` porque el doc puede contener weekly y streak tambien.
- **No necesita reset en retry.** Las variables son locales al closure, asi que cada retry naturalmente recalcula desde cero. Esto elimina el patron fragil de "resetear al inicio de cada intento".

### Impacto en `getTransactions` y frontend

- **`getTransactions`** (`economy.ts:220-265`) retorna `reason`, `amount`, `balanceAfter` — sin cambios. El campo `details` se retorna automaticamente si existe (Firestore lo incluye en el snapshot). **Verificado:** No hay queries de Firestore que filtren por `reason` en la coleccion `transactions`. El unico acceso es `orderBy('createdAt', 'desc')` con paginacion por cursor.
- **Frontend — cambio requerido:** `TransactionHistory.tsx:11-21` y `StardustToast.tsx:3-8` usan un mapa `REASON_LABELS` para traducir `reason` a texto legible. El nuevo reason `'daily_rewards'` NO tiene label en esos mapas — se mostraria como texto crudo `"daily_rewards"`. Este cambio es necesario:

**`frontend/src/components/economy/TransactionHistory.tsx:11-21` — agregar label:**

```typescript
const REASON_LABELS: Record<string, string> = {
  welcome: 'Bienvenida',
  daily_login: 'Login diario',
  daily_rewards: 'Recompensas diarias',   // NUEVO: audit log consolidado
  star_creation: 'Estrella creada',
  first_star_bonus: 'Primera estrella',
  streak_7: 'Racha de 7 días',
  streak_30: 'Racha de 30 días',
  invite_accepted: 'Invitación aceptada',
  weekly_bonus: 'Bonus semanal',
  shop_purchase: 'Compra',
}
```

**Nota:** Se conserva `daily_login` para registros historicos que ya existen en Firestore con ese reason. Los nuevos registros usaran `daily_rewards`. Ambos labels coexisten.

**`StardustToast.tsx` no necesita cambios** — el toast de stardust solo se muestra para `star_creation`, `first_star_bonus`, `invite_accepted` y `purchase`. Las recompensas diarias se muestran via el modal de `DailyRewardModal`, no via toast.

---

## Fix 5: Documentar trade-off de acceptInvite separado [B2 — Severidad Baja]

### Problema

La recompensa por aceptar invitacion se maneja en una transaccion SEPARADA de `acceptInvite()`. Si la transaccion de reward falla, el usuario acepta la invite sin recibir PE. Este es un trade-off de diseno aceptable pero no esta documentado.

### Archivo y ubicacion

`functions/src/handlers/invitePublic.ts` — agregar comentario antes de linea 84 (antes del `try` del bloque de reward).

### Comentario a agregar

```typescript
// Trade-off de diseno: la recompensa de PE es una transaccion SEPARADA de acceptInvite().
// acceptInvite() opera sobre invite+member (coleccion skies), el reward opera sobre el user.
// Si el reward falla, el usuario acepta la invite pero no recibe PE — la membresía es
// la operacion primaria. Combinar ambas transacciones aumentaria la superficie de contencion
// sin beneficio proporcional, ya que el reward es best-effort (try/catch no-bloqueante).
```

### Decisiones de diseno

- **Solo documentacion, no cambio de codigo.** El trade-off es aceptable: la membresia es lo que el usuario necesita, el PE es bonus. Combinar ambas transacciones introduciria reads de colecciones adicionales (invites + members + users) en una sola transaccion, aumentando la probabilidad de contention y retry.
- **El try/catch no-bloqueante** (linea 124-126) ya mitiga el impacto: el usuario recibe su respuesta exitosa independientemente del reward.

---

## Plan de tests

### Mocks comunes: agregar `transaction.set` y `transactions.doc`

Todos los test files afectados necesitan:
1. `set: vi.fn()` en el mock de `transaction`
2. Un mock de `.doc()` en la subcoleccion `transactions` que retorne un ref para `transaction.set`

### stars.test.ts — Cambios de mocks

**En `vi.hoisted()` (linea 8-32):**

Agregar `set` al mock de transaction:

```typescript
const transaction = { get: vi.fn(), update: vi.fn(), set: vi.fn() }
```

Agregar mock de doc para transactions:

```typescript
const txDocRef = { id: 'tx-doc-ref' }
const userRef = {
  collection: vi.fn((name: string) => {
    if (name === 'transactions') return { add: txAdd, doc: vi.fn().mockReturnValue(txDocRef) }
    return {}
  }),
}
```

Actualizar return del hoisted:

```typescript
return { transaction, txAdd, txDocRef, starSet, starsQueryGet, starsChain, userRef, runTransaction }
```

**En `beforeEach` (linea 78-95):**

Agregar reset de `set` y actualizar mock de userRef.collection:

```typescript
mocks.transaction.set.mockReset()
mocks.userRef.collection.mockImplementation((name: string) => {
  if (name === 'transactions') return { add: mocks.txAdd, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
  return {}
})
```

### stars.test.ts — Cambios en tests existentes

El cambio critico es que `transaction.get` ahora se llama **dos veces**: primero para el `userRef`, luego para la query de stars. Los tests que verifican el mock de `transaction.get` necesitan ajustarse.

**Test "otorga STAR_CREATION_REWARD" (linea 100-113):**

```typescript
it('otorga STAR_CREATION_REWARD al crear estrella', async () => {
  mocks.transaction.get
    .mockResolvedValueOnce({
      data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
    })
    .mockResolvedValueOnce({ empty: false })  // No es primera estrella

  const res = makeRes()
  await createStar(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(201)
  expect(mocks.transaction.update).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ stardust: 105 }),
  )
})
```

**Test "otorga FIRST_STAR_BONUS" (linea 115-129):**

```typescript
it('otorga FIRST_STAR_BONUS si es primera estrella en cielo', async () => {
  mocks.transaction.get
    .mockResolvedValueOnce({
      data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
    })
    .mockResolvedValueOnce({ empty: true })  // Primera estrella

  const res = makeRes()
  await createStar(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(201)
  expect(mocks.transaction.update).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ stardust: 130 }),
  )
})
```

**Test "respeta cap diario" (linea 131-143):**

```typescript
it('respeta cap diario de MAX_STARS_REWARD_PER_DAY', async () => {
  mocks.transaction.get
    .mockResolvedValueOnce({
      data: () => ({ stardust: 100, createdStarsToday: 10, lastStarCreationDate: TODAY }),
    })
    .mockResolvedValueOnce({ empty: false })

  const res = makeRes()
  await createStar(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(201)
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({ rewards: expect.objectContaining({ stardustEarned: 0 }) }),
  )
})
```

**Test "resetea contador si es nuevo dia" (linea 145-158):**

```typescript
it('resetea contador si es nuevo dia', async () => {
  mocks.transaction.get
    .mockResolvedValueOnce({
      data: () => ({ stardust: 100, createdStarsToday: 10, lastStarCreationDate: YESTERDAY }),
    })
    .mockResolvedValueOnce({ empty: false })

  const res = makeRes()
  await createStar(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(201)
  expect(mocks.transaction.update).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ stardust: 105, createdStarsToday: 1 }),
  )
})
```

**Test "reward es best-effort" (linea 160-171):** Sin cambios. `runTransaction.mockRejectedValue` sigue funcionando.

**Nota:** El mock `starsQueryGet` (linea 12) ya NO se usa directamente en los tests. Se reemplaza por `mockResolvedValueOnce({ empty: ... })` en `transaction.get`. El mock se puede mantener para otros tests futuros o eliminar.

### stars.test.ts — Nuevo test

```typescript
it('escribe audit logs dentro de la transaccion con transaction.set', async () => {
  mocks.transaction.get
    .mockResolvedValueOnce({
      data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
    })
    .mockResolvedValueOnce({ empty: true })  // Primera estrella → 2 audit logs

  const res = makeRes()
  await createStar(makeReq(), res)

  // Verifica que transaction.set fue llamado para audit logs (creacion + first star)
  expect(mocks.transaction.set).toHaveBeenCalledTimes(2)
  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'earn', reason: 'star_creation', amount: 5 }),
  )
  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: 'earn', reason: 'first_star_bonus', amount: 25 }),
  )
  // El add fuera de la transaccion ya no debe ocurrir
  expect(mocks.txAdd).not.toHaveBeenCalled()
})
```

### shop.test.ts — Cambios de mocks

**En `vi.hoisted()` (linea 6-28):**

Agregar `set` al mock de transaction:

```typescript
const transaction = {
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  set: vi.fn(),
}
```

Agregar `txDocRef` y actualizar userRef.collection para soportar `.doc()` en transactions:

```typescript
const txDocRef = { id: 'tx-doc-ref' }

const userRef = {
  collection: vi.fn((name: string) => {
    if (name === 'inventory') return { doc: vi.fn().mockReturnValue(inventoryDocRef), get: inventoryGet }
    if (name === 'transactions') return { add, doc: vi.fn().mockReturnValue(txDocRef) }
    return {}
  }),
}
```

Agregar `txDocRef` al return del hoisted:

```typescript
return { transaction, add, txDocRef, inventoryGet, inventoryDocRef, userRef, runTransaction }
```

**En `beforeEach` (linea 70-83):**

Agregar reset de `set` y actualizar mock de userRef.collection:

```typescript
mocks.transaction.set.mockReset()
mocks.userRef.collection.mockImplementation((name: string) => {
  if (name === 'inventory') return { doc: vi.fn().mockReturnValue(mocks.inventoryDocRef), get: mocks.inventoryGet }
  if (name === 'transactions') return { add: mocks.add, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
  return {}
})
```

### shop.test.ts — Test actualizado

**Test "crea TransactionRecord de audit" (linea 162-176):**

```typescript
it('crea TransactionRecord de audit dentro de la transaccion', async () => {
  setupPurchase({ stardust: 1000 })

  const res = makeRes()
  await purchase(makeReq({ itemId: 'theme-aurora-borealis' }), res)

  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      type: 'spend',
      amount: 800,
      reason: 'shop_purchase',
      itemId: 'theme-aurora-borealis',
    }),
  )
  // El add fuera de la transaccion ya no debe ocurrir
  expect(mocks.add).not.toHaveBeenCalled()
})
```

### invitePublic.test.ts — Cambios de mocks

**En `vi.hoisted()` (linea 7-29):**

Agregar `set` al mock de transaction:

```typescript
const transaction = { get: vi.fn(), update: vi.fn(), set: vi.fn() }
```

Agregar `txDocRef` y actualizar userRef.collection:

```typescript
const txDocRef = { id: 'tx-doc-ref' }

const userRef = {
  get: userGet,
  collection: vi.fn((name: string) => {
    if (name === 'transactions') return { add: txAdd, doc: vi.fn().mockReturnValue(txDocRef) }
    return {}
  }),
}
```

Agregar `txDocRef` al return del hoisted:

```typescript
return { transaction, txAdd, txDocRef, userGet, membersGet, membersQuery, userRef, runTransaction }
```

**En `beforeEach` (linea 76-89):**

Agregar reset de `set` y actualizar mock de userRef.collection:

```typescript
mocks.transaction.set.mockReset()
mocks.userRef.collection.mockImplementation((name: string) => {
  if (name === 'transactions') return { add: mocks.txAdd, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
  return {}
})
```

### invitePublic.test.ts — Nuevo test

```typescript
it('escribe audit log dentro de la transaccion con transaction.set', async () => {
  mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
  mocks.membersGet.mockResolvedValue({ size: 5 })
  mocks.transaction.get.mockResolvedValue({
    data: () => ({ stardust: 100, acceptedInvitesToday: 0, lastInviteAcceptDate: null }),
  })

  const res = makeRes()
  await acceptInviteHandler(makeReq(), res)

  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      type: 'earn',
      amount: 30,
      reason: 'invite_accepted',
    }),
  )
  // El add fuera de la transaccion ya no debe ocurrir
  expect(mocks.txAdd).not.toHaveBeenCalled()
})
```

### economy.test.ts — Cambios de mocks

**En `vi.hoisted()` (linea 12-47):**

Agregar `set` al mock de transaction:

```typescript
const transaction = {
  get: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
}
```

Agregar `txDocRef` y actualizar `txCollection` para soportar `.doc()`:

```typescript
const txDocRef = { id: 'tx-doc-ref' }

const txCollection: Record<string, ReturnType<typeof vi.fn>> = {
  add,
  doc: vi.fn().mockReturnValue(txDocRef),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  get: queryGet,
}
```

Actualizar return del hoisted:

```typescript
return { transaction, add, txDocRef, inventoryGet, queryGet, docGet, txCollection, userRef, runTransaction }
```

**En `beforeEach` (linea 86-99):**

Agregar reset de `set`:

```typescript
mocks.transaction.set.mockReset()
mocks.txCollection.doc.mockReturnValue(mocks.txDocRef)
```

### economy.test.ts — Nuevo test

```typescript
it('escribe audit log consolidado dentro de la transaccion', async () => {
  mocks.transaction.get.mockResolvedValue(userSnap({
    stardust: 100, loginStreak: 0, previousStreak: 0,
    lastDailyRewardDate: null, weeklyBonusWeek: null,
  }))

  const res = makeRes()
  await getEconomy(makeReq(), res)

  // Un solo audit log consolidado con details
  expect(mocks.transaction.set).toHaveBeenCalledTimes(1)
  expect(mocks.transaction.set).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      type: 'earn',
      amount: 35,  // 15 daily + 20 weekly
      reason: 'daily_rewards',
      details: expect.arrayContaining([
        expect.objectContaining({ amount: 15, reason: 'daily_login' }),
        expect.objectContaining({ amount: 20, reason: 'weekly_bonus' }),
      ]),
    }),
  )
  // El add fuera de la transaccion ya no debe ocurrir
  expect(mocks.add).not.toHaveBeenCalled()
})
```

---

## Conteo esperado de tests

| Test file | Antes | Despues | Delta |
|-----------|-------|---------|-------|
| `stars.test.ts` | 5 | 6 | +1 nuevo |
| `shop.test.ts` | 7 | 7 | 0 (1 actualizado) |
| `invitePublic.test.ts` | 3 | 4 | +1 nuevo |
| `economy.test.ts` | 14 | 15 | +1 nuevo |
| **Total** | **29** | **32** | **+3** |

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad y riesgo.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | Fix 5 — Documentar trade-off acceptInvite | Minima | 1 comentario, sin tests. Cero riesgo. |
| 2 | Fix 2 — shop.ts audit log atomico | Baja | Patron simple: mover 1 write dentro de txn. 1 test actualizado. |
| 3 | Fix 3 — invitePublic.ts audit log atomico | Baja | Mismo patron que Fix 2. 1 test nuevo. |
| 4 | Fix 4 — economy.ts refactor + audit consolidado | Media | Cambio de tipo en contracts.ts + reestructura. 1 test nuevo. |
| 5 | Fix 1 — stars.ts isFirstStar (CRITICO) | Media-Alta | Todos los reward tests necesitan actualizacion de mocks. |

### Dependencias entre cambios (internas)

- **Fix 4** modifica `TransactionRecord` en `contracts.ts` — debe implementarse ANTES de Fix 1 si Fix 1 usa `satisfies TransactionRecord` con el tipo actualizado. Sin embargo, el tipo `details` es opcional, asi que el orden no es estricto.
- **Fix 2 y Fix 3** son independientes entre si y del resto.
- **Fix 5** no tiene dependencias.

### Prerequisitos cross-spec

Este SPEC modifica `functions/src/domain/contracts.ts` (Fix 4 agrega `details?` a `TransactionRecord`). Otros SPECs tambien tocan ese archivo:

- **SPEC-Pagos-Wompi** Fix 7: elimina `bonusPercent` de `StardustPackage` en `contracts.ts:121-127`
- **SPEC-autenticacion** Fix 1: elimina `sessionVersion` de `UserRecord` en `contracts.ts:29`

**Ninguno modifica `TransactionRecord`**, asi que no hay conflicto de merge directo. Sin embargo, para evitar conflictos de lineas adyacentes en `contracts.ts`, el orden de implementacion cross-spec recomendado es:

1. **SPEC-Pagos-Wompi** (no toca `TransactionRecord`)
2. **SPEC-autenticacion** (no toca `TransactionRecord`)
3. **Este SPEC de atomicidad** (agrega `details?` a `TransactionRecord`)

Si se implementan fuera de orden, el unico riesgo es un conflicto de merge trivial en `contracts.ts` (lineas no superpuestas).

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/stars.test.ts
cd functions && npx vitest run src/handlers/shop.test.ts
cd functions && npx vitest run src/handlers/economy.test.ts
cd functions && npx vitest run src/handlers/invitePublic.test.ts
cd functions && npx tsc --noEmit
```

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| `transaction.get()` en query de stars agrega latencia (Fix 1) | Baja | `limit(1)` minimiza el costo. Un read adicional por transaccion. |
| Mocks de `transaction.get` con multiples calls se confunden (Fix 1) | Media | Usar `mockResolvedValueOnce` en orden estricto: primero userRef, luego starsQuery. |
| Campo `details` confunde al frontend (Fix 4) | Muy baja | Campo es opcional. Frontend usa `reason` y `amount` del doc principal. |
| `REASON_LABELS` del frontend no tiene `daily_rewards` (Fix 4) | Alta si no se actualiza | Se documenta el cambio requerido en `TransactionHistory.tsx:11-21`. Se conserva `daily_login` para registros historicos. |
| No hay queries de Firestore por `reason` en transactions | Verificado | `getTransactions` solo usa `orderBy('createdAt')` con paginacion. No hay `.where('reason', ...)` en ningun handler. |
| `satisfies TransactionRecord` falla si tipo no tiene `details` (Fix 1, 2, 3) | Nula | `details` es opcional (`?`). Los `satisfies` sin `details` siguen siendo validos. |
