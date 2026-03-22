import { useEffect, useState } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase/client'
import type { StarRecord } from '@/domain/contracts'
import type { UserStar } from '@/engine/SkyEngine'

export type StarWithId = StarRecord & { starId: string }

export function useSkyStars(skyId: string) {
  const [stars, setStars] = useState<StarWithId[]>([])
  const [userStars, setUserStars] = useState<UserStar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const q = query(
      collection(db, 'skies', skyId, 'stars'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allStars: StarWithId[] = []
      const engineStars: UserStar[] = []

      for (const doc of snapshot.docs) {
        const data = doc.data() as StarRecord
        if (data.deletedAt != null) continue

        allStars.push({ ...data, starId: doc.id })

        if (data.xNormalized != null && data.yNormalized != null) {
          engineStars.push({
            id: doc.id,
            x: data.xNormalized,
            y: data.yNormalized,
          })
        }
      }

      setStars(allStars)
      setUserStars(engineStars)
      setLoading(false)
    })

    return unsubscribe
  }, [skyId])

  return { stars, userStars, loading }
}
