import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { SKY_TITLE_MAX_LENGTH } from '../domain/policies.js'
import type { DocumentReference } from '@google-cloud/firestore'
import type { SkyRecord, MemberRecord, MemberRole, SkyPersonalization, SkyDensity } from '../domain/contracts.js'
import { DEFAULT_SKY_PERSONALIZATION } from '../domain/contracts.js'

const VALID_DENSITIES: SkyDensity[] = ['low', 'medium', 'high']
const PERSONALIZATION_KEYS = ['density', 'nebulaEnabled', 'twinkleEnabled', 'shootingStarsEnabled'] as const

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
    const skyRefs: DocumentReference[] = []

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

    const userSnap = await db.collection('users').doc(decoded.uid).get()
    const userData = userSnap.data()
    const maxSkies = typeof userData?.maxSkies === 'number' ? userData.maxSkies : 2

    const ownerSnap = await db.collectionGroup('members')
      .where('userId', '==', decoded.uid)
      .where('role', '==', 'owner')
      .where('status', '==', 'active')
      .get()

    if (ownerSnap.size >= maxSkies) {
      res.status(403).json({
        error: 'Has alcanzado el límite de cielos',
        maxSkies,
        currentCount: ownerSnap.size,
      })
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

export async function updateSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const { skyId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)
    if (!access.ok) {
      res.status(access.reason === 'error' ? 500 : 404).json({ error: 'Cielo no encontrado' })
      return
    }

    if (access.member.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede modificar el cielo' })
      return
    }

    const body = req.body as { title?: unknown; personalization?: Record<string, unknown> }

    const hasTitle = 'title' in body
    const hasPersonalization = body.personalization && typeof body.personalization === 'object'

    if (!hasTitle && !hasPersonalization) {
      res.status(400).json({ error: 'Se requiere al menos title o personalization' })
      return
    }

    const updateData: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    }

    if (hasTitle) {
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
      if (!rawTitle) {
        res.status(400).json({ error: 'El título no puede estar vacío' })
        return
      }
      if (rawTitle.length > SKY_TITLE_MAX_LENGTH) {
        res.status(400).json({ error: `El título no puede superar ${SKY_TITLE_MAX_LENGTH} caracteres` })
        return
      }
      updateData.title = rawTitle
    }

    if (hasPersonalization) {
      const incoming = body.personalization!
      const unknownKeys = Object.keys(incoming).filter(
        k => !(PERSONALIZATION_KEYS as readonly string[]).includes(k),
      )
      if (unknownKeys.length > 0) {
        res.status(400).json({ error: `Campos no permitidos: ${unknownKeys.join(', ')}` })
        return
      }

      if ('density' in incoming && (typeof incoming.density !== 'string' || !VALID_DENSITIES.includes(incoming.density as SkyDensity))) {
        res.status(400).json({ error: 'Densidad inválida' })
        return
      }
      for (const key of ['nebulaEnabled', 'twinkleEnabled', 'shootingStarsEnabled'] as const) {
        if (key in incoming && typeof incoming[key] !== 'boolean') {
          res.status(400).json({ error: `${key} debe ser booleano` })
          return
        }
      }

      updateData.personalization = {
        ...access.sky.personalization,
        ...incoming as Partial<SkyPersonalization>,
      }
    }

    await db.collection('skies').doc(skyId).update(updateData)

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('updateSky failed:', error)
    res.status(500).json({ error: 'Error interno al actualizar el cielo' })
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

const BATCH_LIMIT = 500

export async function deleteSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const { skyId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)
    if (!access.ok) {
      res.status(access.reason === 'error' ? 500 : 404).json({ error: 'Cielo no encontrado' })
      return
    }

    if (access.member.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede eliminar el cielo' })
      return
    }

    const skyRef = db.collection('skies').doc(skyId)

    // Collect all docs to delete/update
    const [starsSnap, membersSnap, invitesSnap] = await Promise.all([
      skyRef.collection('stars').get(),
      skyRef.collection('members').get(),
      db.collection('invites')
        .where('skyId', '==', skyId)
        .where('status', '==', 'pending')
        .get(),
    ])

    // Process in batches of 500 (Firestore limit)
    const allOps: Array<{ type: 'delete'; ref: DocumentReference } | { type: 'update'; ref: DocumentReference; data: Record<string, unknown> }> = []

    for (const doc of starsSnap.docs) {
      allOps.push({ type: 'delete', ref: doc.ref })
    }
    for (const doc of membersSnap.docs) {
      allOps.push({ type: 'delete', ref: doc.ref })
    }
    for (const doc of invitesSnap.docs) {
      allOps.push({ type: 'update', ref: doc.ref, data: { status: 'revoked' } })
    }
    // Delete the sky doc itself last
    allOps.push({ type: 'delete', ref: skyRef })

    for (let i = 0; i < allOps.length; i += BATCH_LIMIT) {
      const batch = db.batch()
      const chunk = allOps.slice(i, i + BATCH_LIMIT)
      for (const op of chunk) {
        if (op.type === 'delete') {
          batch.delete(op.ref)
        } else {
          batch.update(op.ref, op.data)
        }
      }
      await batch.commit()
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('deleteSky failed:', error)
    res.status(500).json({ error: 'Error interno al eliminar el cielo' })
  }
}
