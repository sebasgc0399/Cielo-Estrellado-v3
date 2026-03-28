import { randomBytes, createHash } from 'node:crypto'
import { db } from './firebaseAdmin.js'
import type { InviteRole } from '../domain/contracts.js'
import { INVITE_TTL_MS } from '../domain/policies.js'

export async function createInvite(
  skyId: string,
  role: InviteRole,
  createdByUserId: string,
): Promise<{ token: string }> {
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const now = new Date()

  // La coleccion 'invites' tiene una TTL policy de Firestore configurada
  // sobre el campo 'expiresAt'. Firestore elimina automaticamente los documentos
  // expirados (con retraso tipico de 24-72h). Ver SPEC-invitaciones.md Fix 2.
  await db.collection('invites').add({
    skyId,
    role,
    tokenHash,
    createdByUserId,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    status: 'pending',
    acceptedByUserId: null,
    acceptedAt: null,
  })

  return { token }
}
