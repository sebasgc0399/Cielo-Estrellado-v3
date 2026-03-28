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

  return { transaction, txAdd, txDocRef, userGet, membersGet, membersQuery, userRef, runTransaction }
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
    constructor(public code: string, message: string) { super(message) }
  },
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: vi.fn().mockReturnValue(mocks.userRef) }
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    runTransaction: mocks.runTransaction,
  },
}))

import { acceptInviteHandler } from './invitePublic'

function makeReq() {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { token: 'test-token-123' },
    body: {},
    query: {},
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
})

afterEach(() => { vi.useRealTimers() })

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
})
