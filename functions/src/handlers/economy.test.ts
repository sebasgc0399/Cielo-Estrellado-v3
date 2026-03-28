import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const FIXED_NOW = new Date('2026-01-15T12:00:00Z')
const TODAY = '2026-01-15'
const YESTERDAY = '2026-01-14'
const TWO_DAYS_AGO = '2026-01-13'
const CURRENT_WEEK = '2026-W03'

// --- Hoisted mocks (available to vi.mock factories) ---

const mocks = vi.hoisted(() => {
  const transaction = {
    get: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  }

  const add = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const inventoryGet = vi.fn().mockResolvedValue({ docs: [] })
  const txDocRef = { id: 'tx-doc-ref' }

  const queryGet = vi.fn()
  const docGet = vi.fn().mockResolvedValue({ exists: false })

  const txCollection: Record<string, ReturnType<typeof vi.fn>> = {
    add,
    orderBy: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    get: queryGet,
    doc: vi.fn().mockReturnValue({ get: docGet }),
  }
  txCollection.orderBy.mockReturnValue(txCollection)
  txCollection.limit.mockReturnValue(txCollection)
  txCollection.startAfter.mockReturnValue(txCollection)

  const userRef = {
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return txCollection
      if (name === 'inventory') return { get: inventoryGet }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: (t: typeof transaction) => unknown) => fn(transaction))

  return { transaction, add, txDocRef, inventoryGet, queryGet, docGet, txCollection, userRef, runTransaction }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue(mocks.userRef),
    }),
    runTransaction: mocks.runTransaction,
  },
}))

// --- Imports (after mocks) ---

import { getEconomy, getTransactions } from './economy'

// --- Helpers ---

function makeReq(query: Record<string, string> = {}) {
  return { headers: { authorization: 'Bearer test-token' }, query } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  res.set = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
}

function userSnap(data: Record<string, unknown>) {
  return { exists: true, data: () => data }
}

// --- Setup ---

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  vi.clearAllMocks()
  // Restore default implementations cleared by clearAllMocks
  mocks.add.mockResolvedValue({ id: 'tx-id' })
  mocks.transaction.set.mockReset()
  mocks.inventoryGet.mockResolvedValue({ docs: [] })
  mocks.runTransaction.mockImplementation(async (fn: (t: typeof mocks.transaction) => unknown) => fn(mocks.transaction))
  mocks.txCollection.orderBy.mockReturnValue(mocks.txCollection)
  mocks.txCollection.limit.mockReturnValue(mocks.txCollection)
  mocks.txCollection.startAfter.mockReturnValue(mocks.txCollection)
  mocks.txCollection.doc.mockReturnValue({ get: mocks.docGet })
  mocks.docGet.mockResolvedValue({ exists: false })
})

afterEach(() => {
  vi.useRealTimers()
})

// --- getEconomy ---

describe('getEconomy', () => {
  it('otorga daily reward en primera llamada del dia', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 0, previousStreak: 0,
      lastDailyRewardDate: null, weeklyBonusWeek: null,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 135, loginStreak: 1 }),
    )
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stardust: 135,
        rewards: expect.objectContaining({ daily: 15, weekly: 20, streak: 0, streakDays: 1 }),
      }),
    )
  })

  it('es idempotente en segunda llamada del mismo dia', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 3, previousStreak: 0,
      lastDailyRewardDate: TODAY, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(mocks.transaction.update).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stardust: 100,
        rewards: expect.objectContaining({ daily: 0, weekly: 0, streak: 0, streakDays: 0 }),
      }),
    )
  })

  it('calcula streak — dia consecutivo', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 5, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ loginStreak: 6 }),
    )
  })

  it('resetea streak con gap', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 5, previousStreak: 0,
      lastDailyRewardDate: TWO_DAYS_AGO, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ loginStreak: 1, previousStreak: 5 }),
    )
  })

  it('otorga bonus de racha 7', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 6, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rewards: expect.objectContaining({ streak: 50, streakDays: 7 }),
      }),
    )
  })

  it('otorga bonus de racha 30', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 29, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rewards: expect.objectContaining({ streak: 350, streakDays: 30 }),
      }),
    )
  })

  it.each([
    [13, 14],
    [20, 21],
  ])('NO otorga bonus en racha %d→%d', async (currentStreak) => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: currentStreak, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rewards: expect.objectContaining({ streak: 0 }),
      }),
    )
  })

  it('otorga bonus de racha 60 (multiplo de 30)', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 500,
      lastDailyRewardDate: YESTERDAY,
      loginStreak: 59,
      previousStreak: 0,
      weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.rewards.streak).toBe(350)
    expect(body.rewards.streakDays).toBe(60)
  })

  it('NO otorga bonus de racha en dia 31 (no es multiplo de 30)', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 500,
      lastDailyRewardDate: YESTERDAY,
      loginStreak: 30,
      previousStreak: 0,
      weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.rewards.streak).toBe(0)
    expect(body.rewards.streakDays).toBe(31)
  })

  it('otorga bonus de racha 90 (multiplo de 30)', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 500,
      lastDailyRewardDate: YESTERDAY,
      loginStreak: 89,
      previousStreak: 0,
      weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.rewards.streak).toBe(350)
    expect(body.rewards.streakDays).toBe(90)
  })

  it('otorga weekly bonus una vez por semana ISO', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 0, previousStreak: 0,
      lastDailyRewardDate: null, weeklyBonusWeek: null,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rewards: expect.objectContaining({ weekly: 20 }),
      }),
    )
  })

  it('NO otorga weekly bonus si ya fue otorgado esta semana', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 0, previousStreak: 0,
      lastDailyRewardDate: null, weeklyBonusWeek: CURRENT_WEEK,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        rewards: expect.objectContaining({ weekly: 0 }),
      }),
    )
  })

  it('NO resetea contadores si son de hoy', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 3, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
      lastStarCreationDate: TODAY, createdStarsToday: 5,
      lastInviteAcceptDate: TODAY, acceptedInvitesToday: 2,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    const payload = mocks.transaction.update.mock.calls[0][1] as Record<string, unknown>
    expect(payload).not.toHaveProperty('createdStarsToday')
    expect(payload).not.toHaveProperty('acceptedInvitesToday')
  })

  it('resetea contadores si son de dia anterior', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 3, previousStreak: 0,
      lastDailyRewardDate: YESTERDAY, weeklyBonusWeek: CURRENT_WEEK,
      lastStarCreationDate: YESTERDAY, createdStarsToday: 5,
      lastInviteAcceptDate: YESTERDAY, acceptedInvitesToday: 3,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    const payload = mocks.transaction.update.mock.calls[0][1] as Record<string, unknown>
    expect(payload.createdStarsToday).toBe(0)
    expect(payload.lastStarCreationDate).toBeNull()
    expect(payload.acceptedInvitesToday).toBe(0)
    expect(payload.lastInviteAcceptDate).toBeNull()
  })

  it('variables de reward se resetean en retry de transaccion', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 0, previousStreak: 0,
      lastDailyRewardDate: null, weeklyBonusWeek: null,
    }))

    mocks.runTransaction.mockImplementationOnce(async (fn: Function) => {
      await fn(mocks.transaction)
      return fn(mocks.transaction)
    })

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        stardust: 135,
        rewards: expect.objectContaining({ daily: 15, weekly: 20 }),
      }),
    )
  })

  it('escribe audit log consolidado dentro de la transaccion', async () => {
    mocks.transaction.get.mockResolvedValue(userSnap({
      stardust: 100, loginStreak: 0, previousStreak: 0,
      lastDailyRewardDate: null, weeklyBonusWeek: null,
    }))

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(mocks.transaction.set).toHaveBeenCalledTimes(1)
    expect(mocks.transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'earn',
        amount: 35,
        reason: 'daily_rewards',
        details: expect.arrayContaining([
          expect.objectContaining({ amount: 15, reason: 'daily_login' }),
          expect.objectContaining({ amount: 20, reason: 'weekly_bonus' }),
        ]),
      }),
    )
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('retorna 404 si usuario no existe', async () => {
    mocks.transaction.get.mockResolvedValue({ exists: false })

    const res = makeRes()
    await getEconomy(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })
})

// --- getTransactions ---

describe('getTransactions', () => {
  it('retorna transacciones paginadas', async () => {
    mocks.queryGet.mockResolvedValue({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'earn', amount: 15, reason: 'daily_login', itemId: null, balanceAfter: 115, createdAt: '2026-01-15T12:00:00Z' }) },
        { id: 'tx-2', data: () => ({ type: 'earn', amount: 20, reason: 'weekly_bonus', itemId: null, balanceAfter: 130, createdAt: '2026-01-15T12:00:01Z' }) },
        { id: 'tx-3', data: () => ({ type: 'spend', amount: 800, reason: 'shop_purchase', itemId: 'theme-aurora', balanceAfter: 330, createdAt: '2026-01-15T12:00:02Z' }) },
      ],
    })

    const res = makeRes()
    await getTransactions(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const body = res.json.mock.calls[0][0]
    expect(body.transactions).toHaveLength(3)
    expect(body.nextCursor).toBeNull()
  })

  it('respeta limit y retorna nextCursor', async () => {
    mocks.queryGet.mockResolvedValue({
      docs: [
        { id: 'tx-1', data: () => ({ type: 'earn', amount: 15, reason: 'daily_login', itemId: null, balanceAfter: 115, createdAt: '2026-01-15T12:00:00Z' }) },
        { id: 'tx-2', data: () => ({ type: 'earn', amount: 20, reason: 'weekly_bonus', itemId: null, balanceAfter: 130, createdAt: '2026-01-15T12:00:01Z' }) },
      ],
    })

    const res = makeRes()
    await getTransactions(makeReq({ limit: '2' }), res)

    const body = res.json.mock.calls[0][0]
    expect(body.transactions).toHaveLength(2)
    expect(body.nextCursor).toBe('tx-2')
  })

  it('retorna lista vacia sin nextCursor', async () => {
    mocks.queryGet.mockResolvedValue({ docs: [] })

    const res = makeRes()
    await getTransactions(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.transactions).toHaveLength(0)
    expect(body.nextCursor).toBeNull()
  })

  it('incluye details cuando existen en la transaccion', async () => {
    mocks.queryGet.mockResolvedValue({
      docs: [
        {
          id: 'tx-1',
          data: () => ({
            type: 'earn',
            amount: 35,
            reason: 'daily_rewards',
            itemId: null,
            balanceAfter: 135,
            createdAt: '2026-01-15T12:00:00Z',
            details: [
              { amount: 15, reason: 'daily_login' },
              { amount: 20, reason: 'weekly_bonus' },
            ],
          }),
        },
      ],
    })

    const res = makeRes()
    await getTransactions(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.transactions[0].details).toEqual([
      { amount: 15, reason: 'daily_login' },
      { amount: 20, reason: 'weekly_bonus' },
    ])
  })

  it('omite details cuando no existen en la transaccion', async () => {
    mocks.queryGet.mockResolvedValue({
      docs: [
        {
          id: 'tx-1',
          data: () => ({
            type: 'spend',
            amount: 800,
            reason: 'shop_purchase',
            itemId: 'theme-aurora',
            balanceAfter: 200,
            createdAt: '2026-01-15T12:00:00Z',
          }),
        },
      ],
    })

    const res = makeRes()
    await getTransactions(makeReq(), res)

    const body = res.json.mock.calls[0][0]
    expect(body.transactions[0]).not.toHaveProperty('details')
  })

  it('ignora cursor excesivamente largo (> 128 chars)', async () => {
    mocks.queryGet.mockResolvedValue({ docs: [] })
    const longCursor = 'a'.repeat(200)

    const res = makeRes()
    await getTransactions(makeReq({ cursor: longCursor }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    // docGet NO debe llamarse — cursor rechazado antes del read a Firestore
    expect(mocks.docGet).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ transactions: expect.any(Array) }),
    )
  })

  it('ignora cursor vacio', async () => {
    mocks.queryGet.mockResolvedValue({ docs: [] })

    const res = makeRes()
    await getTransactions(makeReq({ cursor: '' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.docGet).not.toHaveBeenCalled()
  })
})
