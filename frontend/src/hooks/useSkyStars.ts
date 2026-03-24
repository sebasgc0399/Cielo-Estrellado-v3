import { useEffect, useState } from 'react'
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore'
import { useAuth } from '@/lib/auth/AuthContext'
import { db } from '@/lib/firebase/client'
import type { StarRecord } from '@/domain/contracts'
import type { UserStar } from '@/engine/SkyEngine'

export type StarWithId = StarRecord & { starId: string }

export function useSkyStars(skyId: string) {
  const { user, loading: authLoading } = useAuth()
  const [stars, setStars] = useState<StarWithId[]>([])
  const [userStars, setUserStars] = useState<UserStar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (authLoading || !user) return

    const q = query(
      collection(db, 'skies', skyId, 'stars'),
      orderBy('createdAt', 'desc'),
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
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
        setError(null)
        setLoading(false)
      },
      (err) => {
        console.error('Stars listener error:', err)
        setError(err)
        setLoading(false)
      },
    )

    return unsubscribe
  }, [skyId, user, authLoading])

  return { stars, userStars, loading, error }
}
