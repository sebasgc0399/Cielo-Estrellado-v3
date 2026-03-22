import { type Request, HttpsError } from 'firebase-functions/v2/https'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { auth } from '../lib/firebaseAdmin.js'

export async function authenticateRequest(req: Request): Promise<DecodedIdToken> {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    throw new HttpsError('unauthenticated', 'Missing or invalid Authorization header')
  }
  const token = header.split('Bearer ')[1]
  return auth.verifyIdToken(token)
}
