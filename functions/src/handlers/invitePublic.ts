import { createHash } from 'node:crypto'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { findInviteIdByToken } from '../lib/findInviteIdByToken.js'
import { acceptInvite, InviteError } from '../lib/acceptInvite.js'
import type { InviteRecord, SkyRecord, TransactionRecord } from '../domain/contracts.js'
import { INVITE_ACCEPTED_REWARD, MAX_INVITE_REWARDS_PER_DAY } from '../domain/economyRules.js'

export async function previewInvite(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.routeParams

    // Inline getInviteByToken logic
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const snapshot = await db
      .collection('invites')
      .where('tokenHash', '==', tokenHash)
      .limit(1)
      .get()

    if (snapshot.empty) {
      res.status(200).json({ valid: false, reason: 'not_found' })
      return
    }

    const doc = snapshot.docs[0]
    const invite = doc.data() as InviteRecord

    if (invite.status === 'revoked') {
      res.status(200).json({ valid: false, reason: 'revoked' })
      return
    }

    if (invite.status === 'accepted') {
      res.status(200).json({ valid: false, reason: 'accepted' })
      return
    }

    if (invite.status === 'expired' || new Date(invite.expiresAt) <= new Date()) {
      res.status(200).json({ valid: false, reason: 'expired' })
      return
    }

    const skyDoc = await db.collection('skies').doc(invite.skyId).get()
    const sky = skyDoc.exists ? (skyDoc.data() as SkyRecord) : null

    res.status(200).json({
      valid: true,
      inviteId: doc.id,
      skyId: invite.skyId,
      skyTitle: sky?.title ?? 'Cielo sin nombre',
      role: invite.role,
    })
  } catch (error) {
    console.error('Invite preview failed:', error)
    res.status(200).json({ valid: false, reason: 'not_found' })
  }
}

export async function acceptInviteHandler(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { token } = req.routeParams

    const inviteId = await findInviteIdByToken(token)
    if (!inviteId) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }

    const userSnap = await db.collection('users').doc(decoded.uid).get()
    const userData = userSnap.data()
    const maxMemberships = typeof userData?.maxMemberships === 'number' ? userData.maxMemberships : 20

    const memberSnap = await db.collectionGroup('members')
      .where('userId', '==', decoded.uid)
      .where('status', '==', 'active')
      .where('role', 'in', ['editor', 'viewer'])
      .get()

    if (memberSnap.size >= maxMemberships) {
      res.status(403).json({ error: 'Has alcanzado el límite de cielos como miembro', maxMemberships })
      return
    }

    const { skyId } = await acceptInvite(inviteId, decoded.uid)

    let stardustEarned = 0
    try {
      const freshSnap = await db.collection('users').doc(decoded.uid).get()
      const freshData = freshSnap.data()

      if (freshData) {
        const todayUTC = new Date().toISOString().slice(0, 10)
        let acceptedInvitesToday = typeof freshData.acceptedInvitesToday === 'number' ? freshData.acceptedInvitesToday : 0
        const lastInviteAcceptDate = typeof freshData.lastInviteAcceptDate === 'string' ? freshData.lastInviteAcceptDate : null
        const currentStardust = typeof freshData.stardust === 'number' ? freshData.stardust : 0

        if (lastInviteAcceptDate !== todayUTC) {
          acceptedInvitesToday = 0
        }

        if (acceptedInvitesToday < MAX_INVITE_REWARDS_PER_DAY) {
          stardustEarned = INVITE_ACCEPTED_REWARD
          acceptedInvitesToday += 1
          const newBalance = currentStardust + stardustEarned

          const userRef = db.collection('users').doc(decoded.uid)
          await userRef.update({
            stardust: newBalance,
            acceptedInvitesToday,
            lastInviteAcceptDate: todayUTC,
          })

          const tx: TransactionRecord = {
            type: 'earn',
            amount: stardustEarned,
            reason: 'invite_accepted',
            itemId: null,
            balanceAfter: newBalance,
            createdAt: new Date().toISOString(),
          }
          await userRef.collection('transactions').add(tx)
        }
      }
    } catch (rewardError) {
      console.error('Invite accept reward failed (non-blocking):', rewardError)
    }

    res.status(200).json({ skyId, rewards: { stardustEarned } })
  } catch (error: unknown) {
    const inviteErr = error as { code?: string; skyId?: string }
    if (error instanceof InviteError) {
      switch (inviteErr.code) {
        case 'invite_not_found':
          res.status(404).json({ error: 'Invitación no encontrada' })
          return
        case 'invite_expired':
          res.status(409).json({ error: 'Esta invitación ha expirado' })
          return
        case 'invite_revoked':
          res.status(409).json({ error: 'Esta invitación fue revocada' })
          return
        case 'invite_already_used':
          res.status(409).json({ error: 'Esta invitación ya fue utilizada por otra persona' })
          return
        case 'already_member':
          res.status(409).json({ error: 'already_member', skyId: inviteErr.skyId })
          return
        case 'membership_conflict':
          res.status(409).json({ error: 'No se puede completar la invitación. Contacta al propietario.' })
          return
      }
    }
    console.error('Accept invite failed:', error)
    res.status(500).json({ error: 'Error interno al aceptar la invitación' })
  }
}
