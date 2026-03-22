import { useEffect, useState } from 'react'
import { api, ApiError } from '@/lib/api/client'
import type { SkyRecord, MemberRole } from '@/domain/contracts'

type SkyResponse = {
  sky: SkyRecord
  member: { role: MemberRole; status: string }
}

export function useSkyData(skyId: string) {
  const [sky, setSky] = useState<SkyRecord | null>(null)
  const [role, setRole] = useState<MemberRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    api<SkyResponse>(`/api/skies/${skyId}`)
      .then((res) => {
        if (cancelled) return
        setSky(res.sky)
        setRole(res.member.role)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setError('Cielo no encontrado')
          } else if (err.status === 403) {
            setError('Sin acceso a este cielo')
          } else {
            setError('Error al cargar el cielo')
          }
        } else {
          setError('Error al cargar el cielo')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [skyId])

  return { sky, role, loading, error }
}
