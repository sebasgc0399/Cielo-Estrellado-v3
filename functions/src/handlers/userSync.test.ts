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
  const transaction = { get: vi.fn(), update: vi.fn(), create: vi.fn(), set: vi.fn() }
  const userGet = vi.fn()
  const userSet = vi.fn().mockResolvedValue(undefined)
  const userUpdate = vi.fn().mockResolvedValue(undefined)

  const txDocRef = { id: 'tx-doc-ref' }

  const userRef = {
    get: userGet,
    set: userSet,
    update: userUpdate,
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return { doc: vi.fn().mockReturnValue(txDocRef) }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: Function) => fn(transaction))
  const authGetUser = vi.fn()

  return { transaction, userGet, userSet, userUpdate, txDocRef, userRef, runTransaction, authGetUser }
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
  mocks.transaction.create.mockReset()
  mocks.transaction.set.mockReset()
  mocks.authGetUser.mockResolvedValue(FIREBASE_USER)
  mocks.userSet.mockResolvedValue(undefined)
  mocks.userUpdate.mockResolvedValue(undefined)
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'transactions') return { doc: vi.fn().mockReturnValue(mocks.txDocRef) }
    return {}
  })
})

describe('userSync', () => {
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
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

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
  })

  it('no duplica welcome bonus si request concurrente ya creo el usuario', async () => {
    mocks.userGet.mockResolvedValue({ exists: false })
    mocks.transaction.get.mockResolvedValue({ exists: true })

    const res = makeRes()
    await userSync(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.transaction.set).not.toHaveBeenCalled()
    expect(mocks.transaction.create).not.toHaveBeenCalled()
  })
})
