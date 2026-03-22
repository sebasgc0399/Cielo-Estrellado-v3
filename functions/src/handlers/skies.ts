import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { SKY_TITLE_MAX_LENGTH } from '../domain/policies.js'
import type { SkyRecord, MemberRecord, MemberRole, SkyPersonalization, SkyTheme, SkyDensity } from '../domain/contracts.js'
import { DEFAULT_SKY_PERSONALIZATION } from '../domain/contracts.js'

const VALID_THEMES: SkyTheme[] = ['classic', 'romantic', 'deep-night']
const VALID_DENSITIES: SkyDensity[] = ['low', 'medium', 'high']
const PERSONALIZATION_KEYS = ['theme', 'density', 'nebulaEnabled', 'twinkleEnabled', 'shootingStarsEnabled'] as const

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

    const body = req.body as { personalization?: Record<string, unknown> }
    if (!body.personalization || typeof body.personalization !== 'object') {
      res.status(400).json({ error: 'Se requiere el campo personalization' })
      return
    }

    const incoming = body.personalization
    const unknownKeys = Object.keys(incoming).filter(
      k => !(PERSONALIZATION_KEYS as readonly string[]).includes(k),
    )
    if (unknownKeys.length > 0) {
      res.status(400).json({ error: `Campos no permitidos: ${unknownKeys.join(', ')}` })
      return
    }

    if ('theme' in incoming && (typeof incoming.theme !== 'string' || !VALID_THEMES.includes(incoming.theme as SkyTheme))) {
      res.status(400).json({ error: 'Tema inválido' })
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

    const merged: SkyPersonalization = {
      ...access.sky.personalization,
      ...incoming as Partial<SkyPersonalization>,
    }

    await db.collection('skies').doc(skyId).update({
      personalization: merged,
      updatedAt: new Date().toISOString(),
    })

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
