import { createHash } from 'node:crypto'
import { onRequest } from 'firebase-functions/v2/https'
import { handleCors } from '../middleware/cors.js'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { findInviteIdByToken } from '../lib/findInviteIdByToken.js'
import { acceptInvite, InviteError } from '../lib/acceptInvite.js'
import type { InviteRecord, SkyRecord } from '../domain/contracts.js'

export const previewInvite = onRequest(async (req, res) => {
  if (handleCors(req, res)) return

  try {
    // Extract token from path: /{token}
    const segments = req.path.split('/').filter(Boolean)
    const token = segments[0]

    if (!token) {
      res.status(200).json({ valid: false, reason: 'not_found' })
      return
    }

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
})

export const acceptInviteHandler = onRequest(async (req, res) => {
  if (handleCors(req, res)) return

  try {
    const decoded = await authenticateRequest(req)

    // Extract token from path: /{token}
    const segments = req.path.split('/').filter(Boolean)
    const token = segments[0]

    if (!token) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }

    const inviteId = await findInviteIdByToken(token)
    if (!inviteId) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }

    const { skyId } = await acceptInvite(inviteId, decoded.uid)
    res.status(200).json({ skyId })
  } catch (error) {
    if (error instanceof InviteError) {
      switch (error.code) {
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
          res.status(409).json({ error: 'already_member', skyId: error.skyId })
          return
        case 'membership_conflict':
          res.status(409).json({ error: 'No se puede completar la invitación. Contacta al propietario.' })
          return
      }
    }
    console.error('Accept invite failed:', error)
    res.status(500).json({ error: 'Error interno al aceptar la invitación' })
  }
})
