import type { Request } from 'firebase-functions/v2/https'

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}))

vi.mock('../lib/firebaseAdmin.js', () => ({
  auth: { verifyIdToken: mocks.verifyIdToken },
}))

import { authenticateRequest } from './auth'

function makeReq(authHeader?: string) {
  return {
    headers: { authorization: authHeader },
  } as unknown as Request
}

describe('authenticateRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifica token con checkRevoked habilitado', async () => {
    const decoded = { uid: 'test-uid' }
    mocks.verifyIdToken.mockResolvedValue(decoded)

    const result = await authenticateRequest(makeReq('Bearer valid-token'))

    expect(mocks.verifyIdToken).toHaveBeenCalledWith('valid-token', true)
    expect(result).toEqual(decoded)
  })

  it('lanza error si no hay header Authorization', async () => {
    await expect(authenticateRequest(makeReq())).rejects.toThrow(
      'Missing or invalid Authorization header',
    )
    expect(mocks.verifyIdToken).not.toHaveBeenCalled()
  })

  it('lanza error si el header no tiene formato Bearer', async () => {
    await expect(authenticateRequest(makeReq('Basic abc'))).rejects.toThrow(
      'Missing or invalid Authorization header',
    )
    expect(mocks.verifyIdToken).not.toHaveBeenCalled()
  })

  it('propaga error de token revocado', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('id-token-revoked'))

    await expect(authenticateRequest(makeReq('Bearer revoked-token'))).rejects.toThrow(
      'id-token-revoked',
    )
  })
})
