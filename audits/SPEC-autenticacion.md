# SPEC: Correcciones a Autenticacion y Autorizacion

**Fecha:** 2026-03-27
**Estado:** Pendiente
**Origen:** `audits/03-autenticacion.md` (auditoria de seguridad)
**Archivos afectados:**
- `functions/src/middleware/auth.ts` (middleware de autenticacion)
- `functions/src/middleware/cors.ts` (middleware CORS)
- `functions/src/handlers/userSync.ts` (sincronizacion de usuario)
- `functions/src/handlers/userSync.test.ts` (tests de userSync)
- `functions/src/middleware/auth.test.ts` (tests nuevos)
- `functions/src/domain/contracts.ts` (tipos backend)
- `frontend/src/domain/contracts.ts` (tipos frontend)

## Contexto

Una auditoria de seguridad identifico 2 hallazgos medios y 1 bajo en el flujo de autenticacion. La autenticacion es solida en su nucleo — Bearer token verificado por Firebase Admin SDK, aplicado en cada handler. Sin embargo, `sessionVersion` se inicializa pero nunca se valida (tokens revocados siguen funcionando hasta expirar), la creacion de usuarios nuevos tiene una race condition que puede duplicar el `TransactionRecord` de welcome bonus, y CORS permite `localhost:5173` en produccion.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 1: Habilitar checkRevoked y eliminar sessionVersion [M1 — Severidad Media]

### Problema

`authenticateRequest()` llama a `auth.verifyIdToken(token)` sin el segundo parametro `checkRevoked`. Esto significa que si se revocan los refresh tokens de un usuario (cuenta comprometida, cambio de password), los ID tokens existentes siguen siendo validos hasta su expiracion natural (1 hora). No hay forma de invalidar sesiones activas.

Adicionalmente, el campo `sessionVersion` se inicializa a `1` en `userSync.ts:87` (usuario nuevo) y `userSync.ts:72` (migracion de usuario existente), existe en el tipo `UserRecord` (`contracts.ts:29`), pero **nunca se incrementa ni se compara**. Es codigo muerto que crea una falsa sensacion de seguridad.

### Cambios requeridos

**1a. `auth.ts:11` — Habilitar checkRevoked:**

```typescript
// ANTES:
return auth.verifyIdToken(token)

// DESPUES:
return auth.verifyIdToken(token, true)
```

**1b. `functions/src/domain/contracts.ts:29` — Eliminar `sessionVersion` del tipo:**

```typescript
// ANTES (contracts.ts:20-41):
export interface UserRecord {
  displayName: string | null
  email: string
  photoURL: string | null
  providers: string[]
  emailVerifiedAt: IsoDateString | null
  createdAt: IsoDateString
  lastLoginAt: IsoDateString | null
  status: UserStatus
  sessionVersion: number      // ← ELIMINAR
  stardust: number
  maxSkies: number
  // ...resto igual
}

// DESPUES:
export interface UserRecord {
  displayName: string | null
  email: string
  photoURL: string | null
  providers: string[]
  emailVerifiedAt: IsoDateString | null
  createdAt: IsoDateString
  lastLoginAt: IsoDateString | null
  status: UserStatus
  stardust: number
  maxSkies: number
  // ...resto igual
}
```

**1c. `frontend/src/domain/contracts.ts:29` — Eliminar `sessionVersion` del tipo frontend:**

Mismo cambio que 1b. El frontend tiene su propia copia del tipo `UserRecord`. El campo no se usa en ningun componente, hook ni logica del frontend — solo esta en la definicion del tipo.

**1d. `userSync.ts:87` — Eliminar `sessionVersion` del objeto de usuario nuevo:**

```typescript
// ANTES (userSync.ts:86-87):
    status: 'active',
    sessionVersion: 1,       // ← ELIMINAR
    stardust: WELCOME_BONUS,

// DESPUES:
    status: 'active',
    stardust: WELCOME_BONUS,
```

**1e. `userSync.ts:72` — Eliminar `sessionVersion` de la migracion de usuario existente:**

```typescript
// ANTES (userSync.ts:71-72):
            status: 'active',
            sessionVersion: 1,       // ← ELIMINAR

// DESPUES:
            status: 'active',
```

### Decisiones de diseno

- **`checkRevoked: true` en lugar de implementar sessionVersion manualmente.** Firebase ya tiene un mecanismo nativo para revocar sesiones: `auth.revokeRefreshTokens(uid)` invalida todos los refresh tokens, y `verifyIdToken(token, true)` detecta tokens cuyo refresh token fue revocado. Implementar sessionVersion requeriria: (a) un Firestore read por request para obtener la version almacenada, (b) custom claims en el token con la version, (c) logica para comparar ambas versiones. `checkRevoked` logra lo mismo con un solo parametro.
- **Tradeoff de `checkRevoked` — dependencia de red.** Sin `checkRevoked`, `verifyIdToken` es una operacion **puramente local**: verifica la firma del JWT contra la clave publica cacheada, sin round-trip de red. Con `checkRevoked: true`, cada request requiere un round-trip a Firebase Auth (~10ms en condiciones normales). Esto introduce una dependencia nueva: si Firebase Auth tiene un outage o latencia alta, **todas** las requests al backend fallan o se degradan, no solo las de tokens revocados. Es un single point of failure nuevo. Para el volumen actual de Cielo Estrellado y el SLA de Firebase Auth (99.95%), el tradeoff es aceptable — la capacidad de revocar sesiones inmediatamente vale mas que el riesgo de un outage de Auth. Pero es una decision consciente, no un "costo negligible".
- **`checkRevoked` tambien rechaza usuarios deshabilitados/eliminados.** `verifyIdToken(token, true)` no solo detecta tokens revocados con `revokeRefreshTokens()` — tambien falla si el usuario fue deshabilitado o eliminado de Firebase Auth. Si algun proceso administrativo deshabilita cuentas (ej. script de limpieza de cuentas inactivas), esos usuarios recibiran 401 inmediatamente en vez de poder usar su token hasta que expire. **Este es el comportamiento deseado** — si una cuenta esta deshabilitada, no deberia poder operar durante la hora restante del token. Documentado como decision explicita.
- **Eliminar `sessionVersion` del tipo y del codigo.** El campo nunca se usa y crea confusion. Los documentos existentes en Firestore que ya tienen `sessionVersion: 1` no se ven afectados — Firestore no impone esquema, el campo simplemente se ignora en lecturas futuras. No es necesario hacer una migracion para eliminar el campo de documentos existentes.
- **No se toca la logica del frontend.** El frontend usa `getIdToken(true)` para refrescar tokens y `onIdTokenChanged` para detectar cambios. Si un token es revocado, el siguiente request al backend fallara con 401, el interceptor en `client.ts` intentara refrescar con `getIdToken(true)`, y si `revokeRefreshTokens` fue llamado, el refresh fallara y el interceptor redirige a `/login`. Esto ya funciona correctamente.

---

## Fix 2: Race condition en welcome bonus de usuario nuevo [M2 — Severidad Media]

### Problema

Cuando un usuario nuevo se registra por primera vez, `userSync` ejecuta el path `!userSnap.exists` (linea 77-105) que usa `batch.set()` + `batch.create()`. Un batch es atomico internamente (ambas operaciones se aplican o ninguna), pero **no es atomico contra lecturas concurrentes**. Si dos tabs se abren simultaneamente en el primer login:

1. Tab A lee `userSnap` → `exists: false`
2. Tab B lee `userSnap` → `exists: false`
3. Tab A ejecuta batch: `set(userRef, newUser)` + `create(txDoc, welcomeTx)` → Exito
4. Tab B ejecuta batch: `set(userRef, newUser)` (sobreescribe) + `create(txDoc2, welcomeTx)` → Exito

Resultado: El documento del usuario tiene datos correctos (la segunda escritura sobreescribe), pero hay **dos `TransactionRecord` de welcome bonus** en la subcoleccion `transactions`. El balance (`stardust: 150`) es correcto porque `set` sobreescribe, pero el historial de transacciones es inconsistente.

El path de usuario existente (lineas 46-76) ya usa `runTransaction` correctamente. El fix aplica el mismo patron al path de usuario nuevo.

### Codigo actual (`userSync.ts:77-105`)

```typescript
} else {
  const newUser: UserRecord = {
    displayName: firebaseUser.displayName || null,
    email: firebaseUser.email || '',
    photoURL: firebaseUser.photoURL || null,
    providers: firebaseUser.providerData.map((p: { providerId: string }) => p.providerId),
    emailVerifiedAt: firebaseUser.emailVerified ? now : null,
    createdAt: now,
    lastLoginAt: now,
    status: 'active',
    sessionVersion: 1,
    stardust: WELCOME_BONUS,
    maxSkies: 2,
    maxMemberships: 20,
    lastDailyRewardDate: null,
    loginStreak: 0,
    previousStreak: 0,
    createdStarsToday: 0,
    lastStarCreationDate: null,
    weeklyBonusWeek: null,
    acceptedInvitesToday: 0,
    lastInviteAcceptDate: null,
  }

  const batch = db.batch()
  batch.set(userRef, newUser)
  batch.create(userRef.collection('transactions').doc(), welcomeTx)
  await batch.commit()
}
```

### Codigo propuesto

```typescript
} else {
  const newUser: UserRecord = {
    displayName: firebaseUser.displayName || null,
    email: firebaseUser.email || '',
    photoURL: firebaseUser.photoURL || null,
    providers: firebaseUser.providerData.map((p: { providerId: string }) => p.providerId),
    emailVerifiedAt: firebaseUser.emailVerified ? now : null,
    createdAt: now,
    lastLoginAt: now,
    status: 'active',
    stardust: WELCOME_BONUS,
    maxSkies: 2,
    maxMemberships: 20,
    lastDailyRewardDate: null,
    loginStreak: 0,
    previousStreak: 0,
    createdStarsToday: 0,
    lastStarCreationDate: null,
    weeklyBonusWeek: null,
    acceptedInvitesToday: 0,
    lastInviteAcceptDate: null,
  }

  await db.runTransaction(async (t) => {
    const snap = await t.get(userRef)
    if (snap.exists) return // otro request concurrente ya creo el usuario
    t.set(userRef, newUser)
    t.create(userRef.collection('transactions').doc(), welcomeTx)
  })
}
```

### Cambios clave

1. **`batch` reemplazado por `runTransaction`.** La transaccion hace un `get` dentro del callback para verificar que el usuario NO existe antes de escribir. Si otro request concurrente ya lo creo, Firestore detecta el conflicto y reintenta el callback, donde `snap.exists` sera `true` y se retorna sin escribir.
2. **`sessionVersion: 1` eliminado** del objeto `newUser` (consecuencia del Fix 1).
3. **Guard clause `if (snap.exists) return`** — Si la transaccion reintenta y encuentra el usuario ya creado, simplemente no hace nada. El usuario ya tiene su welcome bonus del primer request exitoso.

### Decisiones de diseno

- **Transaccion en lugar de `create` (que falla si el doc existe).** Se podria usar `t.create(userRef, newUser)` en vez de `t.set(userRef, newUser)`, ya que `create` lanza error si el documento ya existe. Sin embargo, esto causaria que la transaccion falle con una excepcion no controlada en el caso concurrente, requiriendo un try/catch adicional. El guard clause `if (snap.exists) return` es mas explicito y sigue el patron ya establecido en el path de migracion (linea 48: `if (!freshSnap.exists) return`).
- **Read inicial fuera de la transaccion se mantiene.** La linea 15 (`const userSnap = await userRef.get()`) se mantiene fuera de la transaccion porque determina el branch del flujo (usuario nuevo vs existente). La transaccion hace su propia lectura fresca dentro del callback para validar atomicamente.
- **Comportamiento conocido: Tab B no ejecuta `lastLoginAt` update en caso de race condition.** Si dos tabs abren simultaneamente en el primer login, Tab A crea el usuario exitosamente. Tab B entra al branch `else` (porque el read externo dijo `!exists`), pero la transaccion detecta `snap.exists === true` y retorna sin hacer nada. Tab B nunca ejecuta el path de usuario existente (el `if`) que hace `userRef.update({ lastLoginAt: now })`. **Impacto: cero.** Tab A ya creo el usuario con `lastLoginAt: now` milisegundos antes — la diferencia es imperceptible. Tab B retorna 200 correctamente. Documentado para que nadie lo "descubra" despues y piense que es un bug.

---

## Fix 3: CORS permite localhost:5173 en produccion [B1 — Severidad Baja]

### Problema

`getAllowedOrigin` permite `http://localhost:5173` incondicionalmente (linea 9). En produccion, esto permite que un servidor de desarrollo local (potencialmente comprometido) haga requests cross-origin al backend. CORS es una proteccion del navegador, no del servidor, y un token Bearer valido sigue siendo necesario, pero el principio de minimo privilegio dicta restringir origenes en produccion.

### Codigo actual (`cors.ts:7-13`)

```typescript
function getAllowedOrigin(requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null
  if (requestOrigin === 'http://localhost:5173') return requestOrigin
  const appUrl = process.env.APP_URL
  if (appUrl && requestOrigin === appUrl) return requestOrigin
  return null
}
```

### Codigo propuesto

```typescript
function getAllowedOrigin(requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null
  if (process.env.NODE_ENV !== 'production' && requestOrigin === 'http://localhost:5173') {
    return requestOrigin
  }
  const appUrl = process.env.APP_URL
  if (appUrl && requestOrigin === appUrl) return requestOrigin
  return null
}
```

### Decisiones de diseno

- **`NODE_ENV !== 'production'` en lugar de `=== 'development'`.** Cloud Functions v2 (Gen 2) establece `NODE_ENV=production` automaticamente en deploy. En el emulador local y en tests, `NODE_ENV` no se establece o es `development`/`test`. Usar `!== 'production'` cubre todos los casos no-produccion de forma segura.
- **No se usa variable de entorno `CORS_ALLOWED_ORIGINS`.** La auditoria sugiere esta alternativa, pero para este proyecto con un solo frontend y un solo entorno de produccion, condicionar en `NODE_ENV` es mas simple y suficiente.
- **Sin tests dedicados para cors.ts.** Actualmente no existen tests para `cors.ts`. Dado que el cambio es de 1 linea y el riesgo es bajo, no se justifica crear un nuevo archivo de test. El comportamiento se verifica en el checklist post-deploy.

---

## Plan de tests

### Tests existentes que necesitan modificacion

| # | Test actual | Linea | Cambio requerido |
|---|-------------|-------|------------------|
| 1 | "crea usuario nuevo con campos economy" | 97 | Cambiar aserciones de `batchSet`/`batchCreate`/`batchCommit` a `transaction.set`/`transaction.create`. Agregar mock de `transaction.get`. Verificar que `sessionVersion` NO esta presente. |
| 2 | "migra usuario existente sin stardust" | 115 | Verificar que `sessionVersion` NO esta en el objeto de `transaction.update`. |

### Mocks a modificar

**En `vi.hoisted()` — agregar `set` al mock de transaction (linea 14):**

```typescript
// ANTES:
const transaction = { get: vi.fn(), update: vi.fn(), create: vi.fn() }

// DESPUES:
const transaction = { get: vi.fn(), update: vi.fn(), create: vi.fn(), set: vi.fn() }
```

**En `beforeEach` — agregar reset de `transaction.set` (despues de linea 82):**

```typescript
mocks.transaction.set.mockReset()
```

### Test existente 1: "crea usuario nuevo con campos economy" (linea 97-113)

El test actualmente verifica `batchSet`, `batchCreate` y `batchCommit`. Dado que Fix 2 reemplaza el batch por `runTransaction`, las aserciones deben cambiar:

```typescript
it('crea usuario nuevo con campos economy', async () => {
  mocks.userGet.mockResolvedValue({ exists: false })
  mocks.transaction.get.mockResolvedValue({ exists: false })

  const res = makeRes()
  await userSync(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(mocks.transaction.set).toHaveBeenCalledWith(
    mocks.userRef,
    expect.objectContaining({ stardust: 150, maxSkies: 2 }),
  )
  expect(mocks.transaction.set).toHaveBeenCalledWith(
    mocks.userRef,
    expect.not.objectContaining({ sessionVersion: expect.anything() }),
  )
  expect(mocks.transaction.create).toHaveBeenCalledWith(
    mocks.txDocRef,
    expect.objectContaining({ type: 'earn', amount: 150, reason: 'welcome' }),
  )
  // batch ya no se usa
  expect(mocks.batchSet).not.toHaveBeenCalled()
  expect(mocks.batchCommit).not.toHaveBeenCalled()
})
```

**Nota:** Se agrega `mocks.transaction.get.mockResolvedValue({ exists: false })` porque la transaccion ahora hace un `get` dentro del callback.

### Test existente 2: "migra usuario existente sin stardust" (linea 115-138)

Agregar verificacion de que `sessionVersion` no aparece:

```typescript
// Agregar despues de la asercion existente de transaction.update:
expect(mocks.transaction.update).toHaveBeenCalledWith(
  expect.anything(),
  expect.not.objectContaining({ sessionVersion: expect.anything() }),
)
```

### Nuevos tests a agregar

#### En `describe('userSync')` de `userSync.test.ts`:

```typescript
it('no duplica welcome bonus si request concurrente ya creo el usuario', async () => {
  // Simula que el usuario no existe en la lectura inicial
  mocks.userGet.mockResolvedValue({ exists: false })
  // Pero dentro de la transaccion, el usuario YA existe (otro request lo creo)
  mocks.transaction.get.mockResolvedValue({ exists: true })

  const res = makeRes()
  await userSync(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(200)
  // La transaccion no debe escribir nada porque el usuario ya existe
  expect(mocks.transaction.set).not.toHaveBeenCalled()
  expect(mocks.transaction.create).not.toHaveBeenCalled()
})
```

#### Nuevo archivo `functions/src/middleware/auth.test.ts`:

```typescript
import type { Request } from 'firebase-functions/v2/https'

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
}))

import { authenticateRequest } from './auth'

function makeReq(authHeader?: string) {
  return {
    headers: { authorization: authHeader },
  } as unknown as Request
}

describe('authenticateRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifica token con checkRevoked habilitado', async () => {
    const decoded = { uid: 'test-uid' }
    mocks.verifyIdToken.mockResolvedValue(decoded)

    const result = await authenticateRequest(makeReq('Bearer valid-token'))

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('valid-token', true)
    expect(result).toEqual(decoded)
  })

  it('lanza error si no hay header Authorization', async () => {
    await expect(authenticateRequest(makeReq())).rejects.toThrow(
      'Missing or invalid Authorization header',
    )
    expect(mocks.verifyIdToken).not.toHaveBeenCalled()
  })

  it('lanza error si el header no tiene formato Bearer', async () => {
    await expect(authenticateRequest(makeReq('Basic abc'))).rejects.toThrow(
      'Missing or invalid Authorization header',
    )
    expect(mocks.verifyIdToken).not.toHaveBeenCalled()
  })

  it('propaga error de token revocado', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('id-token-revoked'))

    await expect(authenticateRequest(makeReq('Bearer revoked-token'))).rejects.toThrow(
      'id-token-revoked',
    )
  })
})
```

### Test existente: firma invalida de auth — SIN CAMBIOS

Los tests existentes que mockean `authenticateRequest` en otros handlers (shop, economy, skies, etc.) **no necesitan cambios**. El mock retorna `{ uid: 'test-uid' }` directamente, sin pasar por `verifyIdToken`. El cambio a `checkRevoked` solo afecta al test dedicado nuevo en `auth.test.ts`.

---

## Orden de implementacion

Los cambios tienen dependencias entre Fix 1 y Fix 2 (ambos modifican `userSync.ts` y `contracts.ts`). El orden va de menor a mayor complejidad.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | B1 — CORS condicional | Minima | 1 linea cambiada en `cors.ts`. Sin tests. Sin dependencias. |
| 2 | M1 — checkRevoked + eliminar sessionVersion | Baja | 1 linea en `auth.ts`, eliminar campo de `contracts.ts` (backend y frontend), eliminar 2 lineas en `userSync.ts`. Crear `auth.test.ts` (4 tests). |
| 3 | M2 — Race condition en usuario nuevo | Media | Reestructura del bloque else en `userSync.ts` (batch → transaction). Modificar 2 tests existentes, agregar 1 test nuevo, agregar mock `set` a transaction. |

### Dependencias entre cambios

- **Fix 1 y Fix 2** ambos modifican `userSync.ts` — implementarlos en secuencia. Fix 1 primero (elimina `sessionVersion` del objeto `newUser`), Fix 2 despues (reemplaza batch por transaction, ya sin `sessionVersion`).
- **Fix 2** modifica las aserciones de tests que Fix 1 tambien toca (el test "crea usuario nuevo"). Implementar Fix 1 primero para que Fix 2 trabaje sobre el codigo ya limpio.
- **Fix 3 (B1)** no tiene dependencias con ningun otro fix.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/userSync.test.ts
cd functions && npx vitest run src/middleware/auth.test.ts
cd functions && npx tsc --noEmit
```

### Conteo esperado de tests

- **Antes:** 4 tests en `userSync.test.ts`, 0 tests en `auth.test.ts` (no existe)
- **Despues:** 5 tests en `userSync.test.ts` (+1 nuevo: race condition), 4 tests en `auth.test.ts` (archivo nuevo)
- **Delta:** +1 en userSync, +4 en auth = **+5 tests totales**

### Checklist post-deploy

- [ ] Verificar que requests con tokens validos siguen funcionando (200 en `/userSync`)
- [ ] Verificar que requests con tokens expirados retornan 401
- [ ] Llamar a `auth.revokeRefreshTokens(uid)` en la consola de Firebase para un usuario de prueba y confirmar que su siguiente request retorna 401
- [ ] Verificar que el frontend redirige a `/login` cuando un token es revocado (el interceptor en `client.ts` maneja el 401 → intenta refresh → falla → redirige)
- [ ] Verificar en produccion que `http://localhost:5173` NO recibe headers CORS (hacer un request manual con `Origin: http://localhost:5173` y verificar que `Access-Control-Allow-Origin` no esta presente)
- [ ] Verificar que el frontend de produccion (`APP_URL`) SI recibe headers CORS correctos
- [ ] Crear un usuario nuevo en staging y verificar que tiene exactamente 1 `TransactionRecord` de tipo `welcome`
- [ ] Confirmar que `tsc --noEmit` pasa sin errores en backend y frontend (la eliminacion de `sessionVersion` del tipo no debe causar errores)

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Firebase Auth outage degrada todo el backend (SPOF nuevo por `checkRevoked`) | Muy baja | Firebase Auth tiene SLA de 99.95%. Antes, `verifyIdToken` era local (firma JWT con clave cacheada); ahora requiere round-trip. Si Auth cae, todas las requests fallan — no solo las de tokens revocados. Para el volumen de Cielo Estrellado, el tradeoff es aceptable: la capacidad de revocar sesiones inmediatamente vale mas que el riesgo. Monitorear latencia P95 la primera semana post-deploy. |
| `checkRevoked` rechaza usuarios deshabilitados/eliminados inmediatamente | Baja | Comportamiento deseado: si un admin deshabilita una cuenta, el rechazo inmediato es correcto. Documentado como decision explicita. Si se implementan scripts de limpieza de cuentas, considerar que los usuarios afectados perderan acceso inmediatamente, no al expirar el token. |
| Algun archivo usa `sessionVersion` y falla al no encontrarlo en el tipo | Muy baja | Verificado: solo aparece en `contracts.ts` (backend/frontend), `userSync.ts:72,87`, y `SPEC.md:24`. Ningun handler, hook ni componente lo lee. |
| `runTransaction` reintenta multiples veces en alta concurrencia de primer login | Muy baja | Firestore reintenta hasta 5 veces por defecto. El guard clause `if (snap.exists) return` termina inmediatamente en reintentos, sin escrituras adicionales. |
| Tab B no ejecuta `lastLoginAt` update en race condition de primer login | Muy baja | Impacto cero: Tab A ya creo el usuario con `lastLoginAt: now` milisegundos antes. Documentado como comportamiento conocido en Fix 2. |
| `NODE_ENV` no esta definido en el emulador local y localhost deja de funcionar | Muy baja | `NODE_ENV !== 'production'` permite localhost cuando `NODE_ENV` es `undefined`, `'development'`, o `'test'`. Solo se bloquea cuando es exactamente `'production'` (deploy a Cloud Functions). |
