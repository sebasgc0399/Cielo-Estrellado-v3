import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const FIREBASE_USER = {
  uid: 'test-uid',
  email: 'test@example.com',
  displayName: 'Test User',
  photoURL: null,
  emailVerified: true,
  providerData: [{ providerId: 'google.com' }],
}

const mocks = vi.hoisted(() => {
  const transaction = { get: vi.fn(), update: vi.fn() }
  const userGet = vi.fn()
  const userSet = vi.fn().mockResolvedValue(undefined)
  const userUpdate = vi.fn().mockResolvedValue(undefined)
  const txAdd = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const collectionGroupGet = vi.fn().mockResolvedValue({ size: 0 })

  const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: collectionGroupGet,
  }
  membersQuery.where.mockReturnValue(membersQuery)

  const userRef = {
    get: userGet,
    set: userSet,
    update: userUpdate,
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return { add: txAdd }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: Function) => fn(transaction))
  const authGetUser = vi.fn()

  return { transaction, userGet, userSet, userUpdate, txAdd, collectionGroupGet, membersQuery, userRef, runTransaction, authGetUser }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  auth: { getUser: mocks.authGetUser },
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return { doc: vi.fn().mockReturnValue(mocks.userRef) }
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    runTransaction: mocks.runTransaction,
  },
}))

import { userSync } from './userSync'

function makeReq() {
  return { headers: { authorization: 'Bearer test-token' }, body: {}, query: {} } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.get.mockReset()
  mocks.transaction.update.mockReset()
  mocks.authGetUser.mockResolvedValue(FIREBASE_USER)
  mocks.userSet.mockResolvedValue(undefined)
  mocks.userUpdate.mockResolvedValue(undefined)
  mocks.txAdd.mockResolvedValue({ id: 'tx-id' })
  mocks.collectionGroupGet.mockResolvedValue({ size: 0 })
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'transactions') return { add: mocks.txAdd }
    return {}
  })
})

describe('userSync', () => {
  it('crea usuario nuevo con campos economy', async () => {
    mocks.userGet.mockResolvedValue({ exists: false })

    const res = makeRes()
    await userSync(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.userSet).toHaveBeenCalledWith(
      expect.objectContaining({ stardust: 100, maxSkies: 2 }),
    )
    expect(mocks.txAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'earn', amount: 100, reason: 'welcome' }),
    )
  })

  it('migra usuario existente sin stardust', async () => {
    mocks.userGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'test@example.com', emailVerifiedAt: null }),
    })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ email: 'test@example.com' }), // no stardust
    })
    mocks.collectionGroupGet.mockResolvedValue({ size: 3 })

    const res = makeRes()
    await userSync(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 100, maxSkies: 3 }),
    )
    expect(mocks.txAdd).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'welcome' }),
    )
  })

  it('no migra usuario ya migrado', async () => {
    mocks.userGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'test@example.com', emailVerifiedAt: '2025-01-01', stardust: 500 }),
    })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ stardust: 500 }),
    })

    const res = makeRes()
    await userSync(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.transaction.update).not.toHaveBeenCalled()
    expect(mocks.txAdd).not.toHaveBeenCalled()
  })

  it('migracion es idempotente', async () => {
    // First call: needs migration
    mocks.userGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'test@example.com', emailVerifiedAt: null }),
    })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ email: 'test@example.com' }), // no stardust
    })

    const res1 = makeRes()
    await userSync(makeReq(), res1)
    expect(mocks.txAdd).toHaveBeenCalledTimes(1)

    // Second call: already migrated
    vi.clearAllMocks()
    mocks.transaction.get.mockReset()
    mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
    mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
    mocks.userRef.collection.mockImplementation((name: string) => {
      if (name === 'transactions') return { add: mocks.txAdd }
      return {}
    })
    mocks.authGetUser.mockResolvedValue(FIREBASE_USER)
    mocks.userUpdate.mockResolvedValue(undefined)

    mocks.userGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: 'test@example.com', emailVerifiedAt: null, stardust: 100 }),
    })
    mocks.transaction.get.mockResolvedValue({
      data: () => ({ stardust: 100 }),
    })

    const res2 = makeRes()
    await userSync(makeReq(), res2)
    expect(mocks.txAdd).not.toHaveBeenCalled()
  })
})
