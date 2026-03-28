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
