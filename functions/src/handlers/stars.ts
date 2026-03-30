import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db, storage } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { STAR_TITLE_MAX_LENGTH, STAR_MESSAGE_MAX_LENGTH } from '../domain/policies.js'
import type { StarRecord, TransactionRecord } from '../domain/contracts.js'
import { STAR_CREATION_REWARD, FIRST_STAR_BONUS, MAX_STARS_REWARD_PER_DAY } from '../domain/economyRules.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'
import { logError } from '../logError.js'

function validateCoordinates(body: {
  xNormalized?: unknown
  yNormalized?: unknown
}): { ok: true; x: number | null; y: number | null } | { ok: false; error: string } {
  const hasX = body.xNormalized !== undefined
  const hasY = body.yNormalized !== undefined

  if (!hasX && !hasY) {
    return { ok: true, x: null, y: null }
  }

  if (!hasX || !hasY) {
    return { ok: false, error: 'Ambas coordenadas son obligatorias si se proporciona una' }
  }

  if (body.xNormalized === null && body.yNormalized === null) {
    return { ok: true, x: null, y: null }
  }

  if (typeof body.xNormalized !== 'number' || typeof body.yNormalized !== 'number') {
    return { ok: false, error: 'Las coordenadas deben ser números' }
  }

  if (!Number.isFinite(body.xNormalized) || !Number.isFinite(body.yNormalized)) {
    return { ok: false, error: 'Las coordenadas deben ser números finitos' }
  }

  if (body.xNormalized < 0 || body.xNormalized > 1 || body.yNormalized < 0 || body.yNormalized > 1) {
    return { ok: false, error: 'Las coordenadas deben estar entre 0 y 1' }
  }

  return { ok: true, x: body.xNormalized, y: body.yNormalized }
}

export async function createStar(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId } = req.routeParams

    const body = req.body as {
      title?: unknown
      message?: unknown
      xNormalized?: unknown
      yNormalized?: unknown
      year?: unknown
    }

    // No HTML sanitization — React escapes {text} in JSX by default.
    // Safe as long as these values are rendered as text content, not via
    // dangerouslySetInnerHTML or as href/src attributes.
    // See audits/05-validacion-inputs.md M1.
    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!rawTitle) {
      res.status(400).json({ error: 'El título es obligatorio' })
      return
    }
    if (rawTitle.length > STAR_TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `El título no puede superar ${STAR_TITLE_MAX_LENGTH} caracteres` })
      return
    }

    // No HTML sanitization — same rationale as rawTitle above. See audits/05-validacion-inputs.md M1.
    const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
    if (rawMessage.length > STAR_MESSAGE_MAX_LENGTH) {
      res.status(400).json({ error: `El mensaje no puede superar ${STAR_MESSAGE_MAX_LENGTH} caracteres` })
      return
    }

    const coords = validateCoordinates(body)
    if (!coords.ok) {
      res.status(400).json({ error: coords.error })
      return
    }

    const access = await getSkyWithAccess(skyId, decoded.uid)

    if (!access.ok) {
      if (access.reason === 'error') {
        res.status(500).json({ error: 'Error interno al verificar acceso' })
        return
      }
      res.status(404).json({ error: 'Cielo no encontrado' })
      return
    }

    if (access.member.role !== 'owner' && access.member.role !== 'editor') {
      res.status(403).json({ error: 'No tienes permisos para crear estrellas en este cielo' })
      return
    }

    const now = new Date().toISOString()
    const starRef = db.collection('skies').doc(skyId).collection('stars').doc()

    const year = typeof body.year === 'number' && Number.isFinite(body.year) ? body.year : null

    const starData: StarRecord = {
      title: rawTitle,
      message: rawMessage || null,
      mediaType: null,
      mediaStatus: null,
      mediaPath: null,
      thumbnailPath: null,
      mediaDuration: null,
      xNormalized: coords.x,
      yNormalized: coords.y,
      year,
      authorUserId: decoded.uid,
      updatedByUserId: decoded.uid,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      deletedByUserId: null,
    }

    await starRef.set(starData)

    const userRef = db.collection('users').doc(decoded.uid)
    let stardustEarned = 0
    try {
      const rewardResult = await db.runTransaction(async (transaction) => {
        const userSnap = await transaction.get(userRef)
        const userData = userSnap.data()
        if (!userData) return null

        // isFirstStar DENTRO de la transaccion — previene race condition
        const existingStarsSnap = await transaction.get(
          db.collection('skies').doc(skyId).collection('stars')
            .where('authorUserId', '==', decoded.uid)
            .where('deletedAt', '==', null)
            .limit(1)
        )
        const isFirstStar = existingStarsSnap.empty

        const todayUTC = new Date().toISOString().slice(0, 10)
        let createdStarsToday = typeof userData.createdStarsToday === 'number' ? userData.createdStarsToday : DEFAULT_USER_ECONOMY.createdStarsToday
        const lastStarCreationDate = typeof userData.lastStarCreationDate === 'string' ? userData.lastStarCreationDate : DEFAULT_USER_ECONOMY.lastStarCreationDate
        const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : DEFAULT_USER_ECONOMY.stardust

        if (lastStarCreationDate !== todayUTC) {
          createdStarsToday = 0
        }

        let creationReward = 0
        if (createdStarsToday < MAX_STARS_REWARD_PER_DAY) {
          creationReward = STAR_CREATION_REWARD
          createdStarsToday += 1
        }

        let firstStarReward = 0
        if (isFirstStar) {
          firstStarReward = FIRST_STAR_BONUS
        }

        const totalReward = creationReward + firstStarReward
        if (totalReward === 0) return null

        const newBalance = currentStardust + totalReward
        transaction.update(userRef, {
          stardust: newBalance,
          createdStarsToday,
          lastStarCreationDate: todayUTC,
        })

        // Audit logs DENTRO de la transaccion
        const txNow = new Date().toISOString()
        if (creationReward > 0) {
          const txDocRef = userRef.collection('transactions').doc()
          transaction.set(txDocRef, {
            type: 'earn', amount: creationReward, reason: 'star_creation',
            itemId: null, balanceAfter: currentStardust + creationReward, createdAt: txNow,
          } satisfies TransactionRecord)
        }
        if (firstStarReward > 0) {
          const txDocRef = userRef.collection('transactions').doc()
          transaction.set(txDocRef, {
            type: 'earn', amount: firstStarReward, reason: 'first_star_bonus',
            itemId: null, balanceAfter: newBalance, createdAt: txNow,
          } satisfies TransactionRecord)
        }

        return { totalReward }
      })

      if (rewardResult) {
        stardustEarned = rewardResult.totalReward
      }
    } catch (rewardError) {
      logError('Star creation reward failed (non-blocking)', rewardError)
    }

    res.status(201).json({ starId: starRef.id, rewards: { stardustEarned } })
  } catch (error) {
    logError('Star creation failed', error)
    res.status(500).json({ error: 'Error interno al crear la estrella' })
  }
}

export async function updateStar(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId, starId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)

    if (!access.ok) {
      if (access.reason === 'error') {
        res.status(500).json({ error: 'Error interno al verificar acceso' })
        return
      }
      res.status(404).json({ error: 'Cielo no encontrado' })
      return
    }

    const starRef = db.collection('skies').doc(skyId).collection('stars').doc(starId)
    const starSnap = await starRef.get()

    if (!starSnap.exists) {
      res.status(404).json({ error: 'Estrella no encontrada' })
      return
    }

    const star = starSnap.data() as StarRecord
    if (star.deletedAt !== null) {
      res.status(404).json({ error: 'Estrella no encontrada' })
      return
    }

    const { role } = access.member
    const canEdit = role === 'owner' || (role === 'editor' && star.authorUserId === decoded.uid)
    if (!canEdit) {
      res.status(403).json({ error: 'No tienes permisos para editar esta estrella' })
      return
    }

    // year is intentionally excluded — immutable after creation. See audits/05-validacion-inputs.md B2.
    const body = req.body as {
      title?: unknown
      message?: unknown
      xNormalized?: unknown
      yNormalized?: unknown
      mediaPath?: unknown
      mediaStatus?: unknown
    }

    // mediaStatus transition — exclusive operation (§5.5)
    if ('mediaStatus' in body) {
      const otherFields = ['title', 'message', 'xNormalized', 'yNormalized', 'mediaPath']
      const hasOtherFields = otherFields.some(f => f in body)
      if (hasOtherFields) {
        res.status(400).json({ error: 'mediaStatus debe enviarse solo, sin otros campos' })
        return
      }

      const requested = body.mediaStatus
      const current = star.mediaStatus ?? null

      const allowed =
        (current === null && requested === 'processing') ||
        (current === 'processing' && requested === null) ||
        (current === 'error' && requested === null)

      if (!allowed) {
        res.status(400).json({ error: 'Transición de mediaStatus no permitida' })
        return
      }

      const now = new Date().toISOString()
      await starRef.update({
        mediaStatus: requested,
        updatedAt: now,
        updatedByUserId: decoded.uid,
      })
      res.status(200).json({ ok: true })
      return
    }

    // No HTML sanitization — React escapes {text} in JSX by default.
    // Safe as long as these values are rendered as text content, not via
    // dangerouslySetInnerHTML or as href/src attributes.
    // See audits/05-validacion-inputs.md M1.
    const titleProvided = 'title' in body
    const rawTitle = titleProvided
      ? (typeof body.title === 'string' ? body.title.trim() : '')
      : star.title
    if (!rawTitle) {
      res.status(400).json({ error: 'El título es obligatorio' })
      return
    }
    if (rawTitle.length > STAR_TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `El título no puede superar ${STAR_TITLE_MAX_LENGTH} caracteres` })
      return
    }

    // No HTML sanitization — same rationale as rawTitle above. See audits/05-validacion-inputs.md M1.
    const messageProvided = 'message' in body
    const rawMessage = messageProvided
      ? (typeof body.message === 'string' ? body.message.trim() : '')
      : (star.message ?? '')
    if (rawMessage.length > STAR_MESSAGE_MAX_LENGTH) {
      res.status(400).json({ error: `El mensaje no puede superar ${STAR_MESSAGE_MAX_LENGTH} caracteres` })
      return
    }
    const newMessage = rawMessage || null

    const coordsProvided = 'xNormalized' in body || 'yNormalized' in body
    let parsedX: number | null = star.xNormalized
    let parsedY: number | null = star.yNormalized

    if (coordsProvided) {
      const hasX = 'xNormalized' in body
      const hasY = 'yNormalized' in body
      if (!hasX || !hasY) {
        res.status(400).json({ error: 'Ambas coordenadas son obligatorias si se proporciona una' })
        return
      }
      if (body.xNormalized === null && body.yNormalized === null) {
        parsedX = null
        parsedY = null
      } else {
        if (typeof body.xNormalized !== 'number' || typeof body.yNormalized !== 'number') {
          res.status(400).json({ error: 'Las coordenadas deben ser números' })
          return
        }
        if (!Number.isFinite(body.xNormalized) || !Number.isFinite(body.yNormalized)) {
          res.status(400).json({ error: 'Las coordenadas deben ser números finitos' })
          return
        }
        if (body.xNormalized < 0 || body.xNormalized > 1 || body.yNormalized < 0 || body.yNormalized > 1) {
          res.status(400).json({ error: 'Las coordenadas deben estar entre 0 y 1' })
          return
        }
        parsedX = body.xNormalized
        parsedY = body.yNormalized
      }
    }

    // mediaPath — attach-only
    let newMediaPath: string | null | undefined = undefined
    let newMediaType: string | null | undefined = undefined
    if ('mediaPath' in body) {
      if (body.mediaPath === null) {
        newMediaPath = null
        newMediaType = null
      } else if (typeof body.mediaPath === 'string') {
        const canonicalPath = `stars/${skyId}/${starId}/image`
        if (body.mediaPath !== canonicalPath) {
          res.status(400).json({ error: 'mediaPath no válido' })
          return
        }
        if (star.mediaPath !== null) {
          res.status(409).json({ error: 'La estrella ya tiene media' })
          return
        }
        newMediaPath = body.mediaPath
        newMediaType = 'image'
      } else {
        res.status(400).json({ error: 'mediaPath debe ser una cadena o null' })
        return
      }
    }

    // Early return if nothing changed
    const mediaPathChanged = newMediaPath !== undefined && newMediaPath !== star.mediaPath
    if (
      rawTitle === star.title &&
      newMessage === star.message &&
      parsedX === star.xNormalized &&
      parsedY === star.yNormalized &&
      !mediaPathChanged
    ) {
      res.status(200).json({ ok: true })
      return
    }

    const now = new Date().toISOString()
    const updatePayload: Record<string, unknown> = {
      title: rawTitle,
      message: newMessage,
      xNormalized: parsedX,
      yNormalized: parsedY,
      updatedAt: now,
      updatedByUserId: decoded.uid,
    }

    if (newMediaPath !== undefined) {
      updatePayload.mediaPath = newMediaPath
      updatePayload.mediaType = newMediaType
      if (newMediaPath === null) {
        updatePayload.mediaStatus = null
        updatePayload.thumbnailPath = null
        updatePayload.mediaDuration = null
      }
    }

    await starRef.update(updatePayload)

    res.status(200).json({ ok: true })
  } catch (error) {
    logError('Star update failed', error)
    res.status(500).json({ error: 'Error interno al actualizar la estrella' })
  }
}

export async function deleteStar(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)

    const { skyId, starId } = req.routeParams

    const access = await getSkyWithAccess(skyId, decoded.uid)

    if (!access.ok) {
      if (access.reason === 'error') {
        res.status(500).json({ error: 'Error interno al verificar acceso' })
        return
      }
      res.status(404).json({ error: 'Cielo no encontrado' })
      return
    }

    const starRef = db.collection('skies').doc(skyId).collection('stars').doc(starId)
    const starSnap = await starRef.get()

    if (!starSnap.exists) {
      res.status(404).json({ error: 'Estrella no encontrada' })
      return
    }

    const star = starSnap.data() as StarRecord
    if (star.deletedAt !== null) {
      res.status(404).json({ error: 'Estrella no encontrada' })
      return
    }

    const { role } = access.member
    const canDelete = role === 'owner' || (role === 'editor' && star.authorUserId === decoded.uid)
    if (!canDelete) {
      res.status(403).json({ error: 'No tienes permisos para eliminar esta estrella' })
      return
    }

    const now = new Date().toISOString()
    await starRef.update({
      deletedAt: now,
      deletedByUserId: decoded.uid,
    })

    // DECISION: hard-delete media en soft-delete de star.
    // El media es inaccesible tras soft-delete (storage rules verifican deletedAt == null).
    // Si se implementa restore, considerar mover a path "trash/" en vez de eliminar.
    // Ver audits/09-storage-uploads.md B1.
    const mediaPath = star.mediaPath ?? (star as unknown as Record<string, unknown>).imagePath as string | null
    const filesToDelete: string[] = []
    if (mediaPath) filesToDelete.push(mediaPath)
    if (star.thumbnailPath) filesToDelete.push(star.thumbnailPath)
    filesToDelete.push(`temp/${skyId}/${starId}/raw`)

    for (const filePath of filesToDelete) {
      try {
        await storage.bucket().file(filePath).delete()
      } catch {
        console.warn(`Failed to delete storage file: ${filePath}`)
      }
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    logError('Star delete failed', error)
    res.status(500).json({ error: 'Error interno al eliminar la estrella' })
  }
}
