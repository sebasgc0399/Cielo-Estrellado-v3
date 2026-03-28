import { createHash } from 'node:crypto'
import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { findInviteIdByToken } from '../lib/findInviteIdByToken.js'
import { acceptInvite, InviteError } from '../lib/acceptInvite.js'
import type { InviteRecord, SkyRecord, TransactionRecord } from '../domain/contracts.js'
import { INVITE_ACCEPTED_REWARD, MAX_INVITE_REWARDS_PER_DAY, MAX_MEMBERS_PER_SKY } from '../domain/economyRules.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'
import { logError } from '../logError.js'

export async function previewInvite(req: Request, res: Response): Promise<void> {
  try {
    const { token } = req.routeParams

    // Busca sin filtrar por status intencionalmente: preview debe retornar
    // { valid: false } para invites aceptadas/revocadas/expiradas, en vez de
    // un generico 404. Esto da feedback al usuario sobre por que el enlace
    // ya no funciona. Contrasta con findInviteIdByToken() que SI filtra por
    // status 'pending' porque solo necesita encontrar invites aceptables.
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const snapshot = await db
      .collection('invites')
      .where('tokenHash', '==', tokenHash)
      .limit(1)
      .get()

    if (snapshot.empty) {
      res.status(200).json({ valid: false })
      return
    }

    const doc = snapshot.docs[0]
    const invite = doc.data() as InviteRecord

    if (invite.status === 'revoked' || invite.status === 'accepted' || invite.status === 'expired' || invite.expiresAt.toDate() <= new Date()) {
      res.status(200).json({ valid: false })
      return
    }

    const skyDoc = await db.collection('skies').doc(invite.skyId).get()
    const sky = skyDoc.exists ? (skyDoc.data() as SkyRecord) : null

    res.status(200).json({
      valid: true,
      skyId: invite.skyId,
      skyTitle: sky?.title ?? 'Cielo sin nombre',
      role: invite.role,
    })
  } catch (error) {
    console.error('Invite preview failed:', error instanceof Error ? error.message : String(error))
    res.status(200).json({ valid: false })
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
    const maxMemberships = typeof userData?.maxMemberships === 'number' ? userData.maxMemberships : DEFAULT_USER_ECONOMY.maxMemberships

    const memberSnap = await db.collectionGroup('members')
      .where('userId', '==', decoded.uid)
      .where('status', '==', 'active')
      .where('role', 'in', ['editor', 'viewer'])
      .get()

    if (memberSnap.size >= maxMemberships) {
      res.status(403).json({ error: 'Has alcanzado el límite de cielos como miembro', maxMemberships })
      return
    }

    // Verificar que el cielo no exceda su limite de miembros
    const inviteSnap = await db.collection('invites').doc(inviteId).get()
    if (!inviteSnap.exists) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }
    const inviteData = inviteSnap.data() as InviteRecord

    const skyMembersSnap = await db
      .collection('skies')
      .doc(inviteData.skyId)
      .collection('members')
      .where('status', '==', 'active')
      .count()
      .get()

    if (skyMembersSnap.data().count >= MAX_MEMBERS_PER_SKY) {
      res.status(403).json({ error: 'Este cielo ha alcanzado el límite de miembros', maxMembers: MAX_MEMBERS_PER_SKY })
      return
    }

    const { skyId } = await acceptInvite(inviteId, decoded.uid)

    const userRef = db.collection('users').doc(decoded.uid)
    let stardustEarned = 0
    // Trade-off de diseno: la recompensa de PE es una transaccion SEPARADA de acceptInvite().
    // acceptInvite() opera sobre invite+member (coleccion skies), el reward opera sobre el user.
    // Si el reward falla, el usuario acepta la invite pero no recibe PE — la membresia es
    // la operacion primaria. Combinar ambas transacciones aumentaria la superficie de contencion
    // sin beneficio proporcional, ya que el reward es best-effort (try/catch no-bloqueante).
    try {
      const rewardResult = await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(userRef)
        const freshData = freshSnap.data()
        if (!freshData) return null

        const todayUTC = new Date().toISOString().slice(0, 10)
        let acceptedInvitesToday = typeof freshData.acceptedInvitesToday === 'number' ? freshData.acceptedInvitesToday : DEFAULT_USER_ECONOMY.acceptedInvitesToday
        const lastInviteAcceptDate = typeof freshData.lastInviteAcceptDate === 'string' ? freshData.lastInviteAcceptDate : DEFAULT_USER_ECONOMY.lastInviteAcceptDate
        const currentStardust = typeof freshData.stardust === 'number' ? freshData.stardust : DEFAULT_USER_ECONOMY.stardust

        if (lastInviteAcceptDate !== todayUTC) {
          acceptedInvitesToday = 0
        }

        if (acceptedInvitesToday < MAX_INVITE_REWARDS_PER_DAY) {
          acceptedInvitesToday += 1
          const newBalance = currentStardust + INVITE_ACCEPTED_REWARD
          transaction.update(userRef, {
            stardust: newBalance,
            acceptedInvitesToday,
            lastInviteAcceptDate: todayUTC,
          })

          // Audit log DENTRO de la transaccion
          const txDocRef = userRef.collection('transactions').doc()
          transaction.set(txDocRef, {
            type: 'earn',
            amount: INVITE_ACCEPTED_REWARD,
            reason: 'invite_accepted',
            itemId: null,
            balanceAfter: newBalance,
            createdAt: new Date().toISOString(),
          } satisfies TransactionRecord)

          return { reward: INVITE_ACCEPTED_REWARD }
        }
        return null
      })

      if (rewardResult) {
        stardustEarned = rewardResult.reward
      }
    } catch (rewardError) {
      logError('Invite accept reward failed (non-blocking)', rewardError)
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
          res.status(409).json({ error: 'Ya eres miembro de este cielo', skyId: inviteErr.skyId })
          return
        case 'membership_conflict':
          res.status(409).json({ error: 'No se puede completar la invitación. Contacta al propietario.' })
          return
      }
    }
    logError('Accept invite failed', error)
    res.status(500).json({ error: 'Error interno al aceptar la invitación' })
  }
}
