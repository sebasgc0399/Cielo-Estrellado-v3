import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const mocks = vi.hoisted(() => {
  const userGet = vi.fn()
  const userDelete = vi.fn().mockResolvedValue(undefined)
  const authDeleteUser = vi.fn().mockResolvedValue(undefined)
  const batchDelete = vi.fn()
  const batchUpdate = vi.fn()
  const batchCommit = vi.fn().mockResolvedValue(undefined)

  const collectionGroupQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: vi.fn(),
  }
  collectionGroupQuery.where.mockReturnValue(collectionGroupQuery)

  const invitesQuery: Record<string, ReturnType<typeof vi.fn>> = {
    where: vi.fn(),
    get: vi.fn(),
  }
  invitesQuery.where.mockReturnValue(invitesQuery)

  const transactionsGet = vi.fn().mockResolvedValue({ empty: true, docs: [] })
  const inventoryGet = vi.fn().mockResolvedValue({ empty: true, docs: [] })
  const starsGet = vi.fn().mockResolvedValue({ docs: [] })
  const subMembersGet = vi.fn().mockResolvedValue({ docs: [] })
  const storageFile = vi.fn().mockReturnValue({ delete: vi.fn().mockResolvedValue(undefined) })
  const storageGetFiles = vi.fn().mockResolvedValue([[]])

  return {
    userGet, userDelete, authDeleteUser,
    batchDelete, batchUpdate, batchCommit,
    collectionGroupQuery, invitesQuery,
    transactionsGet, inventoryGet,
    starsGet, subMembersGet,
    storageFile, storageGetFiles,
  }
})

vi.mock('../middleware/auth.js', () => ({
  authenticateRequest: vi.fn().mockResolvedValue({ uid: 'test-uid' }),
}))

vi.mock('../lib/getSkyWithAccess.js', () => ({
  getSkyWithAccess: vi.fn(),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  auth: { deleteUser: mocks.authDeleteUser },
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'users') return {
        doc: vi.fn().mockReturnValue({
          get: mocks.userGet,
          delete: mocks.userDelete,
        }),
      }
      if (name === 'users/test-uid/transactions') return { get: mocks.transactionsGet }
      if (name === 'users/test-uid/inventory') return { get: mocks.inventoryGet }
      if (name === 'skies') return {
        doc: vi.fn().mockReturnValue({
          id: 'sky-1',
          collection: vi.fn((sub: string) => {
            if (sub === 'stars') return { get: mocks.starsGet }
            if (sub === 'members') return {
              doc: vi.fn().mockReturnValue({}),
              get: mocks.subMembersGet,
            }
            return { doc: vi.fn().mockReturnValue({}) }
          }),
        }),
      }
      if (name === 'invites') return mocks.invitesQuery
      return {}
    }),
    collectionGroup: vi.fn().mockReturnValue(mocks.collectionGroupQuery),
    batch: vi.fn().mockReturnValue({
      delete: mocks.batchDelete,
      update: mocks.batchUpdate,
      commit: mocks.batchCommit,
    }),
  },
  storage: {
    bucket: vi.fn().mockReturnValue({
      file: mocks.storageFile,
      getFiles: mocks.storageGetFiles,
    }),
  },
}))

import { deleteAccount } from './deleteAccount'

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
  mocks.collectionGroupQuery.where.mockReturnValue(mocks.collectionGroupQuery)
  mocks.invitesQuery.where.mockReturnValue(mocks.invitesQuery)
  mocks.transactionsGet.mockResolvedValue({ empty: true, docs: [] })
  mocks.inventoryGet.mockResolvedValue({ empty: true, docs: [] })
  mocks.starsGet.mockResolvedValue({ docs: [] })
  mocks.subMembersGet.mockResolvedValue({ docs: [] })
  mocks.storageGetFiles.mockResolvedValue([[]])
})

describe('deleteAccount', () => {
  it('elimina usuario sin cielos', async () => {
    mocks.userGet.mockResolvedValue({ exists: true })
    // No owned skies, no other memberships, no invites
    mocks.collectionGroupQuery.get.mockResolvedValue({ docs: [] })
    mocks.invitesQuery.get.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.userDelete).toHaveBeenCalled()
    expect(mocks.authDeleteUser).toHaveBeenCalledWith('test-uid')
  })

  it('retorna 404 si usuario no existe', async () => {
    mocks.userGet.mockResolvedValue({ exists: false })

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mocks.userDelete).not.toHaveBeenCalled()
    expect(mocks.authDeleteUser).not.toHaveBeenCalled()
  })

  it('elimina cielos propios via deleteSkyData', async () => {
    mocks.userGet.mockResolvedValue({ exists: true })

    const skyRef = { id: 'sky-owned' }
    const memberDoc = {
      ref: { parent: { parent: skyRef } },
    }
    // First call: owned skies, second call: other memberships
    mocks.collectionGroupQuery.get
      .mockResolvedValueOnce({ docs: [memberDoc] })
      .mockResolvedValueOnce({ docs: [] })

    mocks.invitesQuery.get.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    // deleteSkyData should have been called (batch operations happened)
    expect(mocks.batchCommit).toHaveBeenCalled()
    expect(mocks.userDelete).toHaveBeenCalled()
  })

  it('revoca membresías en cielos ajenos', async () => {
    mocks.userGet.mockResolvedValue({ exists: true })

    const memberRef = { update: vi.fn() }
    const memberDoc = { ref: memberRef }

    // First call: no owned skies, second call: other memberships
    mocks.collectionGroupQuery.get
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ empty: false, docs: [memberDoc] })

    mocks.invitesQuery.get.mockResolvedValue({ empty: true, docs: [] })

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.batchUpdate).toHaveBeenCalledWith(memberRef, { status: 'revoked' })
  })

  it('responde ok aunque auth.deleteUser falle (best-effort)', async () => {
    mocks.userGet.mockResolvedValue({ exists: true })
    mocks.collectionGroupQuery.get.mockResolvedValue({ docs: [] })
    mocks.invitesQuery.get.mockResolvedValue({ empty: true, docs: [] })
    mocks.authDeleteUser.mockRejectedValue(new Error('Auth service unavailable'))

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ ok: true })
    expect(mocks.userDelete).toHaveBeenCalled()
  })

  it('revoca invites pendientes creadas por el usuario', async () => {
    mocks.userGet.mockResolvedValue({ exists: true })
    mocks.collectionGroupQuery.get.mockResolvedValue({ docs: [] })

    const inviteRef = { update: vi.fn() }
    const inviteDoc = { ref: inviteRef }
    mocks.invitesQuery.get.mockResolvedValue({ empty: false, docs: [inviteDoc] })

    const res = makeRes()
    await deleteAccount(makeReq(), res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(mocks.batchUpdate).toHaveBeenCalledWith(inviteRef, { status: 'revoked' })
  })
})
