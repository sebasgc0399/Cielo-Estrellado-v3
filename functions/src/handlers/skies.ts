import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db, storage } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { SKY_TITLE_MAX_LENGTH } from '../domain/policies.js'
import { SHOP_CATALOG } from '../domain/shopCatalog.js'
import type { DocumentReference, QueryDocumentSnapshot } from '@google-cloud/firestore'
import type { SkyRecord, MemberRecord, MemberRole, SkyPersonalization, SkyDensity, InventoryItem } from '../domain/contracts.js'
import { DEFAULT_SKY_PERSONALIZATION } from '../domain/contracts.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'
import { logError } from '../logError.js'

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
    logError('getUserSkies failed', error)
    res.status(500).json({ error: 'Error interno al listar cielos' })
  }
}

export async function createSky(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const body = req.body as { title?: unknown }
    // No HTML sanitization — React escapes {text} in JSX by default.
    // Safe as long as these values are rendered as text content, not via
    // dangerouslySetInnerHTML or as href/src attributes.
    // See audits/05-validacion-inputs.md M1.
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
    if (!userSnap.exists) {
      res.status(404).json({ error: 'Usuario no encontrado. Intenta cerrar sesión y volver a entrar.' })
      return
    }
    const userData = userSnap.data()
    const maxSkies = typeof userData?.maxSkies === 'number' ? userData.maxSkies : DEFAULT_USER_ECONOMY.maxSkies

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
      themeId: null,
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
    logError('Sky creation failed', error)
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
      // No HTML sanitization — same rationale as createSky. See audits/05-validacion-inputs.md M1.
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
    logError('updateSky failed', error)
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
    logError('getSky failed', error)
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

    // Clean up media files from Storage (batched, best-effort)
    const MEDIA_DELETE_BATCH_SIZE = 10
    const mediaFilePaths: string[] = []
    for (const doc of starsSnap.docs) {
      const starData = doc.data()
      if (starData.mediaPath) mediaFilePaths.push(starData.mediaPath as string)
      if (starData.thumbnailPath) mediaFilePaths.push(starData.thumbnailPath as string)
      // Defensive: pre-migration docs may still have imagePath
      if (starData.imagePath && !starData.mediaPath) {
        mediaFilePaths.push(starData.imagePath as string)
      }
    }

    // Clean up temp files for this sky
    try {
      const [tempFiles] = await storage.bucket().getFiles({ prefix: `temp/${skyId}/` })
      for (const file of tempFiles) {
        mediaFilePaths.push(file.name)
      }
    } catch {
      console.warn(`Failed to list temp files for sky: ${skyId}`)
    }

    for (let i = 0; i < mediaFilePaths.length; i += MEDIA_DELETE_BATCH_SIZE) {
      const chunk = mediaFilePaths.slice(i, i + MEDIA_DELETE_BATCH_SIZE)
      await Promise.allSettled(
        chunk.map(path =>
          storage.bucket().file(path).delete().then(() => {}).catch(() => {
            console.warn(`Failed to delete storage file: ${path}`)
          })
        )
      )
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    logError('deleteSky failed', error)
    res.status(500).json({ error: 'Error interno al eliminar el cielo' })
  }
}

export async function updateSkyTheme(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const { skyId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)
    if (!access.ok) {
      res.status(access.reason === 'error' ? 500 : 404).json({ error: 'Cielo no encontrado' })
      return
    }

    if (access.member.role !== 'owner') {
      res.status(403).json({ error: 'Solo el propietario puede cambiar el tema' })
      return
    }

    const body = req.body as Record<string, unknown>
    const themeId = typeof body.themeId === 'string' ? body.themeId.trim() : ''
    if (!themeId) {
      res.status(400).json({ error: 'themeId es requerido' })
      return
    }

    const VALID_THEME_IDS = new Set([
      'classic',
      ...SHOP_CATALOG.filter((i): i is typeof i & { themeId: string } => i.category === 'theme' && !!i.themeId).map(i => i.themeId),
    ])

    if (!VALID_THEME_IDS.has(themeId)) {
      res.status(400).json({ error: 'Tema no reconocido' })
      return
    }

    if (themeId !== 'classic') {
      const inventorySnap = await db.collection('users').doc(decoded.uid).collection('inventory').get()
      const ownedItemIds = new Set(
        inventorySnap.docs.map((doc: QueryDocumentSnapshot) => (doc.data() as InventoryItem).itemId),
      )
      if (!ownedItemIds.has(`theme-${themeId}`)) {
        res.status(403).json({ error: 'No posees este tema' })
        return
      }
    }

    const now = new Date().toISOString()
    await db.collection('skies').doc(skyId).update({ themeId, updatedAt: now })

    res.status(200).json({ themeId })
  } catch (error) {
    logError('updateSkyTheme failed', error)
    res.status(500).json({ error: 'Error interno al cambiar el tema' })
  }
}
