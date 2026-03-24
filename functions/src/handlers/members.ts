import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import type { QueryDocumentSnapshot } from '@google-cloud/firestore'
import type { MemberRecord, MemberRole, UserRecord, IsoDateString } from '../domain/contracts.js'

export async function listMembers(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId } = req.routeParams

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

    const callerMember = memberDoc.data() as MemberRecord
    if (callerMember.status !== 'active' || callerMember.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede ver la lista de miembros' })
      return
    }

    // Inline getSkyMembers logic
    const membersSnap = await db
      .collection('skies')
      .doc(skyId)
      .collection('members')
      .where('status', '==', 'active')
      .get()

    if (membersSnap.empty) {
      res.status(200).json({ members: [] })
      return
    }

    const memberDocs = membersSnap.docs
    const userRefs = memberDocs.map((doc: QueryDocumentSnapshot) => db.collection('users').doc(doc.id))
    const userDocs = await db.getAll(...userRefs)

    const members: {
      userId: string
      role: MemberRole
      joinedAt: IsoDateString
      displayName: string
      email: string | null
      photoURL: string | null
    }[] = memberDocs.map((mDoc: QueryDocumentSnapshot, index: number) => {
      const member = mDoc.data() as MemberRecord
      const userDoc = userDocs[index]
      const user = userDoc.exists ? (userDoc.data() as UserRecord) : null

      return {
        userId: mDoc.id,
        role: member.role,
        joinedAt: member.joinedAt,
        displayName: user?.displayName ?? user?.email ?? `uid_${mDoc.id.slice(0, 6)}`,
        email: user?.email ?? null,
        photoURL: user?.photoURL ?? null,
      }
    })

    res.status(200).json({ members })
  } catch (error) {
    console.error('Members list failed:', error)
    res.status(500).json({ error: 'Error interno al listar miembros' })
  }
}

const VALID_ROLES: MemberRole[] = ['editor', 'viewer']

export async function updateMember(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const { skyId, userId } = req.routeParams

    // Verify caller is owner
    const callerDoc = await db
      .collection('skies').doc(skyId)
      .collection('members').doc(decoded.uid)
      .get()

    if (!callerDoc.exists) {
      res.status(403).json({ error: 'No tienes acceso a este cielo' })
      return
    }

    const caller = callerDoc.data() as MemberRecord
    if (caller.status !== 'active' || caller.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede gestionar miembros' })
      return
    }

    // Verify target exists and is active, not owner
    const targetRef = db
      .collection('skies').doc(skyId)
      .collection('members').doc(userId)

    const targetDoc = await targetRef.get()
    if (!targetDoc.exists) {
      res.status(404).json({ error: 'Miembro no encontrado' })
      return
    }

    const target = targetDoc.data() as MemberRecord
    if (target.status !== 'active') {
      res.status(400).json({ error: 'El miembro ya no está activo' })
      return
    }
    if (target.role === 'owner') {
      res.status(400).json({ error: 'No se puede modificar al propietario' })
      return
    }

    // Guard: prevent leaving sky with 0 owners
    // Currently owner role changes are blocked above, but this protects against future changes
    // and revoke operations on owner members
    const body = req.body as Record<string, unknown>
    const hasStatus = 'status' in body
    const hasRole = 'role' in body

    if (hasStatus && hasRole) {
      res.status(400).json({ error: 'No se puede cambiar status y rol a la vez' })
      return
    }

    if (hasStatus) {
      if (body.status !== 'revoked') {
        res.status(400).json({ error: 'Solo se permite status "revoked"' })
        return
      }
      await targetRef.update({ status: 'revoked' })
    } else if (hasRole) {
      if (!VALID_ROLES.includes(body.role as MemberRole)) {
        res.status(400).json({ error: 'Rol inválido. Debe ser "editor" o "viewer"' })
        return
      }
      await targetRef.update({ role: body.role as MemberRole })
    } else {
      res.status(400).json({ error: 'Se requiere "status" o "role" en el body' })
      return
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Update member failed:', error)
    res.status(500).json({ error: 'Error interno al actualizar miembro' })
  }
}

export async function leaveSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const { skyId } = req.routeParams

    const memberRef = db
      .collection('skies').doc(skyId)
      .collection('members').doc(decoded.uid)

    await db.runTransaction(async (transaction) => {
      const memberDoc = await transaction.get(memberRef)
      if (!memberDoc.exists) {
        throw Object.assign(new Error('No tienes acceso a este cielo'), { statusCode: 403 })
      }

      const member = memberDoc.data() as MemberRecord
      if (member.status !== 'active') {
        throw Object.assign(new Error('Ya no eres miembro activo de este cielo'), { statusCode: 400 })
      }
      if (member.role === 'owner') {
        throw Object.assign(new Error('El propietario no puede abandonar su propio cielo'), { statusCode: 400 })
      }

      transaction.update(memberRef, { status: 'revoked' })
    })

    res.status(200).json({ ok: true })
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    if (statusCode) {
      res.status(statusCode).json({ error: (error as Error).message })
      return
    }
    console.error('Leave sky failed:', error)
    res.status(500).json({ error: 'Error interno al abandonar el cielo' })
  }
}
