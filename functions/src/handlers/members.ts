import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
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
    const userRefs = memberDocs.map(doc => db.collection('users').doc(doc.id))
    const userDocs = await db.getAll(...userRefs)

    const members: {
      userId: string
      role: MemberRole
      joinedAt: IsoDateString
      displayName: string
      email: string | null
      photoURL: string | null
    }[] = memberDocs.map((mDoc, index) => {
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
