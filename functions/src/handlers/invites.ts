import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { createInvite } from '../lib/createInvite.js'
import { revokeInvite, RevokeError } from '../lib/revokeInvite.js'
import type { MemberRecord, InviteRecord, InviteRole, IsoDateString } from '../domain/contracts.js'

async function requireOwner(skyId: string, uid: string): Promise<MemberRecord | null> {
  const memberDoc = await db
    .collection('skies')
    .doc(skyId)
    .collection('members')
    .doc(uid)
    .get()
  if (!memberDoc.exists) return null
  const member = memberDoc.data() as MemberRecord
  if (member.status !== 'active' || member.role !== 'owner') return null
  return member
}

export async function createInviteHandler(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId } = req.routeParams

    const member = await requireOwner(skyId, decoded.uid)
    if (!member) {
      res.status(403).json({ error: 'Solo el propietario puede crear invitaciones' })
      return
    }

    const appUrl = process.env.APP_URL?.trim()
    if (!appUrl) {
      res.status(500).json({ error: 'APP_URL no configurado' })
      return
    }

    const body = req.body as { role?: unknown } | undefined
    if (body?.role !== undefined && body.role !== 'editor' && body.role !== 'viewer') {
      res.status(400).json({ error: 'Rol debe ser "editor" o "viewer"' })
      return
    }
    const role: InviteRole = body?.role === 'viewer' ? 'viewer' : 'editor'

    const { token } = await createInvite(skyId, role, decoded.uid)
    const inviteUrl = `${appUrl}/invite/${token}`

    res.status(201).json({ inviteUrl })
  } catch (error) {
    console.error('Invite creation failed:', error)
    res.status(500).json({ error: 'Error interno al crear la invitación' })
  }
}

export async function listInvites(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId } = req.routeParams

    const member = await requireOwner(skyId, decoded.uid)
    if (!member) {
      res.status(403).json({ error: 'Solo el propietario puede ver las invitaciones' })
      return
    }

    // Inline getSkyPendingInvites logic
    const now = new Date()
    const snap = await db
      .collection('invites')
      .where('skyId', '==', skyId)
      .where('status', '==', 'pending')
      .orderBy('expiresAt', 'asc')
      .get()

    const invites: { inviteId: string; role: InviteRole; expiresAt: IsoDateString }[] = []

    if (!snap.empty) {
      for (const doc of snap.docs) {
        const invite = doc.data() as InviteRecord
        if (new Date(invite.expiresAt) > now) {
          invites.push({
            inviteId: doc.id,
            role: invite.role,
            expiresAt: invite.expiresAt,
          })
        }
      }
    }

    res.status(200).json({ invites })
  } catch (error) {
    console.error('Invite list failed:', error)
    res.status(500).json({ error: 'Error interno al listar invitaciones' })
  }
}

export async function revokeInviteHandler(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId, inviteId } = req.routeParams

    const memberDoc = await db
      .collection('skies')
      .doc(skyId)
      .collection('members')
      .doc(decoded.uid)
      .get()

    if (!memberDoc.exists) {
      res.status(403).json({ error: 'No tienes acceso a este cielo' })
      return
    }

    const member = memberDoc.data() as MemberRecord
    if (member.status !== 'active' || member.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede revocar invitaciones' })
      return
    }

    await revokeInvite(inviteId, skyId)
    res.status(200).json({ ok: true })
  } catch (error: unknown) {
    const revokeErr = error as { code?: string }
    if (error instanceof RevokeError) {
      if (revokeErr.code === 'invite_not_found') {
        res.status(404).json({ error: 'Invitación no encontrada' })
        return
      }
      if (revokeErr.code === 'invite_already_used') {
        res.status(409).json({ error: 'Esta invitación ya fue utilizada' })
        return
      }
      if (revokeErr.code === 'invite_already_revoked') {
        res.status(409).json({ error: 'Esta invitación ya fue revocada' })
        return
      }
      if (revokeErr.code === 'invite_expired') {
        res.status(409).json({ error: 'Esta invitación ya expiró' })
        return
      }
    }
    console.error('Revoke invite failed:', error)
    res.status(500).json({ error: 'Error interno al revocar la invitación' })
  }
}
