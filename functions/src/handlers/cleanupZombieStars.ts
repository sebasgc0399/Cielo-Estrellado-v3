import { onSchedule } from 'firebase-functions/v2/scheduler'
import type { ScheduledEvent } from 'firebase-functions/v2/scheduler'
import { db, storage } from '../lib/firebaseAdmin.js'
import { logError } from '../logError.js'

export async function handleCleanupZombieStars(_event: ScheduledEvent): Promise<void> {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

  const zombies = await db.collectionGroup('stars')
    .where('mediaStatus', '==', 'processing')
    .where('updatedAt', '<', fifteenMinutesAgo)
    .get()

  if (zombies.empty) {
    console.log('cleanupZombieStars: no zombies found')
    return
  }

  console.log(`cleanupZombieStars: found ${zombies.size} zombie stars`)

  const bucket = storage.bucket()
  const now = new Date().toISOString()

  for (const doc of zombies.docs) {
    try {
      const starId = doc.id
      const skyId = doc.ref.parent.parent?.id
      if (!skyId) {
        logError('cleanupZombieStars', new Error(`Could not determine skyId for ${doc.ref.path}`))
        continue
      }

      await doc.ref.update({ mediaStatus: null, updatedAt: now })

      try {
        await bucket.file(`temp/${skyId}/${starId}/raw`).delete()
      } catch { /* File may not exist */ }

      console.log(`cleanupZombieStars: reset ${skyId}/${starId}`)
    } catch (error) {
      logError(`cleanupZombieStars: failed to reset ${doc.ref.path}`, error)
    }
  }
}

export const cleanupZombieStars = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  handleCleanupZombieStars
)
