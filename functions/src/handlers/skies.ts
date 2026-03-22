import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { SKY_TITLE_MAX_LENGTH } from '../domain/policies.js'
import type { SkyRecord, MemberRecord, MemberRole } from '../domain/contracts.js'
import { DEFAULT_SKY_PERSONALIZATION } from '../domain/contracts.js'

export async function getUserSkies(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const membersSnap = await db
      .collectionGroup('members')
      .where('userId', '==', decoded.uid)
      .where('status', '==', 'active')
      .get()

    if (membersSnap.empty) {
      res.status(200).json({ skies: [] })
      return
    }

    const entries: { skyId: string; role: MemberRole }[] = []
    const skyRefs: FirebaseFirestore.DocumentReference[] = []

    for (const doc of membersSnap.docs) {
      const member = doc.data() as MemberRecord
      const skyRef = doc.ref.parent.parent
      if (!skyRef) continue
      entries.push({ skyId: skyRef.id, role: member.role })
      skyRefs.push(skyRef)
    }

    if (skyRefs.length === 0) {
      res.status(200).json({ skies: [] })
      return
    }

    const skySnaps = await db.getAll(...skyRefs)

    const skies: { skyId: string; sky: SkyRecord; role: MemberRole }[] = []
    for (let i = 0; i < skySnaps.length; i++) {
      const snap = skySnaps[i]
      if (!snap.exists) continue
      skies.push({
        skyId: entries[i].skyId,
        sky: snap.data() as SkyRecord,
        role: entries[i].role,
      })
    }

    skies.sort((a, b) => b.sky.createdAt.localeCompare(a.sky.createdAt))

    res.status(200).json({ skies })
  } catch (error) {
    console.error('getUserSkies failed:', error)
    res.status(500).json({ error: 'Error interno al listar cielos' })
  }
}

export async function createSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const body = req.body as { title?: unknown }
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''

    if (!rawTitle) {
      res.status(400).json({ error: 'El título es obligatorio' })
      return
    }

    if (rawTitle.length > SKY_TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `El título no puede superar ${SKY_TITLE_MAX_LENGTH} caracteres` })
      return
    }

    const now = new Date().toISOString()
    const skyRef = db.collection('skies').doc()

    const skyData: SkyRecord = {
      title: rawTitle,
      description: null,
      ownerUserId: decoded.uid,
      privacy: 'private',
      coverImagePath: null,
      personalization: DEFAULT_SKY_PERSONALIZATION,
      createdAt: now,
      updatedAt: now,
    }

    const memberData: MemberRecord = {
      userId: decoded.uid,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: now,
    }

    const batch = db.batch()
    batch.set(skyRef, skyData)
    batch.set(skyRef.collection('members').doc(decoded.uid), memberData)
    await batch.commit()

    res.status(201).json({ skyId: skyRef.id })
  } catch (error) {
    console.error('Sky creation failed:', error)
    res.status(500).json({ error: 'Error interno al crear el cielo' })
  }
}

export async function getSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)

    if (!access.ok) {
      if (access.reason === 'error') {
        res.status(500).json({ error: 'Error interno al verificar acceso' })
        return
      }
      res.status(404).json({ error: 'Cielo no encontrado' })
      return
    }

    res.status(200).json({
      sky: access.sky,
      member: { role: access.member.role, status: access.member.status },
    })
  } catch (error) {
    console.error('getSky failed:', error)
    res.status(500).json({ error: 'Error interno al obtener el cielo' })
  }
}
