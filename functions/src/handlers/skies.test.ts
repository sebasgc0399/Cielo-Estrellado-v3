import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const userGet = vi.fn()
  const collectionGroupGet = vi.fn()
  const inventoryGet = vi.fn().mockResolvedValue({ docs: [] })
  const skyUpdate = vi.fn().mockResolvedValue(undefined)

  const membersQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: collectionGroupGet,
  }
  membersQuery.where.mockReturnValue(membersQuery)

  const batchSet = vi.fn()
  const batchCommit = vi.fn().mockResolvedValue(undefined)

  return { userGet, collectionGroupGet, inventoryGet, skyUpdate, membersQuery, batchSet, batchCommit }
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
          collection: vi.fn().mockReturnValue({ doc: vi.fn().mockReturnValue({}) }),
        }),
      }
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.membersQuery),
    batch: vi.fn().mockReturnValue({ set: mocks.batchSet, commit: mocks.batchCommit }),
  },
}))

import { createSky, updateSkyTheme } from './skies'

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.membersQuery.where.mockReturnValue(mocks.membersQuery)
  mocks.inventoryGet.mockResolvedValue({ docs: [] })
  mocks.skyUpdate.mockResolvedValue(undefined)
  mocks.batchCommit.mockResolvedValue(undefined)
})

describe('createSky', () => {
  it('rechaza crear cielo si maxSkies alcanzado', async () => {
    mocks.userGet.mockResolvedValue({ data: () => ({ maxSkies: 2 }) })
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
