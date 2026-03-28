import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const userGet = vi.fn()
  const collectionGroupGet = vi.fn()
  const inventoryGet = vi.fn().mockResolvedValue({ docs: [] })
  const skyUpdate = vi.fn().mockResolvedValue(undefined)
  const getAll = vi.fn()
  const starsGet = vi.fn()
  const subMembersGet = vi.fn()
  const storageDelete = vi.fn().mockResolvedValue(undefined)
  const storageFile = vi.fn().mockReturnValue({ delete: storageDelete })
  const storageGetFiles = vi.fn().mockResolvedValue([[]])
  const batchDelete = vi.fn()
  const batchUpdate = vi.fn()

  const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: collectionGroupGet,
  }
  membersQuery.where.mockReturnValue(membersQuery)

  const invitesQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: vi.fn(),
  }
  invitesQuery.where.mockReturnValue(invitesQuery)

  const batchSet = vi.fn()
  const batchCommit = vi.fn().mockResolvedValue(undefined)

  return {
    userGet, collectionGroupGet, inventoryGet, skyUpdate,
    membersQuery, batchSet, batchCommit,
    getAll, starsGet, subMembersGet, storageDelete, storageFile, storageGetFiles,
    batchDelete, batchUpdate, invitesQuery,
  }
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
      if (name === 'users') return {
        doc: vi.fn().mockReturnValue({
          get: mocks.userGet,
          collection: vi.fn((sub: string) => {
            if (sub === 'inventory') return { get: mocks.inventoryGet }
            return {}
          }),
        }),
      }
      if (name === 'skies') return {
        doc: vi.fn().mockReturnValue({
          id: 'sky-new',
          update: mocks.skyUpdate,
          collection: vi.fn((sub: string) => {
            if (sub === 'members') return {
              doc: vi.fn().mockReturnValue({}),
              get: mocks.subMembersGet,
            }
            if (sub === 'stars') return { get: mocks.starsGet }
            return { doc: vi.fn().mockReturnValue({}) }
          }),
        }),
      }
      if (name === 'invites') return mocks.invitesQuery
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    batch: vi.fn().mockReturnValue({
      set: mocks.batchSet,
      delete: mocks.batchDelete,
      update: mocks.batchUpdate,
      commit: mocks.batchCommit,
    }),
    getAll: mocks.getAll,
  },
  storage: {
    bucket: vi.fn().mockReturnValue({
      file: mocks.storageFile,
      getFiles: mocks.storageGetFiles,
    }),
  },
}))

import { getUserSkies, createSky, updateSky, getSky, deleteSky, updateSkyTheme } from './skies'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

function makeReq(overrides: { routeParams?: Record<string, string>; body?: unknown } = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: overrides.routeParams ?? {},
    body: overrides.body ?? {},
    query: {},
  } as unknown as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
  mocks.inventoryGet.mockResolvedValue({ docs: [] })
  mocks.skyUpdate.mockResolvedValue(undefined)
  mocks.batchCommit.mockResolvedValue(undefined)
  mocks.invitesQuery.where.mockReturnValue(mocks.invitesQuery)
  mocks.invitesQuery.get.mockResolvedValue({ docs: [] })
  mocks.starsGet.mockResolvedValue({ docs: [] })
  mocks.subMembersGet.mockResolvedValue({ docs: [] })
  mocks.getAll.mockResolvedValue([])
  mocks.storageDelete.mockResolvedValue(undefined)
  mocks.storageGetFiles.mockResolvedValue([[]])
})

describe('createSky', () => {
  it('retorna 404 si usuario no existe', async () => {
    mocks.userGet.mockResolvedValue({ exists: false, data: () => undefined })
    const req = {
      headers: { authorization: 'Bearer test-token' },
      body: { title: 'New Sky' },
      query: {},
    } as unknown as Request
    const res = makeRes()
    await createSky(req, res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('rechaza crear cielo si maxSkies alcanzado', async () => {
    mocks.userGet.mockResolvedValue({ exists: true, data: () => ({ maxSkies: 2 }) })
    mocks.collectionGroupGet.mockResolvedValue({ size: 2 })

    const req = {
      headers: { authorization: 'Bearer test-token' },
      body: { title: 'New Sky' },
      query: {},
    } as unknown as Request
    const res = makeRes()
    await createSky(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ maxSkies: 2, currentCount: 2 }),
    )
  })
})

describe('updateSkyTheme', () => {
  function makeThemeReq(themeId: string) {
    return {
      headers: { authorization: 'Bearer test-token' },
      routeParams: { skyId: 'sky-1' },
      body: { themeId },
      query: {},
    } as unknown as Request
  }

  it('valida themeId contra catalogo', async () => {
    const res = makeRes()
    await updateSkyTheme(makeThemeReq('fake-theme'), res)

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('permite classic sin inventario', async () => {
    const res = makeRes()
    await updateSkyTheme(makeThemeReq('classic'), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ themeId: 'classic' }))
  })

  it('rechaza tema no poseido', async () => {
    mocks.inventoryGet.mockResolvedValue({ docs: [] })

    const res = makeRes()
    await updateSkyTheme(makeThemeReq('aurora-borealis'), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })
})

// ─── getSky ──────────────────────────────────────────────────

describe('getSky', () => {
  it('retorna sky y member role', async () => {
    const res = makeRes()
    const req = makeReq({ routeParams: { skyId: 'sky-1' } })
    await getSky(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      sky: { title: 'Test Sky' },
      member: { role: 'owner', status: 'active' },
    })
  })

  it('retorna 404 si getSkyWithAccess retorna not_found', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'not_found' } as any)

    const res = makeRes()
    await getSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cielo no encontrado' })
  })

  it('retorna 500 si getSkyWithAccess retorna error', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({ ok: false, reason: 'error' } as any)

    const res = makeRes()
    await getSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Error interno al verificar acceso' })
  })
})

// ─── getUserSkies ────────────────────────────────────────────

describe('getUserSkies', () => {
  it('retorna lista de cielos ordenados por createdAt desc', async () => {
    const skyRefA = { id: 'sky-a' }
    const skyRefB = { id: 'sky-b' }
    mocks.collectionGroupGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ userId: 'test-uid', role: 'owner', status: 'active' }), ref: { parent: { parent: skyRefA } } },
        { data: () => ({ userId: 'test-uid', role: 'editor', status: 'active' }), ref: { parent: { parent: skyRefB } } },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: true, data: () => ({ title: 'Sky A', createdAt: '2026-01-01T00:00:00Z' }) },
      { exists: true, data: () => ({ title: 'Sky B', createdAt: '2026-01-02T00:00:00Z' }) },
    ])

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.skies).toHaveLength(2)
    // Ordenados por createdAt desc: Sky B (mas reciente) primero
    expect(jsonArg.skies[0].skyId).toBe('sky-b')
    expect(jsonArg.skies[0].role).toBe('editor')
    expect(jsonArg.skies[1].skyId).toBe('sky-a')
    expect(jsonArg.skies[1].role).toBe('owner')
  })

  it('retorna array vacio si no es miembro de ningun cielo', async () => {
    mocks.collectionGroupGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ skies: [] })
  })

  it('omite cielos que ya no existen', async () => {
    const skyRefA = { id: 'sky-a' }
    const skyRefB = { id: 'sky-b' }
    mocks.collectionGroupGet.mockResolvedValue({
      empty: false,
      docs: [
        { data: () => ({ userId: 'test-uid', role: 'owner', status: 'active' }), ref: { parent: { parent: skyRefA } } },
        { data: () => ({ userId: 'test-uid', role: 'editor', status: 'active' }), ref: { parent: { parent: skyRefB } } },
      ],
    })
    mocks.getAll.mockResolvedValue([
      { exists: true, data: () => ({ title: 'Sky A', createdAt: '2026-01-01T00:00:00Z' }) },
      { exists: false, data: () => undefined },
    ])

    const res = makeRes()
    await getUserSkies(makeReq(), res)

    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.skies).toHaveLength(1)
    expect(jsonArg.skies[0].skyId).toBe('sky-a')
  })
})

// ─── updateSky ───────────────────────────────────────────────

describe('updateSky', () => {
  it('actualiza titulo exitosamente como owner', async () => {
    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: { title: 'Nuevo Titulo' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.skyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nuevo Titulo', updatedAt: expect.any(String) }),
    )
  })

  it('actualiza personalization con merge parcial', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true,
      sky: {
        title: 'Test Sky',
        personalization: { density: 'medium', nebulaEnabled: true, twinkleEnabled: true, shootingStarsEnabled: false },
      },
      member: { role: 'owner', status: 'active' },
    } as any)

    const res = makeRes()
    await updateSky(makeReq({
      routeParams: { skyId: 'sky-1' },
      body: { personalization: { density: 'high' } },
    }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.skyUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        personalization: {
          density: 'high',
          nebulaEnabled: true,
          twinkleEnabled: true,
          shootingStarsEnabled: false,
        },
      }),
    )
  })

  it('rechaza con 403 si no es owner', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)

    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: { title: 'X' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede modificar el cielo' })
  })

  it('rechaza campos no permitidos en personalization', async () => {
    const res = makeRes()
    await updateSky(makeReq({
      routeParams: { skyId: 'sky-1' },
      body: { personalization: { hackedField: true } },
    }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Campos no permitidos: hackedField' })
  })

  it('rechaza si no se envia ni title ni personalization', async () => {
    const res = makeRes()
    await updateSky(makeReq({ routeParams: { skyId: 'sky-1' }, body: {} }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Se requiere al menos title o personalization' })
  })
})

// ─── deleteSky ───────────────────────────────────────────────

describe('deleteSky', () => {
  it('elimina cielo con estrellas, miembros e invites pendientes', async () => {
    mocks.starsGet.mockResolvedValue({
      docs: [
        { ref: { id: 'star-1' }, data: () => ({ mediaPath: 'stars/sky-1/star-1/image', thumbnailPath: null }) },
        { ref: { id: 'star-2' }, data: () => ({ mediaPath: null, thumbnailPath: null }) },
      ],
    })
    mocks.subMembersGet.mockResolvedValue({
      docs: [
        { ref: { id: 'member-1' } },
        { ref: { id: 'member-2' } },
      ],
    })
    mocks.invitesQuery.get.mockResolvedValue({
      docs: [
        { ref: { id: 'invite-1' } },
      ],
    })

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    // 2 stars + 2 members + 1 sky doc = 5 deletes
    expect(mocks.batchDelete).toHaveBeenCalledTimes(5)
    // 1 invite actualizado a revoked
    expect(mocks.batchUpdate).toHaveBeenCalledWith(
      { id: 'invite-1' },
      { status: 'revoked' },
    )
    expect(mocks.batchCommit).toHaveBeenCalled()
    // Storage cleanup: solo star con mediaPath
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/image')
    expect(mocks.storageDelete).toHaveBeenCalledTimes(1)
  })

  it('rechaza con 403 si no es owner', async () => {
    vi.mocked(getSkyWithAccess).mockResolvedValueOnce({
      ok: true, sky: { title: 'Test Sky' }, member: { role: 'editor', status: 'active' },
    } as any)

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Solo el propietario puede eliminar el cielo' })
    expect(mocks.batchDelete).not.toHaveBeenCalled()
  })

  it('elimina mediaPath, thumbnailPath y archivos temp de todas las estrellas', async () => {
    mocks.starsGet.mockResolvedValue({
      docs: [
        { ref: { id: 'star-1' }, data: () => ({ mediaPath: 'stars/sky-1/star-1/video', thumbnailPath: 'stars/sky-1/star-1/thumb' }) },
        { ref: { id: 'star-2' }, data: () => ({ mediaPath: null, thumbnailPath: null }) },
      ],
    })
    mocks.subMembersGet.mockResolvedValue({ docs: [] })
    mocks.storageGetFiles.mockResolvedValue([[
      { name: 'temp/sky-1/star-1/raw' },
    ]])

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/video')
    expect(mocks.storageFile).toHaveBeenCalledWith('stars/sky-1/star-1/thumb')
    expect(mocks.storageFile).toHaveBeenCalledWith('temp/sky-1/star-1/raw')
    expect(mocks.storageDelete).toHaveBeenCalledTimes(3)
  })

  it('completa aunque Storage cleanup falle', async () => {
    mocks.starsGet.mockResolvedValue({
      docs: [
        { ref: { id: 'star-1' }, data: () => ({ mediaPath: 'stars/sky-1/star-1/image', thumbnailPath: null }) },
      ],
    })
    mocks.subMembersGet.mockResolvedValue({ docs: [] })
    mocks.storageDelete.mockRejectedValue(new Error('Storage unavailable'))

    const res = makeRes()
    await deleteSky(makeReq({ routeParams: { skyId: 'sky-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.batchCommit).toHaveBeenCalled()
  })
})
