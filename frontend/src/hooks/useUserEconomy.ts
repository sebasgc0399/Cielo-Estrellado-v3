import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import { api } from '@/lib/api/client'
import type { InventoryItem } from '@/domain/contracts'

interface EconomyRewards {
  daily: number
  weekly: number
  streak: number
  streakDays: number
}

export interface EconomyData {
  stardust: number
  loginStreak: number
  previousStreak: number
  lastDailyRewardDate: string | null
  weeklyBonusWeek: string | null
  inventory: InventoryItem[]
  rewards: EconomyRewards
}

export function useUserEconomy() {
  const { user, loading: authLoading } = useAuth()
  const [economy, setEconomy] = useState<EconomyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchCount, setFetchCount] = useState(0)

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    api<EconomyData>('/api/user/economy')
      .then((res) => {
        if (cancelled) return
        setEconomy(res)
      })
      .catch(() => {
        if (cancelled) return
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [user, authLoading, fetchCount])

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1)
  }, [])

  const addStardust = useCallback((amount: number) => {
    setEconomy((prev) => prev ? { ...prev, stardust: prev.stardust + amount } : prev)
  }, [])

  return { economy, loading, refetch, addStardust }
}
