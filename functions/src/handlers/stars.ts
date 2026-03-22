import { onRequest } from 'firebase-functions/v2/https'
import { handleCors } from '../middleware/cors.js'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { getSkyWithAccess } from '../lib/getSkyWithAccess.js'
import { STAR_TITLE_MAX_LENGTH, STAR_MESSAGE_MAX_LENGTH } from '../domain/policies.js'
import type { StarRecord } from '../domain/contracts.js'

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

export const createStar = onRequest(async (req, res) => {
  if (handleCors(req, res)) return

  try {
    const decoded = await authenticateRequest(req)

    // Extract skyId from path: /{skyId}
    const segments = req.path.split('/').filter(Boolean)
    const skyId = segments[0]

    if (!skyId) {
      res.status(400).json({ error: 'skyId es obligatorio' })
      return
    }

    const body = req.body as {
      title?: unknown
      message?: unknown
      xNormalized?: unknown
      yNormalized?: unknown
      year?: unknown
    }

    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!rawTitle) {
      res.status(400).json({ error: 'El título es obligatorio' })
      return
    }
    if (rawTitle.length > STAR_TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `El título no puede superar ${STAR_TITLE_MAX_LENGTH} caracteres` })
      return
    }

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
      imagePath: null,
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

    res.status(201).json({ starId: starRef.id })
  } catch (error) {
    console.error('Star creation failed:', error)
    res.status(500).json({ error: 'Error interno al crear la estrella' })
  }
})

export const updateStar = onRequest(async (req, res) => {
  if (handleCors(req, res)) return

  try {
    const decoded = await authenticateRequest(req)

    // Extract skyId and starId from path: /{skyId}/{starId}
    const segments = req.path.split('/').filter(Boolean)
    const skyId = segments[0]
    const starId = segments[1]

    if (!skyId || !starId) {
      res.status(400).json({ error: 'skyId y starId son obligatorios' })
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

    const body = req.body as {
      title?: unknown
      message?: unknown
      xNormalized?: unknown
      yNormalized?: unknown
      imagePath?: unknown
    }

    const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
    if (!rawTitle) {
      res.status(400).json({ error: 'El título es obligatorio' })
      return
    }
    if (rawTitle.length > STAR_TITLE_MAX_LENGTH) {
      res.status(400).json({ error: `El título no puede superar ${STAR_TITLE_MAX_LENGTH} caracteres` })
      return
    }

    const rawMessage = typeof body.message === 'string' ? body.message.trim() : ''
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

    // imagePath — attach-only
    let newImagePath: string | null | undefined = undefined
    if ('imagePath' in body) {
      if (body.imagePath === null) {
        newImagePath = null
      } else if (typeof body.imagePath === 'string') {
        const canonicalPath = `stars/${skyId}/${starId}/image`
        if (body.imagePath !== canonicalPath) {
          res.status(400).json({ error: 'imagePath no válido' })
          return
        }
        if (star.imagePath !== null) {
          res.status(409).json({ error: 'La estrella ya tiene una imagen' })
          return
        }
        newImagePath = body.imagePath
      } else {
        res.status(400).json({ error: 'imagePath debe ser una cadena o null' })
        return
      }
    }

    // Early return if nothing changed
    const imagePathChanged = newImagePath !== undefined && newImagePath !== star.imagePath
    if (
      rawTitle === star.title &&
      newMessage === star.message &&
      parsedX === star.xNormalized &&
      parsedY === star.yNormalized &&
      !imagePathChanged
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

    if (newImagePath !== undefined) {
      updatePayload.imagePath = newImagePath
    }

    await starRef.update(updatePayload)

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Star update failed:', error)
    res.status(500).json({ error: 'Error interno al actualizar la estrella' })
  }
})

export const deleteStar = onRequest(async (req, res) => {
  if (handleCors(req, res)) return

  try {
    const decoded = await authenticateRequest(req)

    // Extract skyId and starId from path: /{skyId}/{starId}
    const segments = req.path.split('/').filter(Boolean)
    const skyId = segments[0]
    const starId = segments[1]

    if (!skyId || !starId) {
      res.status(400).json({ error: 'skyId y starId son obligatorios' })
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

    res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Star delete failed:', error)
    res.status(500).json({ error: 'Error interno al eliminar la estrella' })
  }
})
