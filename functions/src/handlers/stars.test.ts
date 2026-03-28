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
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'

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

describe('updateStar — mediaPath', () => {
  const baseStar = {
    title: 'Existing Star',
    message: null,
    xNormalized: 0.5,
    yNormalized: 0.5,
    mediaType: null,
    mediaStatus: null,
    mediaPath: null,
    thumbnailPath: null,
    mediaDuration: null,
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

  it('acepta mediaPath canonico cuando star.mediaPath es null', async () => {
    const starRef = setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ mediaPath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ mediaPath: 'stars/sky-1/star-123/image', mediaType: 'image' }),
    )
  })

  it('rechaza mediaPath no canonico con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ mediaPath: 'stars/sky-1/OTHER-STAR/image' }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza mediaPath con path traversal con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(
      makeUpdateReq({ mediaPath: 'stars/sky-1/star-123/../../../etc/passwd' }),
      res,
    )
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('retorna 409 si star ya tiene media', async () => {
    setupStarRef({
      mediaType: 'image',
      mediaStatus: null,
      mediaPath: 'stars/sky-1/star-123/image',
      thumbnailPath: null,
      mediaDuration: null,
    })
    const res = makeRes()
    await updateStar(makeUpdateReq({ mediaPath: 'stars/sky-1/star-123/image' }), res)
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('permite setear mediaPath a null y limpia campos media', async () => {
    const starRef = setupStarRef({
      mediaType: 'image',
      mediaStatus: null,
      mediaPath: 'stars/sky-1/star-123/image',
      thumbnailPath: null,
      mediaDuration: null,
    })
    const res = makeRes()
    await updateStar(makeUpdateReq({ mediaPath: null }), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaPath: null,
        mediaType: null,
        mediaStatus: null,
        thumbnailPath: null,
        mediaDuration: null,
      }),
    )
  })

  it('rechaza mediaPath con tipo invalido con 400', async () => {
    setupStarRef()
    const res = makeRes()
    await updateStar(makeUpdateReq({ mediaPath: 12345 }), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('updateStar — mediaStatus transitions', () => {
  const baseStar = {
    title: 'Existing Star',
    message: null,
    xNormalized: 0.5,
    yNormalized: 0.5,
    mediaType: null,
    mediaStatus: null,
    mediaPath: null,
    thumbnailPath: null,
    mediaDuration: null,
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

  function makeMediaStatusReq(mediaStatus: unknown) {
    return {
      headers: { authorization: 'Bearer test-token' },
      routeParams: { skyId: 'sky-1', starId: 'star-123' },
      body: { mediaStatus },
      query: {},
    } as unknown as Request
  }

  it('permite transicion null → processing', async () => {
    const starRef = setupStarRef({ mediaStatus: null })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('processing'), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith({
      mediaStatus: 'processing',
      updatedAt: expect.any(String),
      updatedByUserId: 'test-uid',
    })
  })

  it('permite transicion processing → null (rollback)', async () => {
    const starRef = setupStarRef({ mediaStatus: 'processing' })
    const res = makeRes()
    await updateStar(makeMediaStatusReq(null), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith({
      mediaStatus: null,
      updatedAt: expect.any(String),
      updatedByUserId: 'test-uid',
    })
  })

  it('permite transicion error → null (retry)', async () => {
    const starRef = setupStarRef({ mediaStatus: 'error' })
    const res = makeRes()
    await updateStar(makeMediaStatusReq(null), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith({
      mediaStatus: null,
      updatedAt: expect.any(String),
      updatedByUserId: 'test-uid',
    })
  })

  it('rechaza transicion null → ready (cliente no puede)', async () => {
    setupStarRef({ mediaStatus: null })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('ready'), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza transicion null → error (cliente no puede)', async () => {
    setupStarRef({ mediaStatus: null })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('error'), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza transicion processing → ready', async () => {
    setupStarRef({ mediaStatus: 'processing' })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('ready'), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza transicion ready → processing', async () => {
    setupStarRef({ mediaStatus: 'ready' })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('processing'), res)
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rechaza mediaStatus con otros campos (400)', async () => {
    setupStarRef({ mediaStatus: null })
    const res = makeRes()
    const req = {
      headers: { authorization: 'Bearer test-token' },
      routeParams: { skyId: 'sky-1', starId: 'star-123' },
      body: { mediaStatus: 'processing', title: 'foo' },
      query: {},
    } as unknown as Request
    await updateStar(req, res)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'mediaStatus debe enviarse solo, sin otros campos' })
  })

  it('mediaStatus solo, sin title, retorna 200', async () => {
    const starRef = setupStarRef({ mediaStatus: null })
    const res = makeRes()
    await updateStar(makeMediaStatusReq('processing'), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalled()
  })
})

describe('deleteStar — media cleanup', () => {
  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          deletedAt: null,
          authorUserId: 'test-uid',
          mediaType: null,
          mediaStatus: null,
          mediaPath: null,
          thumbnailPath: null,
          mediaDuration: null,
          ...overrides,
        }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('elimina media y temp de Storage al eliminar estrella con imagen', async () => {
    setupStarRef({
      mediaType: 'image',
      mediaStatus: null,
      mediaPath: 'stars/sky-1/star-123/image',
      thumbnailPath: null,
      mediaDuration: null,
    })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-123/image')
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-123/raw')
    expect(mocks.storageDelete).toHaveBeenCalled()
  })

  it('solo intenta eliminar temp si star no tiene media', async () => {
    setupStarRef()
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    // temp/sky-1/star-123/raw siempre se intenta borrar
    expect(mocks.storageFile).toHaveBeenCalledTimes(1)
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-123/raw')
  })

  it('completa soft-delete aun si Storage delete falla', async () => {
    mocks.storageDelete.mockRejectedValue(new Error('Storage error'))
    const starRef = setupStarRef({
      mediaType: 'image',
      mediaStatus: null,
      mediaPath: 'stars/sky-1/star-123/image',
      thumbnailPath: null,
      mediaDuration: null,
    })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: expect.any(String) }),
    )
  })

  it('borra video, thumbnail y temp cuando star tiene video', async () => {
    setupStarRef({
      mediaType: 'video',
      mediaStatus: 'ready',
      mediaPath: 'stars/sky-1/star-123/video',
      thumbnailPath: 'stars/sky-1/star-123/thumb',
      mediaDuration: 4.5,
    })
    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-123/video')
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-123/thumb')
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-123/raw')
    expect(mocks.storageDelete).toHaveBeenCalledTimes(3)
  })
})

// ─── createStar — access control ─────────────────────────────

describe('createStar — access control', () => {
  it('rechaza con 404 si getSkyWithAccess retorna not_found', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'not_found' } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cielo no encontrado' })
  })

  it('rechaza con 500 si getSkyWithAccess retorna error', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'error' } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Error interno al verificar acceso' })
  })

  it('rechaza con 403 si rol es viewer', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'viewer', status: 'active' },
    } as any)

    const res = makeRes()
    await createStar(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para crear estrellas en este cielo' })
    expect(mocks.starSet).not.toHaveBeenCalled()
  })
})

// ─── updateStar — permisos ───────────────────────────────────

describe('updateStar — permisos', () => {
  const baseStar = {
    title: 'Existing Star',
    message: null,
    xNormalized: 0.5,
    yNormalized: 0.5,
    mediaType: null,
    mediaStatus: null,
    mediaPath: null,
    thumbnailPath: null,
    mediaDuration: null,
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

  it('owner puede editar estrella de otro usuario', async () => {
    // Default mock: getSkyWithAccess retorna role: owner
    const starRef = setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalled()
  })

  it('editor puede editar su propia estrella', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    const starRef = setupStarRef({ authorUserId: 'test-uid' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalled()
  })

  it('editor no puede editar estrella de otro usuario', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para editar esta estrella' })
  })

  it('retorna 404 si estrella esta soft-deleted', async () => {
    setupStarRef({ deletedAt: '2026-01-01T00:00:00Z' })

    const res = makeRes()
    await updateStar(makeUpdateReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Estrella no encontrada' })
  })
})

// ─── deleteStar — permisos ───────────────────────────────────

describe('deleteStar — permisos', () => {
  function setupStarRef(overrides: Record<string, unknown> = {}) {
    const starRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          deletedAt: null,
          authorUserId: 'test-uid',
          mediaType: null,
          mediaStatus: null,
          mediaPath: null,
          thumbnailPath: null,
          mediaDuration: null,
          ...overrides,
        }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)
    return starRef
  }

  it('editor no puede eliminar estrella de otro usuario', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)
    setupStarRef({ authorUserId: 'other-user' })

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'No tienes permisos para eliminar esta estrella' })
  })

  it('retorna 404 si estrella no existe', async () => {
    const starRef = {
      get: vi.fn().mockResolvedValue({ exists: false }),
      update: vi.fn(),
    }
    mocks.starsChain.doc.mockReturnValue(starRef)

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Estrella no encontrada' })
  })

  it('marca deletedAt y deletedByUserId al eliminar', async () => {
    const starRef = setupStarRef()

    const res = makeRes()
    await deleteStar(makeDeleteReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(starRef.update).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(String),
        deletedByUserId: 'test-uid',
      }),
    )
  })
})
