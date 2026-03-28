# SPEC: Eliminar migracion de economia en userSync

**Fecha:** 2026-03-27
**Estado:** Pendiente
**Origen:** `audits/04-userSync-migracion.md` (auditoria de codigo muerto)
**Prerequisito:** `audits/SPEC-autenticacion.md` Fix M1 y M2 ya implementados. Este spec asume que batch fue reemplazado por transaction (Fix M2) y que `sessionVersion` fue eliminado (Fix M1). Si se implementa sin ese prerequisito, los mocks de batch que aqui se eliminan aun estarian en uso y las aserciones serian incorrectas.
**Archivos afectados:**
- `functions/src/handlers/userSync.ts` (handler)
- `functions/src/handlers/userSync.test.ts` (tests)

## Contexto

El handler `userSync` contiene un bloque de migracion (lineas 46-75) que verifica `freshData.stardust === undefined` y agrega campos de economia a usuarios existentes que no los tenian. Todos los usuarios ya fueron migrados — este codigo nunca se ejecuta. Sin embargo, **en cada login de usuario existente** se ejecuta un `runTransaction` con un `get` adicional solo para verificar la condicion y no hacer nada.

Eliminar este bloque reduce latencia por login (~1 Firestore read menos), elimina 30 lineas de codigo muerto y simplifica el handler a dos paths claros: usuario existente → update perfil, usuario nuevo → crear con transaction.

---

## Fix 1: Eliminar bloque de migracion [H1]

### Codigo a eliminar (`userSync.ts:46-75`)

```typescript
      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(userRef)
        if (!freshSnap.exists) return
        const freshData = freshSnap.data()!

        if (freshData.stardust === undefined) {
          const ownerSnap = await db
            .collectionGroup('members')
            .where('userId', '==', decoded.uid)
            .where('role', '==', 'owner')
            .where('status', '==', 'active')
            .get()

          transaction.update(userRef, {
            stardust: WELCOME_BONUS,
            maxSkies: Math.max(2, ownerSnap.size),
            maxMemberships: 20,
            lastDailyRewardDate: null,
            loginStreak: 0,
            previousStreak: 0,
            createdStarsToday: 0,
            lastStarCreationDate: null,
            weeklyBonusWeek: null,
            acceptedInvitesToday: 0,
            lastInviteAcceptDate: null,
            status: 'active',
          })
          transaction.create(userRef.collection('transactions').doc(), welcomeTx)
        }
      })
```

### Handler resultante

Despues de la eliminacion, el path de usuario existente queda asi:

```typescript
if (userSnap.exists) {
  const rawData = userSnap.data()!
  const existing = rawData as UserRecord

  const emailVerifiedAt =
    existing.emailVerifiedAt !== null
      ? existing.emailVerifiedAt
      : firebaseUser.emailVerified
        ? now
        : null

  await userRef.update({
    email: firebaseUser.email || existing.email,
    displayName: firebaseUser.displayName || null,
    photoURL: firebaseUser.photoURL || null,
    providers: firebaseUser.providerData.map((p: { providerId: string }) => p.providerId),
    emailVerifiedAt,
    lastLoginAt: now,
  })
} else {
  // ... path de usuario nuevo (sin cambios)
}
```

### Decisiones de diseno

- **No se necesita fallback para usuarios sin `stardust`.** Todos los usuarios fueron migrados. Ademas, el codebase es defensivo: `economy.ts:59` usa `typeof rawData.stardust === 'number' ? rawData.stardust : DEFAULT_USER_ECONOMY.stardust` como fallback (retorna 0, no crashea).
- **`welcomeTx` se mantiene.** Sigue siendo necesario para el path de usuario nuevo (linea 99-104).
- **`WELCOME_BONUS` se mantiene.** Se usa en `welcomeTx` y en el objeto `newUser` del path de usuario nuevo.
- **`collectionGroup('members')` en otros archivos no se afecta.** Los queries en `skies.ts` (getUserSkies, createSky) e `invitePublic.ts` (acceptInviteHandler) son independientes del bloque de migracion.

---

## Plan de tests

### Tests a eliminar (3)

| Test | Linea | Razon |
|------|-------|-------|
| "migra usuario existente sin stardust" | 122-149 | Valida path de migracion eliminado |
| "no migra usuario ya migrado" | 151-167 | Valida skip de migracion eliminado |
| "migracion es idempotente" | 169-209 | Valida idempotencia de migracion eliminada |

### Mocks a limpiar

**En `vi.hoisted()` — eliminar mocks de migracion (lineas 18-24):**

```typescript
// ELIMINAR:
const collectionGroupGet = vi.fn().mockResolvedValue({ size: 0 })

const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
  where: vi.fn(),
  get: collectionGroupGet,
}
membersQuery.where.mockReturnValue(membersQuery)
```

**En el return del hoisted (linea 45) — eliminar referencias:**

```typescript
// ELIMINAR de return:
collectionGroupGet, membersQuery,
```

**En `vi.mock('../lib/firebaseAdmin.js')` (linea 59) — eliminar `collectionGroup`:**

```typescript
// ELIMINAR:
collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
```

**En `beforeEach` (lineas 88-90) — eliminar resets de migracion:**

```typescript
// ELIMINAR:
mocks.collectionGroupGet.mockResolvedValue({ size: 0 })
mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
```

**Mocks de batch (lineas 26-28) — tambien se pueden eliminar:**

Los mocks `batchSet`, `batchCreate`, `batchCommit` y `db.batch` ya no se usan desde que Fix M2 de SPEC-autenticacion reemplazo batch por transaction. Eliminarlos tambien:

```typescript
// ELIMINAR de vi.hoisted():
const batchSet = vi.fn()
const batchCreate = vi.fn()
const batchCommit = vi.fn().mockResolvedValue(undefined)

// ELIMINAR de return:
batchSet, batchCreate, batchCommit,

// ELIMINAR de vi.mock db:
batch: vi.fn().mockReturnValue({ set: mocks.batchSet, create: mocks.batchCreate, commit: mocks.batchCommit }),

// ELIMINAR de beforeEach:
mocks.batchCommit.mockResolvedValue(undefined)
```

**Actualizar test "crea usuario nuevo" — eliminar aserciones de batch:**

```typescript
// ELIMINAR del test (lineas 118-119):
expect(mocks.batchSet).not.toHaveBeenCalled()
expect(mocks.batchCommit).not.toHaveBeenCalled()
```

### Test nuevo a agregar

```typescript
it('actualiza perfil de usuario existente', async () => {
  mocks.userGet.mockResolvedValue({
    exists: true,
    data: () => ({ email: 'old@example.com', emailVerifiedAt: null }),
  })

  const res = makeRes()
  await userSync(makeReq(), res)

  expect(res.status).toHaveBeenCalledWith(200)
  expect(mocks.userUpdate).toHaveBeenCalledWith(
    expect.objectContaining({
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null,
      providers: ['google.com'],
      lastLoginAt: expect.any(String),
    }),
  )
  // No debe ejecutar transaccion (ya no hay migracion)
  expect(mocks.runTransaction).not.toHaveBeenCalled()
})
```

### Conteo esperado de tests

- **Antes:** 5 tests (creacion + migracion + no migra + idempotente + race condition)
- **Despues:** 3 tests (perfil update + creacion nuevo + race condition)
- **Delta:** -3 eliminados, +1 nuevo = **-2 neto**

---

## Verificacion

### Antes de commit

```bash
cd functions && npx vitest run src/handlers/userSync.test.ts
cd functions && npx tsc --noEmit
```

### Checklist pre-deploy

- [ ] Confirmar en Firestore que no existen usuarios sin el campo `stardust`. Firestore no soporta querir por ausencia de campo directamente (`where('stardust', '==', undefined)` no funciona, y `where('stardust', '==', null)` busca valores explicitamente null, no campos ausentes). Usar este script en la consola de Firebase o en un script local:
  ```typescript
  const allUsers = await db.collection('users').get()
  const missing = allUsers.docs.filter(d => d.data().stardust === undefined)
  console.log(`Usuarios sin stardust: ${missing.length}`)
  ```
  Si `missing.length === 0`, es seguro eliminar. Si no, migrar esos usuarios manualmente antes del deploy.
- [ ] Verificar que login de usuario existente retorna 200
- [ ] Verificar que registro de usuario nuevo retorna 200 con welcome bonus
- [ ] Monitorear latencia P95 de `/userSync` post-deploy — deberia bajar (1 read menos por login)

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Existe un usuario no migrado en produccion | Muy baja | Verificar con query antes de deploy. Si existe, ejecutar migracion manual en la consola de Firebase. |
| Algun codigo depende del `collectionGroup` query de migracion | Nula | Verificado: los queries de `collectionGroup('members')` en `skies.ts` e `invitePublic.ts` son independientes. |
