import { onObjectFinalized } from 'firebase-functions/v2/storage'
import type { StorageEvent } from 'firebase-functions/v2/storage'
import { stat, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runFfmpeg } from '../lib/ffmpeg.js'
import { db, storage } from '../lib/firebaseAdmin.js'
import { logError } from '../logError.js'
import {
  VIDEO_RAW_MAX_SIZE_BYTES,
  VIDEO_FINAL_MAX_SIZE_BYTES,
  VIDEO_MAX_PROCESSED_PER_DAY,
} from '../domain/policies.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'
import type { StarRecord, UserRecord } from '../domain/contracts.js'

// --- Phase A: path filter & metadata validation ---

export async function handleVideoProcessing(event: StorageEvent): Promise<void> {
  const filePath = event.data.name
  if (!filePath || !filePath.startsWith('temp/')) return

  const parts = filePath.split('/')
  if (parts.length !== 4 || parts[3] !== 'raw') return

  const pathSkyId = parts[1]
  const pathStarId = parts[2]

  const metadata = event.data.metadata
  if (!metadata?.skyId || !metadata?.starId || !metadata?.userId ||
      metadata.trimStart === undefined || metadata.trimEnd === undefined) {
    await safeDeleteFile(filePath)
    return
  }

  const { skyId, starId, userId } = metadata
  const trimStart = parseFloat(metadata.trimStart)
  const trimEnd = parseFloat(metadata.trimEnd)

  if (skyId !== pathSkyId || starId !== pathStarId) {
    await safeDeleteFile(filePath)
    return
  }

  if (isNaN(trimStart) || isNaN(trimEnd) || trimEnd <= trimStart) {
    await safeDeleteFile(filePath)
    return
  }

  // --- Phase B: Firestore validation ---

  const starRef = db.collection('skies').doc(skyId).collection('stars').doc(starId)
  const starSnap = await starRef.get()
  const star = starSnap.data() as StarRecord | undefined

  if (!star || star.deletedAt !== null || star.mediaStatus !== 'processing') {
    console.warn(`processVideoClip: star ${skyId}/${starId} not in valid state, aborting`)
    await safeDeleteFile(filePath)
    return
  }

  if (star.authorUserId !== userId) {
    console.warn(`processVideoClip: userId mismatch for ${skyId}/${starId}`)
    await safeDeleteFile(filePath)
    return
  }

  // Rate limit check
  const userRef = db.collection('users').doc(userId)
  const userSnap = await userRef.get()
  const userData = userSnap.data() as UserRecord | undefined

  if (!userData) {
    await handleProcessingError(skyId, starId, filePath, new Error('User not found'))
    return
  }

  const todayUTC = new Date().toISOString().slice(0, 10)
  let videoProcessedToday = typeof userData.videoProcessedToday === 'number'
    ? userData.videoProcessedToday : DEFAULT_USER_ECONOMY.videoProcessedToday
  if (userData.lastVideoProcessDate !== todayUTC) {
    videoProcessedToday = 0
  }

  if (videoProcessedToday >= VIDEO_MAX_PROCESSED_PER_DAY) {
    console.warn(`processVideoClip: rate limit exceeded for user ${userId}`)
    await starRef.update({ mediaStatus: 'error', updatedAt: new Date().toISOString() })
    await safeDeleteFile(filePath)
    return
  }

  // --- Phase C: processing ---

  const workDir = join(tmpdir(), `video-${skyId}-${starId}`)
  await mkdir(workDir, { recursive: true })

  const localInputPath = join(workDir, 'raw')
  const localOutputPath = join(workDir, 'output.mp4')
  const localThumbPath = join(workDir, 'thumb.jpg')

  try {
    // Download raw
    const bucket = storage.bucket()
    await bucket.file(filePath).download({ destination: localInputPath })

    // Validate size
    const inputStats = await stat(localInputPath)
    if (inputStats.size > VIDEO_RAW_MAX_SIZE_BYTES) {
      throw new Error(`Raw file size ${inputStats.size} exceeds limit ${VIDEO_RAW_MAX_SIZE_BYTES}`)
    }

    // Trim + compress (CRF 28, max 1 retry at CRF 35)
    await trimAndCompress(localInputPath, localOutputPath, trimStart, trimEnd, 28)
    let outputStats = await stat(localOutputPath)

    if (outputStats.size > VIDEO_FINAL_MAX_SIZE_BYTES) {
      await trimAndCompress(localInputPath, localOutputPath, trimStart, trimEnd, 35)
      outputStats = await stat(localOutputPath)
      if (outputStats.size > VIDEO_FINAL_MAX_SIZE_BYTES) {
        throw new Error(`Final clip ${outputStats.size} exceeds limit even at CRF 35`)
      }
    }

    // Generate thumbnail
    await generateThumbnail(localOutputPath, localThumbPath)

    // Upload final files
    const videoPath = `stars/${skyId}/${starId}/video`
    const thumbPath = `stars/${skyId}/${starId}/thumb`

    await bucket.upload(localOutputPath, {
      destination: videoPath,
      metadata: { contentType: 'video/mp4' },
    })
    await bucket.upload(localThumbPath, {
      destination: thumbPath,
      metadata: { contentType: 'image/jpeg' },
    })

    // Update Firestore
    const now = new Date().toISOString()
    await starRef.update({
      mediaType: 'video',
      mediaStatus: 'ready',
      mediaPath: videoPath,
      thumbnailPath: thumbPath,
      mediaDuration: trimEnd - trimStart,
      updatedAt: now,
    })

    // Update rate limit
    await userRef.update({
      videoProcessedToday: videoProcessedToday + 1,
      lastVideoProcessDate: todayUTC,
    })

    // Cleanup raw from Storage
    await safeDeleteFile(filePath)

    console.log(`processVideoClip: success for ${skyId}/${starId}`)

  } catch (error) {
    await handleProcessingError(skyId, starId, filePath, error)
  } finally {
    await cleanupLocalFiles(localInputPath, localOutputPath, localThumbPath)
  }
}

export const processVideoClip = onObjectFinalized(
  {
    region: 'us-central1',
    memory: '2GiB',
    timeoutSeconds: 300,
    maxInstances: 10,
  },
  handleVideoProcessing
)

// --- Helper functions ---

async function trimAndCompress(
  inputPath: string, outputPath: string,
  start: number, end: number, crf: number,
): Promise<void> {
  await runFfmpeg([
    '-i', inputPath,
    '-ss', String(start),
    '-to', String(end),
    '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
    '-c:v', 'libx264', '-preset', 'fast', '-crf', String(crf),
    '-c:a', 'aac', '-b:a', '64k',
    '-movflags', '+faststart',
    '-y', outputPath,
  ])
}

async function generateThumbnail(inputPath: string, outputPath: string): Promise<void> {
  await runFfmpeg([
    '-i', inputPath,
    '-frames:v', '1',
    '-q:v', '5',
    '-y', outputPath,
  ])
}

async function handleProcessingError(
  skyId: string, starId: string, rawFilePath: string, error: unknown,
): Promise<void> {
  logError(`processVideoClip [${skyId}/${starId}]`, error)

  try {
    const starRef = db.collection('skies').doc(skyId).collection('stars').doc(starId)
    await starRef.update({ mediaStatus: 'error', updatedAt: new Date().toISOString() })
  } catch (e) {
    logError('processVideoClip: failed to write error status', e)
  }

  await safeDeleteFile(rawFilePath)

  const bucket = storage.bucket()
  for (const suffix of ['video', 'thumb']) {
    try {
      await bucket.file(`stars/${skyId}/${starId}/${suffix}`).delete()
    } catch { /* File may not exist */ }
  }
}

async function safeDeleteFile(filePath: string): Promise<void> {
  try {
    await storage.bucket().file(filePath).delete()
  } catch { /* Ignore */ }
}

async function cleanupLocalFiles(...paths: string[]): Promise<void> {
  for (const p of paths) {
    try { await unlink(p) } catch { /* Ignore */ }
  }
}
