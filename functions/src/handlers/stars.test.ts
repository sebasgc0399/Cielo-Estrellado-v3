import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const TODAY = '2026-01-15'
const YESTERDAY = '2026-01-14'

const mocks = vi.hoisted(() => {
  const transaction = { get: vi.fn(), update: vi.fn(), set: vi.fn() }
  const txAdd = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const txDocRef = { id: 'tx-doc-ref' }
  const starSet = vi.fn().mockResolvedValue(undefined)

  const starsChain: Record<string, ReturnType<typeof vi.fn>> = {
    doc: vi.fn().mockReturnValue({ id: 'star-123', set: starSet }),
    where: vi.fn(),
    limit: vi.fn(),
  }
  starsChain.where.mockReturnValue(starsChain)
  starsChain.limit.mockReturnValue(starsChain)

  const userRef = {
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return { add: txAdd, doc: vi.fn().mockReturnValue(txDocRef) }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: Function) => fn(transaction))

  return { transaction, txAdd, txDocRef, starSet, starsChain, userRef, runTransaction }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/getSkyWithAccess.js', () => ({
  getSkyWithAccess: vi.fn().mockResolvedValue({
    ok: true, sky: { title: 'Test Sky' }, member: { role: 'owner', status: 'active' },
  }),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'skies') return {
        doc: vi.fn().mockReturnValue({
          collection: vi.fn().mockReturnValue(mocks.starsChain),
        }),
      }
      if (name === 'users') return { doc: vi.fn().mockReturnValue(mocks.userRef) }
      return {}
    }),
    runTransaction: mocks.runTransaction,
  },
}))

import { createStar } from './stars'

function makeReq() {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1' },
    body: { title: 'Test Star' },
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
  mocks.starSet.mockResolvedValue(undefined)
  mocks.txAdd.mockResolvedValue({ id: 'tx-id' })
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.starsChain.where.mockReturnValue(mocks.starsChain)
  mocks.starsChain.limit.mockReturnValue(mocks.starsChain)
  mocks.starsChain.doc.mockReturnValue({ id: 'star-123', set: mocks.starSet })
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'transactions') return { add: mocks.txAdd, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
    return {}
  })
})

afterEach(() => { vi.useRealTimers() })

describe('createStar rewards', () => {
  it('otorga STAR_CREATION_REWARD al crear estrella', async () => {
    mocks.transaction.get
      .mockResolvedValueOnce({
        data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
      })
      .mockResolvedValueOnce({ empty: false })

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 105 }),
    )
  })

  it('otorga FIRST_STAR_BONUS si es primera estrella en cielo', async () => {
    mocks.transaction.get
      .mockResolvedValueOnce({
        data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
      })
      .mockResolvedValueOnce({ empty: true })

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 130 }),
    )
  })

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

  it('escribe audit logs dentro de la transaccion con transaction.set', async () => {
    mocks.transaction.get
      .mockResolvedValueOnce({
        data: () => ({ stardust: 100, createdStarsToday: 0, lastStarCreationDate: null }),
      })
      .mockResolvedValueOnce({ empty: true })

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(mocks.transaction.set).toHaveBeenCalledTimes(2)
    expect(mocks.transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'earn', reason: 'star_creation', amount: 5 }),
    )
    expect(mocks.transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'earn', reason: 'first_star_bonus', amount: 25 }),
    )
    expect(mocks.txAdd).not.toHaveBeenCalled()
  })

  it('reward es best-effort — estrella se crea aunque reward falle', async () => {
    mocks.runTransaction.mockRejectedValue(new Error('fail'))

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(mocks.starSet).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ starId: 'star-123', rewards: { stardustEarned: 0 } }),
    )
  })
})
