# SPEC: Cobertura de Tests — Handlers Backend

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/10-cobertura-tests.md` (auditoria de cobertura)
**Archivos afectados:**
- `functions/src/handlers/members.test.ts` (CREAR)
- `functions/src/handlers/stars.test.ts` (EXTENDER)
- `functions/src/handlers/skies.test.ts` (EXTENDER)

## Contexto

Una auditoria de cobertura identifico gaps en tests de handlers backend. Desde la auditoria, se han resuelto varios hallazgos:

| Hallazgo original | Estado | Resolucion |
|-------------------|--------|------------|
| M1 — `invites.ts` sin tests | RESUELTO | `invites.test.ts` con 19 tests (commit `1da8525`) |
| M2 — `updateStar`/`deleteStar` sin tests | PARCIAL | imagePath + storage cleanup testeados (6+3 tests). Faltan permisos por rol. |
| M3 — `getSkyWithAccess` siempre ok:true | PENDIENTE | Ningun test verifica acceso denegado |
| B1 — `previewInvite` sin tests | RESUELTO | 6 tests de previewInvite en `invitePublic.test.ts` |
| B4 — `updateSky`/`deleteSky`/`getSky`/`getUserSkies` sin tests | PENDIENTE | Solo `createSky` (2) y `updateSkyTheme` (3) testeados |
| `members.ts` sin tests | PENDIENTE | Archivo de test no existe |

**Estado actual:** 150 tests, 12 archivos.
**Estado esperado:** ~190 tests, 13 archivos (+1 `members.test.ts`).

Este SPEC cubre los 3 gaps pendientes con codigo exacto. Un desarrollador puede implementar sin leer la auditoria original.

---

## Task 1: Tests para `members.ts` [CREAR — Prioridad Alta]

### Problema

`handlers/members.ts` exporta 3 funciones (`listMembers`, `updateMember`, `leaveSky`) con cero cobertura de tests. Incluyen logica critica de autorizacion owner-only, validacion de roles/status, y una transaccion atomica en `leaveSky` que previene que el owner abandone su cielo.

### Archivo a crear

`functions/src/handlers/members.test.ts`

### Codigo completo

```typescript
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const callerGet = vi.fn()
  const membersGet = vi.fn()
  const targetGet = vi.fn()
  const targetUpdate = vi.fn().mockResolvedValue(undefined)
  const getAll = vi.fn()

  const transaction = { get: vi.fn(), update: vi.fn() }
  const runTransaction = vi.fn(async (fn: Function) => fn(transaction))

  return { callerGet, membersGet, targetGet, targetUpdate, getAll, transaction, runTransaction }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'skies') {
        return {
          doc: vi.fn().mockReturnValue({
            collection: vi.fn().mockReturnValue({
              // RESTRICCION: no usar 'test-uid' como target userId en tests.
              // Si id === 'test-uid', retorna callerGet (no targetGet).
              doc: vi.fn((id: string) => {
                if (id === 'test-uid') return { get: mocks.callerGet }
                return { get: mocks.targetGet, update: mocks.targetUpdate }
              }),
              where: vi.fn().mockReturnValue({ get: mocks.membersGet }),
            }),
          }),
        }
      }
      if (name === 'users') {
        return { doc: vi.fn().mockReturnValue({}) }
      }
      return {}
    }),
    getAll: mocks.getAll,
    runTransaction: mocks.runTransaction,
  },
}))

vi.mock('../logError.js', () => ({
  logError: vi.fn(),
}))

import { listMembers, updateMember, leaveSky } from './members'

function makeReq(overrides: { routeParams?: Record<string, string>; body?: unknown } = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', ...overrides.routeParams },
    body: overrides.body ?? {},
    query: {},
  } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

function setupOwner() {
  mocks.callerGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'owner' }),
  })
}

function setupEditor() {
  mocks.callerGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'editor' }),
  })
}

function setupNotMember() {
  mocks.callerGet.mockResolvedValue({ exists: false })
}

function setupTarget(overrides: Record<string, unknown> = {}) {
  mocks.targetGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'editor', ...overrides }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.targetUpdate.mockResolvedValue(undefined)
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
})

// ─── listMembers ─────────────────────────────────────────────

describe('listMembers', () => {
  it('retorna lista de miembros con datos de usuario como owner', async () => {
    setupOwner()
    mocks.membersGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'user-1', data: () => ({ role: 'owner', joinedAt: '2026-01-01T00:00:00Z', status: 'active' }) },
        { id: 'user-2', data: () => ({ role: 'editor', joinedAt: '2026-01-02T00:00:00Z', status: 'active' }) },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: true, data: () => ({ displayName: 'Alice', email: 'alice@test.com', photoURL: null }) },
      { exists: true, data: () => ({ displayName: null, email: 'bob@test.com', photoURL: 'https://photo.url' }) },
    ])

    const res = makeRes()
    await listMembers(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.members).toHaveLength(2)
    expect(jsonArg.members[0]).toEqual(expect.objectContaining({
      userId: 'user-1',
      role: 'owner',
      displayName: 'Alice',
    }))
    expect(jsonArg.members[1]).toEqual(expect.objectContaining({
      userId: 'user-2',
      role: 'editor',
      displayName: 'bob@test.com',
    }))
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()
    const res = makeRes()
    await listMembers(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes acceso a este cielo' })
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()
    const res = makeRes()
    await listMembers(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede ver la lista de miembros' })
  })

  it('retorna array vacio si no hay miembros activos', async () => {
    setupOwner()
    mocks.membersGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await listMembers(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ members: [] })
  })

  it('resuelve displayName con fallback a uid truncado', async () => {
    setupOwner()
    mocks.membersGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'abcdef123456', data: () => ({ role: 'editor', joinedAt: '2026-01-01T00:00:00Z', status: 'active' }) },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: false, data: () => undefined },
    ])

    const res = makeRes()
    await listMembers(makeReq(), res)

    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.members[0].displayName).toBe('uid_abcdef')
  })
})

// ─── updateMember ────────────────────────────────────────────

describe('updateMember', () => {
  const updateReq = (body: unknown) =>
    makeReq({ routeParams: { skyId: 'sky-1', userId: 'target-uid' }, body })

  it('revoca miembro exitosamente como owner', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.targetUpdate).toHaveBeenCalledWith({ status: 'revoked' })
  })

  it('cambia rol de miembro exitosamente', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({ role: 'viewer' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.targetUpdate).toHaveBeenCalledWith({ role: 'viewer' })
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes acceso a este cielo' })
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede gestionar miembros' })
  })

  it('rechaza con 404 si target no existe', async () => {
    setupOwner()
    mocks.targetGet.mockResolvedValue({ exists: false })

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Miembro no encontrado' })
  })

  it('rechaza con 400 si target ya no esta activo', async () => {
    setupOwner()
    setupTarget({ status: 'revoked' })

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'El miembro ya no está activo' })
  })

  it('rechaza con 400 si target es owner', async () => {
    setupOwner()
    setupTarget({ role: 'owner' })

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No se puede modificar al propietario' })
  })

  it('rechaza con 400 si envia status y role a la vez', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({ status: 'revoked', role: 'viewer' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No se puede cambiar status y rol a la vez' })
  })

  it('rechaza status diferente a revoked', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({ status: 'active' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo se permite status "revoked"' })
  })

  it('rechaza role invalido', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({ role: 'admin' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Rol inválido. Debe ser "editor" o "viewer"' })
  })

  it('rechaza si no envia ni status ni role', async () => {
    setupOwner()
    setupTarget()

    const res = makeRes()
    await updateMember(updateReq({}), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Se requiere "status" o "role" en el body' })
  })
})

// ─── leaveSky ────────────────────────────────────────────────

describe('leaveSky', () => {
  it('abandona cielo exitosamente como editor', async () => {
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'editor' }),
    })

    const res = makeRes()
    await leaveSky(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      { status: 'revoked' },
    )
  })

  it('rechaza con 400 si es owner', async () => {
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    const res = makeRes()
    await leaveSky(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'El propietario no puede abandonar su propio cielo' })
  })

  it('rechaza con 403 si no es miembro', async () => {
    mocks.transaction.get.mockResolvedValue({ exists: false })

    const res = makeRes()
    await leaveSky(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes acceso a este cielo' })
  })

  it('rechaza con 400 si ya no es activo', async () => {
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'revoked', role: 'editor' }),
    })

    const res = makeRes()
    await leaveSky(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Ya no eres miembro activo de este cielo' })
  })
})
```

### Decisiones de diseno

- **Mock de `doc(id)` con dispatch por ID.** `doc('test-uid')` retorna el caller ref; cualquier otro ID retorna el target ref. Esto soporta los 3 handlers sin mocks adicionales: `listMembers` usa callerGet, `updateMember` usa callerGet + targetGet/targetUpdate, `leaveSky` usa transaction.get. **Restriccion: ningun test debe usar `'test-uid'` como `userId` target** (ej. "owner intenta modificarse a si mismo"), porque el dispatch retornaria `callerGet` en vez de `targetGet`. Si ese escenario se necesitara en el futuro, habria que cambiar el dispatch a un mock configurable por test.
- **`getAll` como mock directo.** `listMembers` construye userRefs via `db.collection('users').doc(id)` y luego llama `db.getAll(...refs)`. El mock de `getAll` retorna los snapshots en el mismo orden, ignorando los refs reales. El mapeo posicional se verifica por indice en el test.
- **`leaveSky` usa `transaction.get` directamente.** El handler no llama `.get()` en el ref — lo pasa a `transaction.get(ref)`. Por eso los tests de `leaveSky` configuran `mocks.transaction.get` en vez de `mocks.callerGet`.
- **`setupTarget()` default: `{ status: 'active', role: 'editor' }`.** Es el caso base valido para un target. Los tests que necesitan un target diferente usan `setupTarget({ role: 'owner' })`, etc.

---

## Task 2: Tests de permisos para `stars.ts` [EXTENDER — Prioridad Alta]

### Problema

`stars.test.ts` tiene 15 tests que cubren rewards, imagePath y storage cleanup. Sin embargo, NINGUN test verifica:
- Que `getSkyWithAccess` retornando `{ ok: false }` produce 404/500
- Que un `viewer` no puede crear estrellas
- Que un `editor` no puede editar/eliminar estrellas de otro usuario
- Que una estrella soft-deleted retorna 404

Los 15 tests existentes usan `getSkyWithAccess` mockeado como `{ ok: true, role: 'owner' }` sin variacion.

### Cambios requeridos

**2a. Agregar import** (despues de la linea de imports existente):

```typescript
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
```

**2b. Agregar los siguientes describe blocks al final del archivo:**

```typescript
// ─── createStar — access control ─────────────────────────────

describe('createStar — access control', () => {
  it('rechaza con 404 si getSkyWithAccess retorna not_found', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'not_found' } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cielo no encontrado' })
  })

  it('rechaza con 500 si getSkyWithAccess retorna error', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'error' } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Error interno al verificar acceso' })
  })

  it('rechaza con 403 si rol es viewer', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'viewer', status: 'active' },
    } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para crear estrellas en este cielo' })
    expect(mocks.starSet).not.toHaveBeenCalled()
  })
})

// ─── updateStar — permisos ───────────────────────────────────

describe('updateStar — permisos', () => {
  const baseStar = {
    title: 'Existing Star',
    message: null,
    xNormalized: 0.5,
    yNormalized: 0.5,
    imagePath: null,
    deletedAt: null,
    authorUserId: 'test-uid',
  }

  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ ...baseStar, ...overrides }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('owner puede editar estrella de otro usuario', async () => {
    // Default mock: getSkyWithAccess retorna role: owner
    const starRef = setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalled()
  })

  it('editor puede editar su propia estrella', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    const starRef = setupStarRef({ authorUserId: 'test-uid' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalled()
  })

  it('editor no puede editar estrella de otro usuario', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para editar esta estrella' })
  })

  it('retorna 404 si estrella esta soft-deleted', async () => {
    setupStarRef({ deletedAt: '2026-01-01T00:00:00Z' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Estrella no encontrada' })
  })
})

// ─── deleteStar — permisos ───────────────────────────────────

describe('deleteStar — permisos', () => {
  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          deletedAt: null,
          authorUserId: 'test-uid',
          imagePath: null,
          ...overrides,
        }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('editor no puede eliminar estrella de otro usuario', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para eliminar esta estrella' })
  })

  it('retorna 404 si estrella no existe', async () => {
    const starRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      update: vi.fn(),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Estrella no encontrada' })
  })

  it('marca deletedAt y deletedByUserId al eliminar', async () => {
    const starRef = setupStarRef()

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(String),
        deletedByUserId: 'test-uid',
      }),
    )
  })
})
```

### Decisiones de diseno

- **`vi.mocked(getSkyWithAccess).mockResolvedValueOnce()`** para overrides por test. El mock global retorna `ok: true, role: 'owner'`. Los tests que necesitan otro comportamiento usan `mockResolvedValueOnce` que solo afecta la siguiente llamada, sin contaminar otros tests.
- **`as any`** en los overrides de `getSkyWithAccess`. El tipo de retorno real es un union (`AccessResult`). Los objetos parciales que usamos en tests no satisfacen todos los campos del tipo completo, pero en runtime solo se acceden los campos que el handler necesita.
- **`setupStarRef` duplicado en cada describe.** Los describe existentes ya definen sus propios `setupStarRef` con defaults diferentes. Seguimos el mismo patron en los nuevos describe para evitar modificar codigo existente.
- **No se testean validaciones de input** (titulo, mensaje, coordenadas) en esta Task. Esos tests pertenecerian a un describe separado de "validacion de input" que no esta en scope. Los tests aqui se enfocan exclusivamente en control de acceso y permisos.

---

## Task 3: Tests CRUD para `skies.ts` [EXTENDER — Prioridad Media]

### Problema

`skies.test.ts` tiene 5 tests que solo cubren `createSky` (2) y `updateSkyTheme` (3). Faltan 4 handlers completos: `getSky`, `getUserSkies`, `updateSky`, y `deleteSky`. El mas critico es `deleteSky` por su logica de batch deletion multi-documento con limpieza de Storage.

### Cambios requeridos

**3a. Reemplazar la linea de import** (linea 58):

```typescript
// Antes:
import { createSky, updateSkyTheme } from './skies'

// Despues:
import { getUserSkies, createSky, updateSky, getSky, deleteSky, updateSkyTheme } from './skies'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
```

**3b. Reemplazar `vi.hoisted()`** (lineas 4-19) con:

```typescript
const mocks = vi.hoisted(() => {
  const userGet = vi.fn()
  const collectionGroupGet = vi.fn()
  const inventoryGet = vi.fn().mockResolvedValue({ docs: [] })
  const skyUpdate = vi.fn().mockResolvedValue(undefined)
  const getAll = vi.fn()
  const starsGet = vi.fn()
  const subMembersGet = vi.fn()
  const storageDelete = vi.fn().mockResolvedValue(undefined)
  const storageFile = vi.fn().mockReturnValue({ delete: storageDelete })
  const batchDelete = vi.fn()
  const batchUpdate = vi.fn()

  const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: collectionGroupGet,
  }
  membersQuery.where.mockReturnValue(membersQuery)

  const invitesQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: vi.fn(),
  }
  invitesQuery.where.mockReturnValue(invitesQuery)

  const batchSet = vi.fn()
  const batchCommit = vi.fn().mockResolvedValue(undefined)

  return {
    userGet, collectionGroupGet, inventoryGet, skyUpdate,
    membersQuery, batchSet, batchCommit,
    getAll, starsGet, subMembersGet, storageDelete, storageFile,
    batchDelete, batchUpdate, invitesQuery,
  }
})
```

**3c. Reemplazar `vi.mock('../lib/firebaseAdmin.js')`** (lineas 32-56) con:

```typescript
vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return {
        doc: vi.fn().mockReturnValue({
          get: mocks.userGet,
          collection: vi.fn((sub: string) => {
            if (sub === 'inventory') return { get: mocks.inventoryGet }
            return {}
          }),
        }),
      }
      if (name === 'skies') return {
        doc: vi.fn().mockReturnValue({
          id: 'sky-new',
          update: mocks.skyUpdate,
          collection: vi.fn((sub: string) => {
            if (sub === 'members') return {
              doc: vi.fn().mockReturnValue({}),
              get: mocks.subMembersGet,
            }
            if (sub === 'stars') return { get: mocks.starsGet }
            return { doc: vi.fn().mockReturnValue({}) }
          }),
        }),
      }
      if (name === 'invites') return mocks.invitesQuery
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    batch: vi.fn().mockReturnValue({
      set: mocks.batchSet,
      delete: mocks.batchDelete,
      update: mocks.batchUpdate,
      commit: mocks.batchCommit,
    }),
    getAll: mocks.getAll,
  },
  storage: {
    bucket: vi.fn().mockReturnValue({
      file: mocks.storageFile,
    }),
  },
}))
```

**3d. Reemplazar `beforeEach`** (lineas 67-73) con:

```typescript
beforeEach(() => {
  vi.clearAllMocks()
  mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
  mocks.inventoryGet.mockResolvedValue({ docs: [] })
  mocks.skyUpdate.mockResolvedValue(undefined)
  mocks.batchCommit.mockResolvedValue(undefined)
  mocks.invitesQuery.where.mockReturnValue(mocks.invitesQuery)
  mocks.invitesQuery.get.mockResolvedValue({ docs: [] })
  mocks.starsGet.mockResolvedValue({ docs: [] })
  mocks.subMembersGet.mockResolvedValue({ docs: [] })
  mocks.getAll.mockResolvedValue([])
  mocks.storageDelete.mockResolvedValue(undefined)
})
```

**3e. Agregar helper `makeReq`** (despues de `makeRes`, antes del primer describe):

```typescript
function makeReq(overrides: { routeParams?: Record<string, string>; body?: unknown } = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: overrides.routeParams ?? {},
    body: overrides.body ?? {},
    query: {},
  } as unknown as Request
}
```

**3f. Agregar los siguientes describe blocks al final del archivo** (despues de `updateSkyTheme`):

```typescript
// ─── getSky ──────────────────────────────────────────────────

describe('getSky', () => {
  it('retorna sky y member role', async () => {
    const res = makeRes()
    const req = makeReq({ routeParams: { skyId: 'sky-1' } })
    await getSky(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      sky: { title: 'Test Sky' },
      member: { role: 'owner', status: 'active' },
    })
  })

  it('retorna 404 si getSkyWithAccess retorna not_found', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'not_found' } as any)

    const res = makeRes()
    await getSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cielo no encontrado' })
  })

  it('retorna 500 si getSkyWithAccess retorna error', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'error' } as any)

    const res = makeRes()
    await getSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Error interno al verificar acceso' })
  })
})

// ─── getUserSkies ────────────────────────────────────────────

describe('getUserSkies', () => {
  it('retorna lista de cielos ordenados por createdAt desc', async () => {
    const skyRefA = { id: 'sky-a' }
    const skyRefB = { id: 'sky-b' }
    mocks.collectionGroupGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ userId: 'test-uid', role: 'owner', status: 'active' }), ref: { parent: { parent: skyRefA } } },
        { data: () => ({ userId: 'test-uid', role: 'editor', status: 'active' }), ref: { parent: { parent: skyRefB } } },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: true, data: () => ({ title: 'Sky A', createdAt: '2026-01-01T00:00:00Z' }) },
      { exists: true, data: () => ({ title: 'Sky B', createdAt: '2026-01-02T00:00:00Z' }) },
    ])

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.skies).toHaveLength(2)
    // Ordenados por createdAt desc: Sky B (mas reciente) primero
    expect(jsonArg.skies[0].skyId).toBe('sky-b')
    expect(jsonArg.skies[0].role).toBe('editor')
    expect(jsonArg.skies[1].skyId).toBe('sky-a')
    expect(jsonArg.skies[1].role).toBe('owner')
  })

  it('retorna array vacio si no es miembro de ningun cielo', async () => {
    mocks.collectionGroupGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ skies: [] })
  })

  it('omite cielos que ya no existen', async () => {
    const skyRefA = { id: 'sky-a' }
    const skyRefB = { id: 'sky-b' }
    mocks.collectionGroupGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ userId: 'test-uid', role: 'owner', status: 'active' }), ref: { parent: { parent: skyRefA } } },
        { data: () => ({ userId: 'test-uid', role: 'editor', status: 'active' }), ref: { parent: { parent: skyRefB } } },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: true, data: () => ({ title: 'Sky A', createdAt: '2026-01-01T00:00:00Z' }) },
      { exists: false, data: () => undefined },
    ])

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.skies).toHaveLength(1)
    expect(jsonArg.skies[0].skyId).toBe('sky-a')
  })
})

// ─── updateSky ───────────────────────────────────────────────

describe('updateSky', () => {
  it('actualiza titulo exitosamente como owner', async () => {
    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: { title: 'Nuevo Titulo' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.skyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nuevo Titulo', updatedAt: expect.any(String) }),
    )
  })

  it('actualiza personalization con merge parcial', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true,
      sky: {
        title: 'Test Sky',
        personalization: { density: 'medium', nebulaEnabled: true, twinkleEnabled: true, shootingStarsEnabled: false },
      },
      member: { role: 'owner', status: 'active' },
    } as any)

    const res = makeRes()
    await updateSky(makeReq({
      routeParams: { skyId: 'sky-1' },
      body: { personalization: { density: 'high' } },
    }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.skyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        personalization: {
          density: 'high',
          nebulaEnabled: true,
          twinkleEnabled: true,
          shootingStarsEnabled: false,
        },
      }),
    )
  })

  it('rechaza con 403 si no es owner', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)

    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: { title: 'X' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede modificar el cielo' })
  })

  it('rechaza campos no permitidos en personalization', async () => {
    const res = makeRes()
    await updateSky(makeReq({
      routeParams: { skyId: 'sky-1' },
      body: { personalization: { hackedField: true } },
    }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Campos no permitidos: hackedField' })
  })

  it('rechaza si no se envia ni title ni personalization', async () => {
    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Se requiere al menos title o personalization' })
  })
})

// ─── deleteSky ───────────────────────────────────────────────

describe('deleteSky', () => {
  it('elimina cielo con estrellas, miembros e invites pendientes', async () => {
    mocks.starsGet.mockResolvedValue({
      docs: [
        { ref: { id: 'star-1' }, data: () => ({ imagePath: 'stars/sky-1/star-1/image' }) },
        { ref: { id: 'star-2' }, data: () => ({ imagePath: null }) },
      ],
    })
    mocks.subMembersGet.mockResolvedValue({
      docs: [
        { ref: { id: 'member-1' } },
        { ref: { id: 'member-2' } },
      ],
    })
    mocks.invitesQuery.get.mockResolvedValue({
      docs: [
        { ref: { id: 'invite-1' } },
      ],
    })

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    // 2 stars + 2 members + 1 sky doc = 5 deletes
    expect(mocks.batchDelete).toHaveBeenCalledTimes(5)
    // 1 invite actualizado a revoked
    expect(mocks.batchUpdate).toHaveBeenCalledWith(
      { id: 'invite-1' },
      { status: 'revoked' },
    )
    expect(mocks.batchCommit).toHaveBeenCalled()
    // Storage cleanup: solo star con imagen
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/image')
    expect(mocks.storageDelete).toHaveBeenCalledTimes(1)
  })

  it('rechaza con 403 si no es owner', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede eliminar el cielo' })
    expect(mocks.batchDelete).not.toHaveBeenCalled()
  })

  it('completa aunque Storage cleanup falle', async () => {
    mocks.starsGet.mockResolvedValue({
      docs: [
        { ref: { id: 'star-1' }, data: () => ({ imagePath: 'stars/sky-1/star-1/image' }) },
      ],
    })
    mocks.subMembersGet.mockResolvedValue({ docs: [] })
    mocks.storageDelete.mockRejectedValue(new Error('Storage unavailable'))

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.batchCommit).toHaveBeenCalled()
  })
})
```

### Compatibilidad con tests existentes

Los cambios en el mock setup son **aditivos**. Los tests existentes de `createSky` y `updateSkyTheme` no usan los nuevos mocks (`starsGet`, `subMembersGet`, `storageFile`, `batchDelete`, `batchUpdate`, `invitesQuery`, `getAll`). Los defaults en `beforeEach` inicializan estos mocks en estados neutros (arrays vacios, resolves vacios).

Verificado que los paths de mock existentes no cambian:
- `db.collection('skies').doc().id` sigue retornando `'sky-new'` ✓
- `db.collection('skies').doc().collection('members').doc()` sigue retornando `{}` ✓
- `db.batch().set/commit` siguen disponibles ✓
- `db.collectionGroup('members')` sigue retornando `membersQuery` ✓

### Decisiones de diseno

- **Mock de `storage` exportado.** `deleteSky` importa `storage` de `firebaseAdmin`. El mock agrega `storage.bucket().file().delete()` en la misma declaracion de `vi.mock`.
- **`invitesQuery` como mock reutilizable.** Se define en `vi.hoisted()` como un query chainable (`.where().where().get()`), similar al patron de `membersQuery`. Esto permite configurar resultados en cada test.
- **`batchDelete` y `batchUpdate` separados.** `deleteSky` usa `batch.delete()` para stars/members/sky y `batch.update()` para invites. Separar los mocks permite assertions precisas sobre que se elimina vs que se actualiza.
- **`subMembersGet` vs `collectionGroupGet`.** `getUserSkies` usa `collectionGroup('members')` (query cross-collection), mientras `deleteSky` usa `skyRef.collection('members').get()` (subcollection directa). Mocks separados evitan colision.
- **`getUserSkies` verifica orden.** El handler ordena por `createdAt` descending. El test configura dos cielos con fechas diferentes y verifica que el mas reciente aparece primero.
- **Supuesto implicito en `getUserSkies`: `getAll` preserva orden posicional.** Los tests asumen que `db.getAll(refA, refB)` retorna `[snapA, snapB]` en el mismo orden. Esto es correcto — Firestore `getAll` garantiza orden posicional. Si el handler cambiara a reads paralelos individuales (`Promise.all(refs.map(r => r.get()))`), los tests seguirian funcionando porque `Promise.all` tambien preserva orden. Solo fallarian si se usara un patron no-ordenado como `Promise.allSettled` con reordenamiento.

---

## Orden de implementacion

| Paso | Task | Archivo | Tests nuevos | Razon del orden |
|------|------|---------|-------------|-----------------|
| 1 | Task 1 | `members.test.ts` (CREAR) | ~20 | Archivo nuevo, sin riesgo de conflicto. Quick win. |
| 2 | Task 2 | `stars.test.ts` (EXTENDER) | ~10 | Solo agrega 1 import + 3 describe blocks al final. |
| 3 | Task 3 | `skies.test.ts` (EXTENDER) | ~14 | Requiere reescritura de mock setup. Mayor complejidad. |

### Dependencias

- **Task 1 y Task 2 son independientes** — se pueden implementar en paralelo.
- **Task 3 depende de verificar que los tests existentes de `createSky` y `updateSkyTheme` siguen pasando** despues de la reescritura del mock setup.
- **No hay dependencias con `SPEC-Pagos-Wompi`** — son cambios en archivos diferentes.

---

## Verificacion

### Antes de cada commit

```bash
# Task 1
cd functions && npx vitest run src/handlers/members.test.ts

# Task 2
cd functions && npx vitest run src/handlers/stars.test.ts

# Task 3
cd functions && npx vitest run src/handlers/skies.test.ts

# Siempre: verificar que no se rompio nada
cd functions && npx vitest run
cd functions && npx tsc --noEmit
```

### Conteo esperado de tests

| Archivo | Antes | Despues | Delta |
|---------|-------|---------|-------|
| `members.test.ts` | 0 (no existe) | ~20 | +20 |
| `stars.test.ts` | 15 | ~25 | +10 |
| `skies.test.ts` | 5 | ~19 | +14 |
| **Total proyecto** | **150** | **~194** | **+44** |

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Reescritura de mock en `skies.test.ts` rompe tests existentes | Media | Correr `vitest run src/handlers/skies.test.ts` despues de la reescritura, ANTES de agregar tests nuevos. |
| Mock de `doc(id)` en members no distingue bien caller vs target | Baja | El dispatch es por ID: `'test-uid'` = caller, cualquier otro = target. Solo falla si un test usa `'test-uid'` como target. |
| `vi.mocked(getSkyWithAccess).mockResolvedValueOnce()` contamina el siguiente test | Baja | `mockResolvedValueOnce` se consume en la primera llamada. Si el handler llama `getSkyWithAccess` dos veces, la segunda usaria el mock global. No es el caso — cada handler llama `getSkyWithAccess` exactamente una vez. |
| TypeScript rechaza `as any` en overrides de getSkyWithAccess | Muy baja | `as any` es standard en tests Vitest para mocks parciales. Si se prefiere type-safe, se puede crear un helper `mockAccess(...)` con los tipos correctos. |

---

## Lo que NO cubre este SPEC

- **Tests de frontend** (B3 de la auditoria): hooks, componentes, `api/client.ts`. Requieren patrones de testing diferentes (React Testing Library).
- **Tests unitarios de lib** (B2): `acceptInvite`, `revokeInvite`, `getSkyWithAccess`. Se testean indirectamente via handlers. Si se quieren tests directos, seria un SPEC separado.
- **Tests de validacion de input**: titulo vacio, titulo largo, coordenadas fuera de rango. El scope de este SPEC es **control de acceso y permisos**, no validacion de campos.

### Nota sobre `getSkyWithAccess` — el gap mas critico restante

`getSkyWithAccess` es la funcion central de autorizacion de toda la app. Cada handler que opera sobre un cielo la llama para verificar que el usuario es miembro activo. **Todos los tests del proyecto la mockean** — nunca se ejecuta la implementacion real. Esto significa que si `getSkyWithAccess` tiene un bug (ej: retorna `ok: true` para un usuario que no es miembro, o no verifica `status === 'active'`), ninguno de los ~194 tests lo detectaria.

Este SPEC agrega tests que verifican que los handlers *respetan* el resultado de `getSkyWithAccess` (Task 2 y 3 con overrides de `ok: false`). Pero no verifica que `getSkyWithAccess` *produce* el resultado correcto.

**Recomendacion:** Un SPEC separado para tests unitarios de `getSkyWithAccess` con mocks de Firestore (no de la funcion misma). Ese SPEC tendria ~8 tests: miembro activo, miembro revocado, no-miembro, cielo no existe, error de DB, y combinaciones de roles. Es el siguiente paso logico despues de este SPEC.
