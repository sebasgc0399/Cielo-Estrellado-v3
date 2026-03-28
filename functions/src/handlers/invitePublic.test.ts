import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const TODAY = '2026-01-15'

const mocks = vi.hoisted(() => {
  const transaction = { get: vi.fn(), update: vi.fn(), set: vi.fn() }
  const txAdd = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const txDocRef = { id: 'tx-doc-ref' }
  const userGet = vi.fn()
  const membersGet = vi.fn()

  const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: membersGet,
  }
  membersQuery.where.mockReturnValue(membersQuery)

  const userRef = {
    get: userGet,
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return { add: txAdd, doc: vi.fn().mockReturnValue(txDocRef) }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: Function) => fn(transaction))

  // New mocks for previewInvite
  const invitesGet = vi.fn()
  const invitesQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    limit: vi.fn(),
    get: invitesGet,
  }
  invitesQuery.where.mockReturnValue(invitesQuery)
  invitesQuery.limit.mockReturnValue(invitesQuery)

  const skyGet = vi.fn()

  // New mocks for Fix 4 (MAX_MEMBERS_PER_SKY)
  const inviteDocGet = vi.fn()
  const skyMembersCountGet = vi.fn()
  const skyMembersCountQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    count: vi.fn(),
    get: skyMembersCountGet,
  }
  skyMembersCountQuery.where.mockReturnValue(skyMembersCountQuery)
  skyMembersCountQuery.count.mockReturnValue({ get: skyMembersCountGet })

  return {
    transaction, txAdd, txDocRef, userGet, membersGet, membersQuery, userRef, runTransaction,
    invitesGet, invitesQuery, skyGet, inviteDocGet, skyMembersCountGet, skyMembersCountQuery,
  }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/findInviteIdByToken.js', () => ({
  findInviteIdByToken: vi.fn().mockResolvedValue('invite-123'),
}))

vi.mock('../lib/acceptInvite.js', () => ({
  acceptInvite: vi.fn().mockResolvedValue({ skyId: 'sky-1' }),
  InviteError: class InviteError extends Error {
    constructor(public code: string, message: string, public skyId?: string) { super(message) }
  },
}))

vi.mock('../logError.js', () => ({
  logError: vi.fn(),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: vi.fn().mockReturnValue(mocks.userRef) }
      if (name === 'invites') return {
        where: (...args: unknown[]) => mocks.invitesQuery.where(...args),
        doc: vi.fn().mockReturnValue({ get: mocks.inviteDocGet }),
      }
      if (name === 'skies') return {
        doc: vi.fn().mockReturnValue({
          get: mocks.skyGet,
          collection: vi.fn().mockReturnValue(mocks.skyMembersCountQuery),
        }),
      }
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    runTransaction: mocks.runTransaction,
  },
}))

import { acceptInviteHandler, previewInvite } from './invitePublic'

function makeReq() {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { token: 'test-token-123' },
    body: {},
    query: {},
  } as unknown as Request
}

function makePreviewReq(token = 'test-token-123') {
  return {
    routeParams: { token },
  } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  vi.clearAllMocks()
  mocks.transaction.get.mockReset()
  mocks.transaction.update.mockReset()
  mocks.transaction.set.mockReset()
  mocks.txAdd.mockResolvedValue({ id: 'tx-id' })
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'transactions') return { add: mocks.txAdd, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
    return {}
  })

  // Reset previewInvite mocks
  mocks.invitesQuery.where.mockReturnValue(mocks.invitesQuery)
  mocks.invitesQuery.limit.mockReturnValue(mocks.invitesQuery)
  mocks.invitesGet.mockReset()
  mocks.skyGet.mockReset()

  // Reset Fix 4 mocks with sensible defaults so existing tests pass
  mocks.inviteDocGet.mockResolvedValue({ exists: true, data: () => ({ skyId: 'sky-1' }) })
  mocks.skyMembersCountGet.mockResolvedValue({ data: () => ({ count: 0 }) })
  mocks.skyMembersCountQuery.where.mockReturnValue(mocks.skyMembersCountQuery)
  mocks.skyMembersCountQuery.count.mockReturnValue({ get: mocks.skyMembersCountGet })
})

afterEach(() => { vi.useRealTimers() })

describe('previewInvite', () => {
  it('retorna valid:true para invite pendiente no expirada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ status: 'pending', expiresAt: '2026-02-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }) }],
    })
    mocks.skyGet.mockResolvedValue({ exists: true, data: () => ({ title: 'Mi Cielo' }) })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      valid: true,
      skyId: 'sky-1',
      skyTitle: 'Mi Cielo',
      role: 'editor',
    })
  })

  it('retorna valid:false para invite expirada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ status: 'pending', expiresAt: '2026-01-14T00:00:00Z', skyId: 'sky-1', role: 'editor' }) }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para invite revocada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ status: 'revoked', expiresAt: '2026-02-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }) }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para invite aceptada', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ status: 'accepted', expiresAt: '2026-02-01T00:00:00Z', skyId: 'sky-1', role: 'editor' }) }],
    })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna valid:false para token no encontrado', async () => {
    mocks.invitesGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ valid: false })
  })

  it('retorna skyTitle por defecto si cielo no existe', async () => {
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ status: 'pending', expiresAt: '2026-02-01T00:00:00Z', skyId: 'sky-gone', role: 'viewer' }) }],
    })
    mocks.skyGet.mockResolvedValue({ exists: false, data: () => null })

    const res = makeRes()
    await previewInvite(makePreviewReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      valid: true,
      skyId: 'sky-gone',
      skyTitle: 'Cielo sin nombre',
      role: 'viewer',
    })
  })
})

describe('acceptInviteHandler', () => {
  it('valida maxMemberships antes de aceptar', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 20 })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('otorga INVITE_ACCEPTED_REWARD', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ stardust: 100, acceptedInvitesToday: 0, lastInviteAcceptDate: null }),
    })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ rewards: expect.objectContaining({ stardustEarned: 30 }) }),
    )
  })

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
    expect(mocks.txAdd).not.toHaveBeenCalled()
  })

  it('respeta cap diario de invitaciones', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ stardust: 100, acceptedInvitesToday: 5, lastInviteAcceptDate: TODAY }),
    })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ rewards: expect.objectContaining({ stardustEarned: 0 }) }),
    )
  })

  it('retorna 404 si findInviteIdByToken retorna null', async () => {
    const { findInviteIdByToken } = await import('../lib/findInviteIdByToken.js')
    vi.mocked(findInviteIdByToken).mockResolvedValueOnce(null)

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invitación no encontrada' })
  })

  it('retorna 409 para invite expirada', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })

    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('invite_expired', 'Expirada'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Esta invitación ha expirado' })
  })

  it('retorna 409 para invite revocada', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })

    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('invite_revoked', 'Revocada'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Esta invitación fue revocada' })
  })

  it('retorna 409 para already_member con skyId', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })

    const { acceptInvite, InviteError } = await import('../lib/acceptInvite.js')
    vi.mocked(acceptInvite).mockRejectedValueOnce(new InviteError('already_member', 'Ya eres miembro', 'sky-1'))

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Ya eres miembro de este cielo', skyId: 'sky-1' })
  })

  it('retorna 403 si cielo alcanzo MAX_MEMBERS_PER_SKY', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxMemberships: 20 }) })
    mocks.membersGet.mockResolvedValue({ size: 5 })
    mocks.skyMembersCountGet.mockResolvedValue({ data: () => ({ count: 50 }) })

    const res = makeRes()
    await acceptInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Este cielo ha alcanzado el límite de miembros', maxMembers: 50 })
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
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ skyId: 'sky-1' }),
    )
  })
})
