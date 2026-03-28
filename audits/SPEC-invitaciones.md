# SPEC: Correcciones al Sistema de Invitaciones

**Fecha:** 2026-03-28
**Estado:** Pendiente
**Origen:** `audits/08-invitaciones.md` (auditoria de seguridad) + hallazgos adicionales de exploracion de codigo
**Archivos afectados:**
- `functions/src/handlers/invites.ts` (createInviteHandler — rate limit)
- `functions/src/handlers/invitePublic.ts` (acceptInviteHandler — max members, previewInvite — comentario)
- `functions/src/lib/createInvite.ts` (comentario TTL)
- `functions/src/domain/economyRules.ts` (nuevas constantes)
- `functions/src/handlers/invitePublic.test.ts` (tests existentes a expandir)
- `functions/src/handlers/invites.test.ts` (archivo nuevo de tests)

## Contexto

Una auditoria de seguridad identifico 4 hallazgos (1 medio, 3 bajos) en el sistema de invitaciones. Adicionalmente, una exploracion del codigo revelo que no existe limite de miembros por cielo (un owner puede invitar ilimitados miembros) y que la cobertura de tests es insuficiente: `invitePublic.test.ts` solo tiene 4 tests para `acceptInviteHandler`, sin tests para `previewInvite`; y no existe archivo de tests para `invites.ts` (createInviteHandler, listInvites, revokeInviteHandler).

El sistema existente esta bien disenado: tokens de 256 bits, hash SHA-256, aceptacion atomica via transaccion, validacion completa de estados. Los fixes son mejoras defensivas y de cobertura.

Este documento describe cada fix con codigo exacto, lineas de referencia y decisiones de diseno. Un desarrollador puede implementar sin leer la auditoria original.

---

## Fix 1: Rate limiting de invitaciones pendientes por cielo [M1 — Severidad Media]

### Problema

El endpoint `createInviteHandler` no tiene limite de invitaciones pendientes por cielo. Un owner (o un script usando su token) puede crear invitaciones sin limite, acumulando documentos en Firestore y generando costos de almacenamiento.

### Archivo y ubicacion

`functions/src/handlers/invites.ts` — insertar entre linea 33 (fin de validacion de owner) y linea 35 (lectura de `appUrl`).

`functions/src/domain/economyRules.ts` — agregar constante al final del archivo.

### Cambios requeridos

**1a. Agregar constante en `economyRules.ts` (despues de linea 10):**

```typescript
export const MAX_PENDING_INVITES_PER_SKY = 10
```

**1b. Agregar import en `invites.ts` (linea 8, nuevo import):**

```typescript
import { MAX_PENDING_INVITES_PER_SKY } from '../domain/economyRules.js'
```

**1c. Agregar query de conteo en `createInviteHandler` (despues de la validacion de owner, linea 33):**

```typescript
    const nowISO = new Date().toISOString()
    const pendingSnap = await db.collection('invites')
      .where('skyId', '==', skyId)
      .where('status', '==', 'pending')
      .where('expiresAt', '>', nowISO)
      .count()
      .get()

    if (pendingSnap.data().count >= MAX_PENDING_INVITES_PER_SKY) {
      res.status(429).json({ error: 'Demasiadas invitaciones pendientes para este cielo' })
      return
    }
```

### Indice Firestore requerido

Este query necesita un indice compuesto en la coleccion `invites`:
- **Campos:** `skyId` (ASC), `status` (ASC), `expiresAt` (ASC)
- **Prerequisito:** Este indice ya esta definido en `SPEC-Firestore-rules` Fix 0 (`firestore.indexes.json`). Si ese SPEC ya se implemento (incluyendo la correccion de la clave duplicada en `firebase.json`), el indice ya existe y no necesita crearse de nuevo. Si no se implemento, crear el indice manualmente desde la consola de Firebase — el deploy automatico no funcionara mientras la clave `"rules"` duplicada en `firebase.json` siga activa.

### Decisiones de diseno

- **Limite por cielo, no por owner.** El abuso es acumular invites en un cielo especifico. Un owner con multiples cielos puede crear 10 invites en cada uno — eso es comportamiento legitimo.
- **Filtro por expiresAt:** Se agrega `.where('expiresAt', '>', nowISO)` para no contar invites que ya expiraron pero siguen con status `pending` en Firestore (no hay job que cambie su status). Sin este filtro, un owner podria quedar bloqueado por invites fantasma hasta que la TTL policy (Fix 2) las elimine. Con el filtro, el conteo refleja solo invites activas.
- **Se usa `.count().get()`** en lugar de `.get()` para evitar transferir documentos completos. El patron ya esta establecido en `payments.ts`.
- **Limite de 10** es generoso para uso legitimo (un owner rara vez necesita mas de 3-5 invites pendientes simultaneas) pero previene abuso automatizado.
- **429 en lugar de 400:** Semantica HTTP correcta para rate limiting. El cliente entiende que puede reintentar despues (revocando invites viejas o esperando a que expiren).

---

## Fix 2: Firestore TTL policy para invitaciones expiradas [B1 — Severidad Baja]

### Problema

Las invitaciones tienen `expiresAt` (7 dias, via `INVITE_TTL_MS`). Cuando expiran, son rechazadas por `acceptInvite`, `previewInvite`, `listInvites` y `revokeInvite`. Sin embargo, el documento permanece en Firestore con status `pending` indefinidamente. No hay job de limpieza ni TTL policy.

### Solucion: TTL Policy de Firestore (configuracion, no codigo)

**Configuracion en consola de Firebase:**

1. Ir a Firestore Database → TTL policies
2. Crear nueva policy:
   - **Coleccion:** `invites`
   - **Campo:** `expiresAt`
3. Firestore eliminara documentos cuando `expiresAt` haya pasado (con retraso tipico de 24-72 horas)

**Alternativa CLI:**

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=invites \
  --enable-ttl
```

### Cambio en codigo (comentario informativo)

**`functions/src/lib/createInvite.ts` — agregar comentario antes de la linea 15 (`await db.collection('invites').add`):**

```typescript
  // La coleccion 'invites' tiene una TTL policy de Firestore configurada
  // sobre el campo 'expiresAt'. Firestore elimina automaticamente los documentos
  // expirados (con retraso tipico de 24-72h). Ver SPEC-invitaciones.md Fix 2.
  await db.collection('invites').add({
```

### Decisiones de diseno

- **TTL policy nativa vs cron job:** La TTL policy es zero-maintenance — no requiere Cloud Functions, no tiene cold starts, no falla por timeouts.
- **Sin margen adicional:** Se usa `expiresAt` directamente. El retraso de Firestore (24-72h) da tiempo suficiente para que cualquier operacion en curso se complete.
- **`expiresAt` convertido a Timestamp nativo (RESUELTO 2026-03-28):** Firestore TTL requiere tipo `Timestamp`, no string. Se convirtio `expiresAt` de ISO string a `Timestamp.fromDate()` en `createInvite.ts:24`. Se actualizaron todos los consumidores (`acceptInvite.ts`, `revokeInvite.ts`, `invitePublic.ts`, `invites.ts`) para usar `.toDate()` en comparaciones. Se actualizo el tipo en `contracts.ts:82` de `IsoDateString` a `FirebaseFirestore.Timestamp`. Los documentos viejos con formato string se eliminaron manualmente (0-3 docs). La TTL policy se configuro via `gcloud firestore fields ttls update` y esta activa (`state: ACTIVE`).
- **Impacto en Fix 1:** Con la TTL policy activa, los documentos expirados se eliminan automaticamente. Fix 1 ya filtra por `expiresAt > Timestamp.now()` asi que no depende de la TTL, pero la TTL mantiene la coleccion limpia para otros queries (como `listInvites`).

---

## Fix 3: Comentario explicativo en previewInvite [B3 — Severidad Baja]

### Problema

`previewInvite` busca invites por `tokenHash` sin filtrar por status (linea 20-23 de `invitePublic.ts`), mientras que `findInviteIdByToken` filtra por `status == 'pending'` (linea 8-9 de `findInviteIdByToken.ts`). La diferencia es intencional pero puede confundir a futuros desarrolladores.

### Archivo y ubicacion

`functions/src/handlers/invitePublic.ts` — linea 17, reemplazar el comentario existente `// Inline getInviteByToken logic`.

### Codigo actual

```typescript
    // Inline getInviteByToken logic
    const tokenHash = createHash('sha256').update(token).digest('hex')
```

### Codigo propuesto

```typescript
    // Busca sin filtrar por status intencionalmente: preview debe retornar
    // { valid: false } para invites aceptadas/revocadas/expiradas, en vez de
    // un generico 404. Esto da feedback al usuario sobre por que el enlace
    // ya no funciona. Contrasta con findInviteIdByToken() que SI filtra por
    // status 'pending' porque solo necesita encontrar invites aceptables.
    const tokenHash = createHash('sha256').update(token).digest('hex')
```

### Decisiones de diseno

- Solo un comentario. Sin cambio funcional.
- Reemplaza el comentario generico `// Inline getInviteByToken logic` con explicacion del *por que*.
- Menciona `findInviteIdByToken` por nombre para que un `grep` conecte ambos flujos.

---

## Fix 4: Limite de miembros por cielo (MAX_MEMBERS_PER_SKY) [NUEVO — No en auditoria]

### Problema

En `acceptInviteHandler` (invitePublic.ts:66-79), se verifica `maxMemberships` (cuantos cielos puede UNIRSE un usuario), pero NO se verifica cuantos miembros tiene el cielo destino. Un owner podria invitar ilimitados miembros a un solo cielo, causando problemas de rendimiento en queries de miembros y costos desproporcionados en Firestore.

### Archivo y ubicacion

`functions/src/handlers/invitePublic.ts` — insertar entre linea 79 (fin de validacion de maxMemberships) y linea 81 (llamada a `acceptInvite`).

`functions/src/domain/economyRules.ts` — agregar constante.

### Cambios requeridos

**4a. Agregar constante en `economyRules.ts` (despues de `MAX_PENDING_INVITES_PER_SKY`):**

```typescript
export const MAX_MEMBERS_PER_SKY = 50
```

**4b. Expandir import en `invitePublic.ts` (linea 9):**

```typescript
import { INVITE_ACCEPTED_REWARD, MAX_INVITE_REWARDS_PER_DAY, MAX_MEMBERS_PER_SKY } from '../domain/economyRules.js'
```

**4c. Agregar validacion despues del check de maxMemberships (despues de linea 79):**

```typescript
    // Verificar que el cielo no exceda su limite de miembros
    const inviteSnap = await db.collection('invites').doc(inviteId).get()
    if (!inviteSnap.exists) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }
    const inviteData = inviteSnap.data() as InviteRecord

    const skyMembersSnap = await db
      .collection('skies')
      .doc(inviteData.skyId)
      .collection('members')
      .where('status', '==', 'active')
      .count()
      .get()

    if (skyMembersSnap.data().count >= MAX_MEMBERS_PER_SKY) {
      res.status(403).json({ error: 'Este cielo ha alcanzado el límite de miembros', maxMembers: MAX_MEMBERS_PER_SKY })
      return
    }
```

### Decisiones de diseno

- **Limite de 50** es generoso para un cielo compartido (familia, equipo, clase). Ajustable si se necesita.
- **403 en lugar de 429:** No es rate limiting del usuario — es una restriccion del recurso (cielo lleno). 403 (Forbidden) es la semantica correcta.
- **Se lee el invite para obtener skyId:** `findInviteIdByToken` (linea 60) solo retorna el `inviteId`, no el `skyId`. Este read extra es un documento individual (~1ms), solo ocurre en happy path despues de pasar todas las validaciones previas. Alternativa descartada: modificar `findInviteIdByToken` para retornar tambien `skyId` — cambia la interfaz de la lib sin necesidad.
- **Validacion ANTES de `acceptInvite()`:** Evita entrar en la transaccion atomica solo para fallar por cielo lleno. Reduce contencion.
- **Race condition aceptable:** Entre el count y el `acceptInvite`, otro usuario podria aceptar una invite al mismo cielo, excediendo el limite por 1. La diferencia entre 50 y 51 miembros es insignificante; mover el count dentro de la transaccion de `acceptInvite` aumentaria la complejidad y la superficie de contencion sin beneficio proporcional.
- **Count incluye owner:** El owner es un miembro con role `owner` y status `active`, asi que se cuenta. El limite de 50 incluye al owner (49 invitados + 1 owner).

---

## Plan de tests

### Tests existentes que NO necesitan modificacion

Los 4 tests existentes en `invitePublic.test.ts` no necesitan cambios. Los mocks actuales seguiran funcionando con Fix 4 porque el mock de `db.collection('invites').doc().get()` y el mock de `db.collection('skies').doc().collection('members')` deben agregarse como nuevos mocks sin alterar los existentes.

### Mocks a agregar en invitePublic.test.ts

**En `vi.hoisted()` (linea 7-31) — agregar al return:**

```typescript
  // Para queries de previewInvite
  const invitesGet = vi.fn()
  const invitesWhere = vi.fn()
  const invitesLimit = vi.fn()
  const skyGet = vi.fn()

  // Para count query de MAX_MEMBERS_PER_SKY (Fix 4)
  const skyMembersCountGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
  const skyMembersCountFn = vi.fn().mockReturnValue({ get: skyMembersCountGet })
  const skyMembersWhere = vi.fn().mockReturnValue({ count: skyMembersCountFn })

  // Para invite doc get (Fix 4 — leer invite para obtener skyId)
  const inviteDocGet = vi.fn().mockResolvedValue({
    exists: true,
    data: () => ({ skyId: 'sky-1', role: 'editor', tokenHash: 'hash', status: 'pending', expiresAt: '2099-01-01T00:00:00Z' }),
  })
```

**Actualizar mock de `firebaseAdmin` para soportar invites y skies:**

```typescript
vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: vi.fn().mockReturnValue(mocks.userRef) }
      if (name === 'invites') {
        const whereChain: Record<string, unknown> = {
          where: mocks.invitesWhere,
          limit: mocks.invitesLimit,
          get: mocks.invitesGet,
        }
        mocks.invitesWhere.mockReturnValue(whereChain)
        mocks.invitesLimit.mockReturnValue({ get: mocks.invitesGet })
        return {
          where: mocks.invitesWhere,
          doc: vi.fn().mockReturnValue({ get: mocks.inviteDocGet }),
        }
      }
      if (name === 'skies') {
        return {
          doc: vi.fn().mockReturnValue({
            get: mocks.skyGet,
            collection: vi.fn((sub: string) => {
              if (sub === 'members') return { where: mocks.skyMembersWhere }
              return {}
            }),
          }),
        }
      }
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    runTransaction: mocks.runTransaction,
  },
}))
```

**Actualizar import (linea 59):**

```typescript
import { previewInvite, acceptInviteHandler } from './invitePublic'
```

**Agregar mock de logError:**

```typescript
vi.mock('../logError.js', () => ({ logError: vi.fn() }))
```

**Agregar helper makePreviewReq:**

```typescript
function makePreviewReq(token = 'test-token-123') {
  return {
    headers: {},
    routeParams: { token },
    body: {},
    query: {},
  } as unknown as Request
}
```

**Agregar resets en `beforeEach` (despues de linea 90):**

```typescript
  mocks.skyMembersCountGet.mockResolvedValue({ data: () => ({ count: 0 }) })
  mocks.inviteDocGet.mockResolvedValue({
    exists: true,
    data: () => ({ skyId: 'sky-1', role: 'editor', status: 'pending', expiresAt: '2099-01-01T00:00:00Z' }),
  })
```

### Nuevos tests — describe('previewInvite')

```typescript
describe('previewInvite', () => {
  it('retorna valid:true para invite pendiente no expirada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ status: 'pending', expiresAt: '2099-01-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }),
      }],
    })
    mocks.skyGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Mi Cielo' }) })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true, skyTitle: 'Mi Cielo', role: 'editor' }),
    )
  })

  it('retorna valid:false para invite expirada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ status: 'pending', expiresAt: '2020-01-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }),
      }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para invite revocada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ status: 'revoked', expiresAt: '2099-01-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }),
      }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para invite aceptada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ status: 'accepted', expiresAt: '2099-01-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }),
      }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para token no encontrado', async () => {
    mocks.invitesGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna skyTitle por defecto si cielo no existe', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({ status: 'pending', expiresAt: '2099-01-01T00:00:00Z', skyId: 'sky-1', role: 'viewer' }),
      }],
    })
    mocks.skyGet.mockResolvedValue({ exists: false, data: () => null })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ valid: true, skyTitle: 'Cielo sin nombre' }),
    )
  })
})
```

### Nuevos tests — agregar a describe('acceptInviteHandler')

```typescript
  it('retorna 404 si findInviteIdByToken retorna null', async () => {
    const { findInviteIdByToken } = await import('../lib/findInviteIdByToken.js')
    vi.mocked(findInviteIdByToken).mockResolvedValueOnce(null)

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('retorna 409 para invite expirada', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('invite_expired', 'Expirada'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para invite revocada', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('invite_revoked', 'Revocada'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para already_member con skyId', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('already_member', 'Ya miembro', 'sky-1'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ skyId: 'sky-1' }))
  })

  it('retorna 403 si cielo alcanzo MAX_MEMBERS_PER_SKY', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    mocks.skyMembersCountGet.mockResolvedValue({ data: () => ({ count: 50 }) })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ maxMembers: 50 }))
  })

  it('permite aceptar si miembros del cielo estan bajo el limite', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    mocks.skyMembersCountGet.mockResolvedValue({ data: () => ({ count: 49 }) })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ stardust: 100, acceptedInvitesToday: 0, lastInviteAcceptDate: null }),
    })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
  })
```

### Conteo esperado invitePublic.test.ts

- **Antes:** 4 tests (todos acceptInviteHandler)
- **Despues:** 16 tests (6 previewInvite + 10 acceptInviteHandler)
- **Delta:** +12

---

## Fix 5: Nuevo archivo de tests para invites.ts

### Archivo nuevo

`functions/src/handlers/invites.test.ts`

### Estructura de mocks

```typescript
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const createInviteMock = vi.fn().mockResolvedValue({ token: 'generated-token' })
  const revokeInviteMock = vi.fn().mockResolvedValue(undefined)
  const memberGet = vi.fn()
  const invitesGet = vi.fn()
  const invitesWhere = vi.fn()

  // Para count query de rate limit (Fix 1)
  const countGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
  const countFn = vi.fn().mockReturnValue({ get: countGet })

  return { createInviteMock, revokeInviteMock, memberGet, invitesGet, invitesWhere, countGet, countFn }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'owner-uid' }),
}))

vi.mock('../lib/createInvite.js', () => ({
  createInvite: mocks.createInviteMock,
}))

vi.mock('../lib/revokeInvite.js', () => ({
  revokeInvite: mocks.revokeInviteMock,
  RevokeError: class RevokeError extends Error {
    constructor(public code: string, message: string) {
      super(message)
      this.name = 'RevokeError'
    }
  },
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'skies') {
        return {
          doc: vi.fn().mockReturnValue({
            collection: vi.fn((sub: string) => {
              if (sub === 'members') return { doc: vi.fn().mockReturnValue({ get: mocks.memberGet }) }
              return {}
            }),
          }),
        }
      }
      if (name === 'invites') {
        const whereChain: Record<string, unknown> = {
          where: mocks.invitesWhere,
          orderBy: vi.fn().mockReturnValue({ get: mocks.invitesGet }),
          count: mocks.countFn,
          get: mocks.invitesGet,
        }
        mocks.invitesWhere.mockReturnValue(whereChain)
        return { where: mocks.invitesWhere }
      }
      return {}
    }),
  },
}))

vi.mock('../logError.js', () => ({ logError: vi.fn() }))

import { createInviteHandler, listInvites, revokeInviteHandler } from './invites'
```

### Helpers

```typescript
function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', inviteId: 'invite-1' },
    body: {},
    query: {},
    ...overrides,
  } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

function setupOwner() {
  mocks.memberGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'owner' }),
  })
}

function setupEditor() {
  mocks.memberGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'editor' }),
  })
}

function setupNotMember() {
  mocks.memberGet.mockResolvedValue({ exists: false })
}
```

### beforeEach

```typescript
beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://test.app'
  mocks.countGet.mockResolvedValue({ data: () => ({ count: 0 }) })
  mocks.invitesWhere.mockReturnValue({
    where: mocks.invitesWhere,
    orderBy: vi.fn().mockReturnValue({ get: mocks.invitesGet }),
    count: mocks.countFn,
    get: mocks.invitesGet,
  })
})
```

### Tests: describe('createInviteHandler') — 9 tests

```typescript
describe('createInviteHandler', () => {
  it('crea invite exitosamente como owner', async () => {
    setupOwner()

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ inviteUrl: expect.stringContaining('https://test.app/invite/') }),
    )
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 400 si rol es invalido', async () => {
    setupOwner()

    const res = makeRes()
    await createInviteHandler(makeReq({ body: { role: 'admin' } }), res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('usa rol editor por defecto si no se especifica', async () => {
    setupOwner()

    const res = makeRes()
    await createInviteHandler(makeReq({ body: {} }), res)

    expect(mocks.createInviteMock).toHaveBeenCalledWith('sky-1', 'editor', 'owner-uid')
  })

  it('pasa rol viewer cuando se especifica', async () => {
    setupOwner()

    const res = makeRes()
    await createInviteHandler(makeReq({ body: { role: 'viewer' } }), res)

    expect(mocks.createInviteMock).toHaveBeenCalledWith('sky-1', 'viewer', 'owner-uid')
  })

  it('retorna 500 si APP_URL no esta configurado', async () => {
    setupOwner()
    delete process.env.APP_URL

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('rechaza con 429 si excede MAX_PENDING_INVITES_PER_SKY', async () => {
    setupOwner()
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 10 }) })

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('pendientes') }),
    )
    expect(mocks.createInviteMock).not.toHaveBeenCalled()
  })

  it('permite creacion si invites pendientes bajo el limite', async () => {
    setupOwner()
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 9 }) })

    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(mocks.createInviteMock).toHaveBeenCalled()
  })
})
```

### Tests: describe('listInvites') — 3 tests

```typescript
describe('listInvites', () => {
  it('lista invites pendientes filtrando expiradas', async () => {
    setupOwner()
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'inv-1', data: () => ({ role: 'editor', expiresAt: '2099-01-01T00:00:00Z' }) },
        { id: 'inv-2', data: () => ({ role: 'viewer', expiresAt: '2020-01-01T00:00:00Z' }) },
      ],
    })

    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      invites: [{ inviteId: 'inv-1', role: 'editor', expiresAt: '2099-01-01T00:00:00Z' }],
    })
  })

  it('retorna array vacio si no hay invites', async () => {
    setupOwner()
    mocks.invitesGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ invites: [] })
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()

    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })
})
```

### Tests: describe('revokeInviteHandler') — 7 tests

```typescript
describe('revokeInviteHandler', () => {
  it('revoca invite exitosamente como owner', async () => {
    mocks.memberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('retorna 404 para invite_not_found', async () => {
    mocks.memberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteMock.mockRejectedValueOnce(new RevokeError('invite_not_found', 'No encontrada'))

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('retorna 409 para invite_already_used', async () => {
    mocks.memberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteMock.mockRejectedValueOnce(new RevokeError('invite_already_used', 'Ya usada'))

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para invite_already_revoked', async () => {
    mocks.memberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteMock.mockRejectedValueOnce(new RevokeError('invite_already_revoked', 'Ya revocada'))

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para invite_expired', async () => {
    mocks.memberGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', role: 'owner' }),
    })
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteMock.mockRejectedValueOnce(new RevokeError('invite_expired', 'Expirada'))

    const res = makeRes()
    await revokeInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })
})
```

### Nota sobre el patron de mock de RevokeError

El mock de `RevokeError` se define inline dentro de `vi.mock('../lib/revokeInvite.js')`, y luego en los tests se importa dinamicamente con `const { RevokeError } = await import(...)`. Esto es intencional y consistente con el patron establecido en `invitePublic.test.ts:41-46` donde `InviteError` se mockea de la misma forma. `vi.mock` intercepta el import dinamico y retorna la clase mockeada, permitiendo crear instancias con el `code` correcto para cada test.

### Conteo invites.test.ts: 19 tests (nuevo archivo)

---

## Orden de implementacion

Los cambios tienen dependencias minimas. El orden va de menor a mayor complejidad y riesgo de conflicto.

| Paso | Fix | Complejidad | Razon del orden |
|------|-----|-------------|-----------------|
| 1 | Fix 3 — Comentario en previewInvite | Minima | 5 lineas de comentario. Sin cambio funcional. Sin dependencias. |
| 2 | Fix 2 — TTL policy + comentario | Minima | Configuracion de consola + 3 lineas de comentario en codigo. Sin dependencias. |
| 3 | Fix 1 — Rate limit invites por cielo | Baja | 1 constante + ~10 lineas en handler. Patron ya establecido en payments.ts. |
| 4 | Fix 4 — MAX_MEMBERS_PER_SKY | Media | 1 constante + ~15 lineas en handler. Requiere leer invite para obtener skyId. |
| 5 | Fix 5 — Tests de invites.ts (nuevo archivo) | Media | 19 tests. Necesita Fix 1 implementado para test de rate limit. |
| 6 | Fix 5 expand — Tests de invitePublic.ts | Media-Alta | Expandir mocks existentes. 12 tests nuevos. Necesita Fix 4 para test de MAX_MEMBERS_PER_SKY. |

### Dependencias entre cambios

- **Fix 1 y Fix 5 (invites.test.ts)** estan acoplados: los tests de createInviteHandler validan el rate limit.
- **Fix 4 y Fix 5 expand (invitePublic.test.ts)** estan acoplados: los tests de acceptInviteHandler validan el limite de miembros.
- **Fix 1 y Fix 4** ambos modifican `economyRules.ts` — implementarlos en secuencia para evitar conflictos en imports.
- **Fix 2 y Fix 3** son independientes de todo.

---

## Verificacion

### Antes de cada commit

```bash
cd functions && npx vitest run src/handlers/invitePublic.test.ts
cd functions && npx vitest run src/handlers/invites.test.ts
cd functions && npx tsc --noEmit
```

### Conteo esperado total de tests

| Archivo | Antes | Despues | Delta |
|---------|-------|---------|-------|
| `invitePublic.test.ts` | 4 | 16 | +12 |
| `invites.test.ts` | 0 (no existe) | 19 | +19 |
| **Total invitaciones** | **4** | **35** | **+31** |

### Checklist post-deploy

- [x] Verificar que el indice compuesto `invites` → `skyId` (ASC), `status` (ASC), `expiresAt` (ASC) existe — desplegado via `firestore.indexes.json`
- [x] Convertir `expiresAt` de ISO string a `Timestamp` nativo en `createInvite.ts` y todos los consumidores (2026-03-28)
- [x] Eliminar documentos viejos con `expiresAt` como string en Firestore (2026-03-28)
- [x] Configurar TTL policy en Firestore: `gcloud firestore fields ttls update expiresAt --collection-group=invites --enable-ttl` — `state: ACTIVE` (2026-03-28)
- [ ] Verificar que un owner no puede crear mas de 10 invitaciones pendientes por cielo
- [ ] Verificar que un cielo con 50 miembros activos rechaza nuevas aceptaciones
- [ ] Verificar que `previewInvite` retorna `valid: false` para invites expiradas/revocadas/aceptadas
- [ ] Revisar que los 35 tests de invitaciones pasan en CI

### Riesgos

| Riesgo | Probabilidad | Mitigacion |
|--------|-------------|------------|
| Indice compuesto de 3 campos no creado antes del deploy (Fix 1) | Media | El error de Firestore incluye link para crearlo. Crear ANTES del deploy. |
| ~~TTL policy NO funciona con ISO strings~~ | ~~Media~~ | **RESUELTO 2026-03-28.** `expiresAt` convertido a `Timestamp` nativo. TTL policy activa. |
| `.count()` no disponible en firebase-admin (Fix 1, 4) | Muy baja | Ya se usa exitosamente en `payments.ts`. La version del SDK es compatible. |
| Race condition en MAX_MEMBERS_PER_SKY (Fix 4) | Baja | Podria exceder por 1-2 miembros en concurrencia extrema. Diferencia insignificante. |
| Mocks de invitePublic.test.ts complejos al expandir (Fix 5 expand) | Media | Seguir patron exacto de payments.test.ts para chainable where/count. Testear incrementalmente. |
| TTL policy elimina invite mientras se acepta (Fix 2) | Muy baja | La TTL tiene retraso de 24-72h post-expiracion. `acceptInvite` ya valida `expiresAt` dentro de la transaccion — si la invite expiro, la transaccion la rechaza mucho antes de que la TTL la elimine. |
