import { db } from './firebaseAdmin.js'
import type { InviteRecord, MemberRecord } from '../domain/contracts.js'

export class InviteError extends Error {
  constructor(
    public code: string,
    message: string,
    public skyId?: string,
  ) {
    super(message)
    this.name = 'InviteError'
  }
}

export async function acceptInvite(inviteId: string, uid: string): Promise<{ skyId: string }> {
  return db.runTransaction(async (transaction) => {
    const inviteRef = db.collection('invites').doc(inviteId)
    const inviteSnap = await transaction.get(inviteRef)

    if (!inviteSnap.exists) {
      throw new InviteError('invite_not_found', 'Invitación no encontrada')
    }

    const invite = inviteSnap.data() as InviteRecord
    const now = new Date().toISOString()

    if (invite.status === 'revoked') {
      throw new InviteError('invite_revoked', 'Invitación revocada')
    }
    if (invite.status === 'accepted') {
      throw new InviteError('invite_already_used', 'Invitación ya utilizada')
    }
    if (invite.expiresAt < now) {
      throw new InviteError('invite_expired', 'Invitación expirada')
    }

    const memberRef = db.collection('skies').doc(invite.skyId).collection('members').doc(uid)
    const memberSnap = await transaction.get(memberRef)

    if (memberSnap.exists) {
      const existing = memberSnap.data() as MemberRecord
      if (existing.status === 'active') {
        throw new InviteError('already_member', 'Ya eres miembro de este cielo', invite.skyId)
      }
      throw new InviteError('membership_conflict', 'Conflicto de membresía')
    }

    const newMember: MemberRecord = {
      userId: uid,
      role: invite.role,
      status: 'active',
      invitedByUserId: invite.createdByUserId,
      joinedAt: now,
    }

    transaction.set(memberRef, newMember)

    transaction.update(inviteRef, {
      status: 'accepted',
      acceptedByUserId: uid,
      acceptedAt: now,
    })

    return { skyId: invite.skyId }
  })
}
