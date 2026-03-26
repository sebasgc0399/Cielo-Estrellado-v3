import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { createHash } from 'node:crypto'

// --- Hoisted mocks ---

const mocks = vi.hoisted(() => {
  const transaction = {
    get: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
  }

  const add = vi.fn().mockResolvedValue({ id: 'tx-id' })
  const paymentAdd = vi.fn().mockResolvedValue({ id: 'payment-doc-id' })

  const paymentDocRef = { update: vi.fn().mockResolvedValue(undefined), ref: { update: vi.fn() } }
  const paymentsGet = vi.fn().mockResolvedValue({ empty: true, docs: [] })
  const paymentsLimit = vi.fn().mockReturnValue({ get: paymentsGet })
  const paymentsWhere = vi.fn()

  const countGet = vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) })
  const countFn = vi.fn().mockReturnValue({ get: countGet })

  const txDocRef = {}

  const userRef = {
    collection: vi.fn((name: string) => {
      if (name === 'transactions') return { add, doc: vi.fn().mockReturnValue(txDocRef) }
      return {}
    }),
  }

  const runTransaction = vi.fn(async (fn: (t: typeof transaction) => unknown) => fn(transaction))

  // Make where chainable
  paymentsWhere.mockReturnValue({ limit: paymentsLimit, where: paymentsWhere, count: countFn })

  return {
    transaction, add, paymentAdd, paymentDocRef,
    paymentsGet, paymentsLimit, paymentsWhere,
    userRef, runTransaction,
    countGet, countFn, txDocRef,
  }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid-1234abcd' }),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'payments') {
        return {
          add: mocks.paymentAdd,
          where: mocks.paymentsWhere,
        }
      }
      if (name === 'users') {
        return {
          doc: vi.fn().mockReturnValue(mocks.userRef),
        }
      }
      return {}
    }),
    runTransaction: mocks.runTransaction,
  },
}))

// --- Imports ---

import { createPayment, wompiWebhook, getPaymentStatus } from './payments'

// --- Helpers ---

function makeReq(body: Record<string, unknown> = {}, routeParams: Record<string, string> = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    body,
    query: {},
    routeParams,
  } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

const EVENTS_SECRET = 'test-events-secret'
const INTEGRITY_SECRET = 'test-integrity-secret'
const PUBLIC_KEY = 'pub_test_key'

function makeWebhookBody(overrides: {
  reference?: string
  status?: string
  transactionId?: string
  paymentMethodType?: string
  timestamp?: number
} = {}) {
  const reference = overrides.reference ?? 'ce-test1234-1234567890-abcdef01'
  const status = overrides.status ?? 'APPROVED'
  const transactionId = overrides.transactionId ?? 'wompi-tx-123'
  const paymentMethodType = overrides.paymentMethodType ?? 'NEQUI'
  const timestamp = overrides.timestamp ?? 1234567890

  const body = {
    event: 'transaction.updated',
    timestamp,
    data: {
      transaction: {
        id: transactionId,
        status,
        reference,
        amount_in_cents: 500000,
        payment_method_type: paymentMethodType,
      },
    },
    signature: {
      properties: [
        'transaction.id',
        'transaction.status',
        'transaction.amount_in_cents',
      ],
      checksum: '', // Will be computed below
    },
  }

  // Compute valid checksum
  const values = [transactionId, status, '500000']
  const concatenated = values.join('') + String(timestamp) + EVENTS_SECRET
  body.signature.checksum = createHash('sha256').update(concatenated).digest('hex')

  return body
}

function setupPendingPayment(overrides: Record<string, unknown> = {}) {
  const paymentRef = { update: vi.fn().mockResolvedValue(undefined) }
  const paymentData = {
    userId: 'test-uid-1234abcd',
    packageId: 'pack-500',
    amountInCents: 500000,
    currency: 'COP',
    stardustAmount: 500,
    wompiTransactionId: null,
    wompiReference: 'ce-test1234-1234567890-abcdef01',
    status: 'pending',
    paymentMethod: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  }

  mocks.paymentsGet.mockResolvedValue({
    empty: false,
    docs: [{ ref: paymentRef, data: () => paymentData }],
  })

  return { paymentRef, paymentData }
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks()
  mocks.transaction.get.mockReset()
  mocks.transaction.update.mockReset()
  mocks.transaction.set.mockReset()
  mocks.add.mockResolvedValue({ id: 'tx-id' })
  mocks.paymentAdd.mockResolvedValue({ id: 'payment-doc-id' })
  mocks.paymentsGet.mockResolvedValue({ empty: true, docs: [] })
  mocks.paymentsLimit.mockReturnValue({ get: mocks.paymentsGet })
  mocks.paymentsWhere.mockReturnValue({ limit: mocks.paymentsLimit, where: mocks.paymentsWhere, count: mocks.countFn })
  mocks.runTransaction.mockImplementation(async (fn: Function) => fn(mocks.transaction))
  mocks.userRef.collection.mockImplementation((name: string) => {
    if (name === 'transactions') return { add: mocks.add, doc: vi.fn().mockReturnValue(mocks.txDocRef) }
    return {}
  })
  mocks.countGet.mockResolvedValue({ data: () => ({ count: 0 }) })

  process.env.WOMPI_INTEGRITY_SECRET = INTEGRITY_SECRET
  process.env.WOMPI_PUBLIC_KEY = PUBLIC_KEY
  process.env.WOMPI_EVENTS_SECRET = EVENTS_SECRET
})

afterEach(() => {
  delete process.env.WOMPI_INTEGRITY_SECRET
  delete process.env.WOMPI_PUBLIC_KEY
  delete process.env.WOMPI_EVENTS_SECRET
})

// --- Tests ---

describe('createPayment', () => {
  it('crea pago exitosamente con packageId valido', async () => {
    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const response = res.json.mock.calls[0][0]
    expect(response.paymentId).toBe('payment-doc-id')
    expect(response.reference).toMatch(/^ce-\d+-[a-f0-9]{16}$/)
    expect(response.amountInCents).toBe(500000)
    expect(response.currency).toBe('COP')
    expect(response.integritySignature).toBeTruthy()
    expect(response.publicKey).toBe(PUBLIC_KEY)
  })

  it('genera firma de integridad correcta', async () => {
    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    const response = res.json.mock.calls[0][0]
    const expected = createHash('sha256')
      .update(`${response.reference}500000COP${INTEGRITY_SECRET}`)
      .digest('hex')
    expect(response.integritySignature).toBe(expected)
  })

  it('crea PaymentRecord en Firestore con campos correctos', async () => {
    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-1500' }), res)

    expect(mocks.paymentAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'test-uid-1234abcd',
        packageId: 'pack-1500',
        amountInCents: 1200000,
        currency: 'COP',
        stardustAmount: 1375,
        wompiTransactionId: null,
        status: 'pending',
        paymentMethod: null,
        resolvedAt: null,
      }),
    )
  })

  it('rechaza packageId faltante', async () => {
    const res = makeRes()
    await createPayment(makeReq({}), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'packageId es requerido' }),
    )
  })

  it('rechaza packageId invalido', async () => {
    const res = makeRes()
    await createPayment(makeReq({ packageId: 'no-existe' }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Paquete no existe' }),
    )
  })

  it('rechaza con 429 si el usuario excede el limite de pagos pendientes', async () => {
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 5 }) })

    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('pendientes') }),
    )
    expect(mocks.paymentAdd).not.toHaveBeenCalled()
  })

  it('permite creacion si pagos pendientes estan bajo el limite', async () => {
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 4 }) })

    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.paymentAdd).toHaveBeenCalled()
  })

  it('retorna 500 si WOMPI_INTEGRITY_SECRET no esta configurado', async () => {
    delete process.env.WOMPI_INTEGRITY_SECRET

    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(mocks.paymentAdd).not.toHaveBeenCalled()
  })

  it('retorna 500 si WOMPI_PUBLIC_KEY no esta configurado', async () => {
    delete process.env.WOMPI_PUBLIC_KEY

    const res = makeRes()
    await createPayment(makeReq({ packageId: 'pack-500' }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(mocks.paymentAdd).not.toHaveBeenCalled()
  })
})

describe('wompiWebhook', () => {
  it('acredita stardust en webhook APPROVED', async () => {
    const { paymentRef } = setupPendingPayment()
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ stardust: 100 }),
    })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stardust: 600 }),
    )
    expect(mocks.transaction.update).toHaveBeenCalledWith(
      paymentRef,
      expect.objectContaining({
        status: 'approved',
        wompiTransactionId: 'wompi-tx-123',
        paymentMethod: 'NEQUI',
      }),
    )
  })

  it('crea TransactionRecord de audit dentro de la transaccion', async () => {
    setupPendingPayment()
    mocks.transaction.get.mockResolvedValue({
      exists: true,
      data: () => ({ stardust: 100 }),
    })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(mocks.transaction.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'earn',
        amount: 500,
        reason: 'purchase',
        itemId: 'pack-500',
        balanceAfter: 600,
      }),
    )
    expect(mocks.add).not.toHaveBeenCalled()
  })

  it('actualiza a declined en webhook DECLINED', async () => {
    const { paymentRef } = setupPendingPayment()

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody({ status: 'DECLINED' })), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(paymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'declined' }),
    )
    // No debe acreditar stardust
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('actualiza a voided en webhook VOIDED', async () => {
    const { paymentRef } = setupPendingPayment()

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody({ status: 'VOIDED' })), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(paymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'voided' }),
    )
  })

  it('rechaza firma invalida sin procesar', async () => {
    const body = makeWebhookBody()
    body.signature.checksum = 'invalid-checksum'

    const res = makeRes()
    await wompiWebhook(makeReq(body), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Invalid signature' }),
    )
    expect(mocks.paymentsGet).not.toHaveBeenCalled()
  })

  it('ignora payload sin signature', async () => {
    const res = makeRes()
    await wompiWebhook(makeReq({ event: 'test', timestamp: 123 }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.paymentsGet).not.toHaveBeenCalled()
  })

  it('retorna 200 si pago no encontrado', async () => {
    mocks.paymentsGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Payment not found' }),
    )
  })

  it('es idempotente — no procesa pago ya resuelto', async () => {
    setupPendingPayment({ status: 'approved' })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Already processed' }),
    )
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('siempre retorna 200 incluso en error interno', async () => {
    setupPendingPayment()
    mocks.runTransaction.mockRejectedValue(new Error('Firestore error'))

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
  })

  it('rechaza webhook con amount mismatch sin procesar', async () => {
    setupPendingPayment({ amountInCents: 999999 })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Amount mismatch' }),
    )
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })

  it('retorna 200 con error cuando usuario no existe en APPROVED', async () => {
    setupPendingPayment()
    mocks.transaction.get.mockResolvedValue({
      exists: false,
      data: () => undefined,
    })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Internal error, logged' }),
    )
  })

  it('retorna 500 si WOMPI_EVENTS_SECRET no esta configurado', async () => {
    delete process.env.WOMPI_EVENTS_SECRET

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody()), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Configuration error' }),
    )
  })

  it('ignora eventos que no son transaction.updated', async () => {
    const body = makeWebhookBody()
    body.event = 'nequi_token.updated'

    const res = makeRes()
    await wompiWebhook(makeReq(body), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Event type not processed' }),
    )
    expect(mocks.paymentsGet).not.toHaveBeenCalled()
  })

  it('mapea status desconocido a error', async () => {
    const { paymentRef } = setupPendingPayment()

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody({ status: 'UNKNOWN_STATUS' })), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(paymentRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    )
  })

  it('es idempotente para pagos ya declinados', async () => {
    setupPendingPayment({ status: 'declined' })

    const res = makeRes()
    await wompiWebhook(makeReq(makeWebhookBody({ status: 'DECLINED' })), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Already processed' }),
    )
    expect(mocks.runTransaction).not.toHaveBeenCalled()
  })
})

describe('getPaymentStatus', () => {
  it('retorna status y stardustAmount del pago', async () => {
    mocks.paymentsGet.mockResolvedValue({
      empty: false,
      docs: [{
        data: () => ({
          status: 'approved',
          stardustAmount: 500,
          userId: 'test-uid-1234abcd',
        }),
      }],
    })

    const res = makeRes()
    await getPaymentStatus(makeReq({}, { reference: 'ce-test-ref' }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      status: 'approved',
      stardustAmount: 500,
    })
  })

  it('retorna 404 si pago no encontrado', async () => {
    mocks.paymentsGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await getPaymentStatus(makeReq({}, { reference: 'ce-no-existe' }), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('filtra por userId para no exponer pagos ajenos', async () => {
    const res = makeRes()
    await getPaymentStatus(makeReq({}, { reference: 'ce-test-ref' }), res)

    // Verify the where chain includes userId filter
    expect(mocks.paymentsWhere).toHaveBeenCalledWith('wompiReference', '==', 'ce-test-ref')
    expect(mocks.paymentsWhere).toHaveBeenCalledWith('userId', '==', 'test-uid-1234abcd')
  })
})
