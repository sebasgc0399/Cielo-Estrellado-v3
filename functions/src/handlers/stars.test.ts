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

  const storageDelete = vi.fn().mockResolvedValue(undefined)
  const storageFile = vi.fn().mockReturnValue({ delete: storageDelete })

  return { transaction, txAdd, txDocRef, starSet, starsChain, userRef, runTransaction, storageFile, storageDelete }
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
  storage: {
    bucket: vi.fn().mockReturnValue({
      file: mocks.storageFile,
    }),
  },
}))

import { createStar, updateStar, deleteStar } from './stars'

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
  mocks.storageFile.mockClear()
  mocks.storageDelete.mockResolvedValue(undefined)
})

afterEach(() => { vi.useRealTimers() })

function makeUpdateReq(body: Record<string, unknown> = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', starId: 'star-123' },
    body: { title: 'Updated Star', ...body },
    query: {},
  } as unknown as Request
}

function makeDeleteReq() {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', starId: 'star-123' },
    body: {},
    query: {},
  } as unknown as Request
}

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

describe('updateStar — imagePath', () => {
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

  it('acepta imagePath canonico cuando star.imagePath es null', async () => {
    const starRef = setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: 'stars/sky-1/star-123/image' }),
    )
  })

  it('rechaza imagePath no canonico con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/OTHER-STAR/image' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza imagePath con path traversal con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(
      makeUpdateReq({ imagePath: 'stars/sky-1/star-123/../../../etc/passwd' }),
      res,
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('retorna 409 si star ya tiene imagen', async () => {
    setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('permite setear imagePath a null', async () => {
    const starRef = setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: null }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ imagePath: null }),
    )
  })

  it('rechaza imagePath con tipo invalido con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ imagePath: 12345 }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('deleteStar — image cleanup', () => {
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

  it('elimina imagen de Storage al eliminar estrella con imagen', async () => {
    setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-123/image')
    expect(mocks.storageDelete).toHaveBeenCalled()
  })

  it('no intenta eliminar Storage si star no tiene imagen', async () => {
    setupStarRef({ imagePath: null })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).not.toHaveBeenCalled()
  })

  it('completa soft-delete aun si Storage delete falla', async () => {
    mocks.storageDelete.mockRejectedValueOnce(new Error('Storage error'))
    const starRef = setupStarRef({ imagePath: 'stars/sky-1/star-123/image' })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(String) }),
    )
  })
})
