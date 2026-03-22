import { createHash } from 'node:crypto'
import { db } from './firebaseAdmin.js'

export async function findInviteIdByToken(token: string): Promise<string | null> {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const snap = await db
    .collection('invites')
    .where('tokenHash', '==', tokenHash)
    .where('status', '==', 'pending')
    .limit(1)
    .get()

  if (snap.empty) return null
  return snap.docs[0].id
}
