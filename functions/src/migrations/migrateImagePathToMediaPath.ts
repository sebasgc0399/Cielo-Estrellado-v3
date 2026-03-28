import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// Initialize Firebase Admin (uses GOOGLE_APPLICATION_CREDENTIALS env var)
initializeApp()
const db = getFirestore()

async function migrate() {
  const starsSnap = await db.collectionGroup('stars').get()

  let processed = 0
  let skipped = 0
  let batch = db.batch()
  let batchCount = 0

  for (const doc of starsSnap.docs) {
    const data = doc.data()

    // Skip already migrated docs
    if ('mediaPath' in data) {
      skipped++
      continue
    }

    batch.update(doc.ref, {
      mediaPath: data.imagePath ?? null,
      mediaType: data.imagePath ? 'image' : null,
      mediaStatus: null,
      thumbnailPath: null,
      mediaDuration: null,
    })

    batchCount++
    processed++

    if (batchCount >= 400) {
      await batch.commit()
      console.log(`Committed batch: ${processed} processed so far`)
      batch = db.batch()
      batchCount = 0
    }
  }

  if (batchCount > 0) {
    await batch.commit()
  }

  console.log(`Migration complete: ${processed} processed, ${skipped} skipped (already migrated)`)
}

migrate().catch(console.error)
