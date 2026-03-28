import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const memberGet = vi.fn()
  const invitesGet = vi.fn()
  const countGet = vi.fn()
  const createInviteFn = vi.fn()
  const revokeInviteFn = vi.fn()

  const invitesQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    orderBy: vi.fn(),
    count: vi.fn(),
    get: invitesGet,
  }
  invitesQuery.where.mockReturnValue(invitesQuery)
  invitesQuery.orderBy.mockReturnValue(invitesQuery)
  invitesQuery.count.mockReturnValue({ get: countGet })

  const memberDocRef = { get: memberGet }

  return { memberGet, invitesGet, countGet, createInviteFn, revokeInviteFn, invitesQuery, memberDocRef }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/createInvite.js', () => ({
  createInvite: mocks.createInviteFn,
}))

vi.mock('../lib/revokeInvite.js', () => ({
  revokeInvite: mocks.revokeInviteFn,
  RevokeError: class RevokeError extends Error {
    constructor(public code: string, message: string) {
      super(message)
      this.name = 'RevokeError'
    }
  },
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'skies') {
        return {
          doc: vi.fn().mockReturnValue({
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue(mocks.memberDocRef),
            }),
          }),
        }
      }
      if (name === 'invites') return mocks.invitesQuery
      return {}
    }),
  },
}))

vi.mock('../logError.js', () => ({
  logError: vi.fn(),
}))

import { createInviteHandler, listInvites, revokeInviteHandler } from './invites'

function makeReq(overrides: { routeParams?: Record<string, string>; body?: unknown } = {}) {
  return {
    headers: { authorization: 'Bearer test-token' },
    routeParams: { skyId: 'sky-1', ...overrides.routeParams },
    body: overrides.body ?? {},
    query: {},
  } as unknown as Request
}

function makeRes() {
  const res: Record<string, ReturnType<typeof vi.fn>> = {}
  res.json = vi.fn().mockReturnValue(res)
  res.status = vi.fn().mockReturnValue(res)
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> }
}

function setupOwner() {
  mocks.memberGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'owner' }),
  })
}

function setupEditor() {
  mocks.memberGet.mockResolvedValue({
    exists: true,
    data: () => ({ status: 'active', role: 'editor' }),
  })
}

function setupNotMember() {
  mocks.memberGet.mockResolvedValue({ exists: false })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_URL = 'https://test.app'
  mocks.invitesQuery.where.mockReturnValue(mocks.invitesQuery)
  mocks.invitesQuery.orderBy.mockReturnValue(mocks.invitesQuery)
  mocks.invitesQuery.count.mockReturnValue({ get: mocks.countGet })
  mocks.countGet.mockResolvedValue({ data: () => ({ count: 0 }) })
  mocks.createInviteFn.mockResolvedValue({ token: 'abc123' })
  mocks.revokeInviteFn.mockResolvedValue(undefined)
})

describe('createInviteHandler', () => {
  it('crea invite exitosamente como owner', async () => {
    setupOwner()
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      inviteUrl: 'https://test.app/invite/abc123',
    })
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 400 si rol es invalido', async () => {
    setupOwner()
    const res = makeRes()
    await createInviteHandler(makeReq({ body: { role: 'admin' } }), res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Rol debe ser "editor" o "viewer"' })
  })

  it('usa rol editor por defecto si no se especifica', async () => {
    setupOwner()
    const res = makeRes()
    await createInviteHandler(makeReq({ body: {} }), res)

    expect(mocks.createInviteFn).toHaveBeenCalledWith('sky-1', 'editor', 'test-uid')
  })

  it('pasa rol viewer cuando se especifica', async () => {
    setupOwner()
    const res = makeRes()
    await createInviteHandler(makeReq({ body: { role: 'viewer' } }), res)

    expect(mocks.createInviteFn).toHaveBeenCalledWith('sky-1', 'viewer', 'test-uid')
  })

  it('retorna 500 si APP_URL no esta configurado', async () => {
    setupOwner()
    delete process.env.APP_URL
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Error de configuración del servidor' })
  })

  it('rechaza con 429 si excede MAX_PENDING_INVITES_PER_SKY', async () => {
    setupOwner()
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 10 }) })
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(429)
    expect(mocks.createInviteFn).not.toHaveBeenCalled()
  })

  it('permite creacion si invites pendientes bajo el limite', async () => {
    setupOwner()
    mocks.countGet.mockResolvedValue({ data: () => ({ count: 9 }) })
    const res = makeRes()
    await createInviteHandler(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(201)
  })
})

describe('listInvites', () => {
  it('lista invites pendientes filtrando expiradas', async () => {
    setupOwner()
    const futureDate = new Date(Date.now() + 86400000).toISOString()
    const pastDate = new Date(Date.now() - 86400000).toISOString()
    mocks.invitesGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'inv-1', data: () => ({ role: 'editor', expiresAt: futureDate, status: 'pending' }) },
        { id: 'inv-2', data: () => ({ role: 'viewer', expiresAt: pastDate, status: 'pending' }) },
      ],
    })

    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonArg = res.json.mock.calls[0][0]
    expect(jsonArg.invites).toHaveLength(1)
    expect(jsonArg.invites[0]).toEqual({
      inviteId: 'inv-1',
      role: 'editor',
      expiresAt: futureDate,
    })
  })

  it('retorna array vacio si no hay invites', async () => {
    setupOwner()
    mocks.invitesGet.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ invites: [] })
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()
    const res = makeRes()
    await listInvites(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })
})

describe('revokeInviteHandler', () => {
  it('revoca invite exitosamente como owner', async () => {
    setupOwner()
    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
  })

  it('rechaza con 403 si no es miembro', async () => {
    setupNotMember()
    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('rechaza con 403 si no es owner', async () => {
    setupEditor()
    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('retorna 404 para invite_not_found', async () => {
    setupOwner()
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteFn.mockRejectedValue(new RevokeError('invite_not_found', 'Not found'))

    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('retorna 409 para invite_already_used', async () => {
    setupOwner()
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteFn.mockRejectedValue(new RevokeError('invite_already_used', 'Already used'))

    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para invite_already_revoked', async () => {
    setupOwner()
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteFn.mockRejectedValue(new RevokeError('invite_already_revoked', 'Already revoked'))

    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('retorna 409 para invite_expired', async () => {
    setupOwner()
    const { RevokeError } = await import('../lib/revokeInvite.js')
    mocks.revokeInviteFn.mockRejectedValue(new RevokeError('invite_expired', 'Expired'))

    const res = makeRes()
    await revokeInviteHandler(makeReq({ routeParams: { skyId: 'sky-1', inviteId: 'inv-1' } }), res)

    expect(res.status).toHaveBeenCalledWith(409)
  })
})
