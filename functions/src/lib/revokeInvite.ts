import { db } from './firebaseAdmin.js'
import type { InviteRecord } from '../domain/contracts.js'

export class RevokeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RevokeError'
  }
}

export async function revokeInvite(inviteId: string, skyId: string): Promise<void> {
  const inviteRef = db.collection('invites').doc(inviteId)
  const inviteSnap = await inviteRef.get()

  if (!inviteSnap.exists) {
    throw new RevokeError('invite_not_found', 'Invitación no encontrada')
  }

  const invite = inviteSnap.data() as InviteRecord

  if (invite.skyId !== skyId) {
    throw new RevokeError('invite_not_found', 'Invitación no encontrada')
  }
  if (invite.status === 'accepted') {
    throw new RevokeError('invite_already_used', 'Invitación ya utilizada')
  }
  if (invite.status === 'revoked') {
    throw new RevokeError('invite_already_revoked', 'Invitación ya revocada')
  }

  const now = new Date().toISOString()
  if (invite.expiresAt < now) {
    throw new RevokeError('invite_expired', 'Invitación expirada')
  }

  await inviteRef.update({ status: 'revoked' })
}
