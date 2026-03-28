import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => {
  const transaction = {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    set: vi.fn(),
  }

  const add = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const inventoryGet = vi.fn().mockResolvedValue({ docs: [] })
  const inventoryDocRef = { id: 'new-inv-doc' }
  const txDocRef = { id: 'tx-doc-ref' }

  const userRef = {
    collection: vi.fn((name: string) => {
      if (name === 'inventory') return { doc: vi.fn().mockReturnValue(inventoryDocRef), get: inventoryGet }
      if (name === 'transactions') return { add, doc: vi.fn().mockReturnValue(txDocRef) }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: (t: typeof transaction) => unknown) => fn(transaction))

  return { transaction, add, txDocRef, inventoryGet, inventoryDocRef, userRef, runTransaction }
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

// --- Imports ---

import { purchase } from './shop'

// --- Helpers ---

function makeReq(body: Record<string, unknown> = {}) {
  return { headers: { authorization: 'Bearer test-token' }, body, query: {} } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

function setupPurchase(userData: Record<string, unknown>, ownedItemIds: string[] = []) {
  mocks.transaction.get
    .mockResolvedValueOnce({ exists: true, data: () => userData })
    .mockResolvedValueOnce({
      docs: ownedItemIds.map(itemId => ({ data: () => ({ itemId }) })),
    })
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks()
  // mockReset on transaction fns — clears mockResolvedValueOnce queue
  mocks.transaction.get.mockReset()
  mocks.transaction.update.mockReset()
  mocks.transaction.create.mockReset()
  mocks.transaction.set.mockReset()
  mocks.add.mockResolvedValue({ id: 'tx-id' })
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'inventory') return { doc: vi.fn().mockReturnValue(mocks.inventoryDocRef), get: mocks.inventoryGet }
    if (name === 'transactions') return { add: mocks.add, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
    return {}
  })
})

// --- Tests ---

describe('purchase', () => {
  it('compra exitosa de tema', async () => {
    setupPurchase({ stardust: 1000 })

    const res = makeRes()
    await purchase(makeReq({ itemId: 'theme-aurora-borealis' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ newBalance: 200, itemId: 'theme-aurora-borealis' }),
    )
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 200 }),
    )
    expect(mocks.transaction.create).toHaveBeenCalled()
  })

  it('rechaza si balance insuficiente', async () => {
    setupPurchase({ stardust: 500 })

    const res = makeRes()
    await purchase(makeReq({ itemId: 'theme-aurora-borealis' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'insufficient_balance' }),
    )
  })

  it('rechaza si tema ya comprado', async () => {
    setupPurchase({ stardust: 1000 }, ['theme-aurora-borealis'])

    const res = makeRes()
    await purchase(makeReq({ itemId: 'theme-aurora-borealis' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'already_owned' }),
    )
  })

  it('sky-slot incrementa maxSkies', async () => {
    setupPurchase({ stardust: 1000, maxSkies: 2 })

    const res = makeRes()
    await purchase(makeReq({ itemId: 'sky-slot' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      mocks.userRef,
      expect.objectContaining({ stardust: 500, maxSkies: 3 }),
    )
  })

  it('sky-slot permite multiples compras', async () => {
    setupPurchase({ stardust: 1000, maxSkies: 3 }, ['sky-slot'])

    const res = makeRes()
    await purchase(makeReq({ itemId: 'sky-slot' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ newBalance: 500 }),
    )
  })

  it('rechaza itemId invalido', async () => {
    const res = makeRes()
    await purchase(makeReq({ itemId: 'no-existe' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('crea TransactionRecord de audit dentro de la transaccion', async () => {
    setupPurchase({ stardust: 1000 })

    const res = makeRes()
    await purchase(makeReq({ itemId: 'theme-aurora-borealis' }), res)

    expect(mocks.transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'spend',
        amount: 800,
        reason: 'shop_purchase',
        itemId: 'theme-aurora-borealis',
      }),
    )
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
