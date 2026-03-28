import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api/client'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { toast } from 'sonner'
import type { TransactionRecord } from '@/domain/contracts'

type Transaction = TransactionRecord & { id: string }
type TransactionsResponse = { transactions: Transaction[]; nextCursor: string | null }

const REASON_LABELS: Record<string, string> = {
  welcome: 'Bienvenida',
  daily_login: 'Login diario',
  daily_rewards: 'Recompensas diarias',
  star_creation: 'Estrella creada',
  first_star_bonus: 'Primera estrella',
  streak_7: 'Racha de 7 días',
  streak_30: 'Racha de 30 días',
  invite_accepted: 'Invitación aceptada',
  weekly_bonus: 'Bonus semanal',
  shop_purchase: 'Compra',
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)

  if (diffMin < 60) return `Hace ${Math.max(1, diffMin)}m`
  if (diffHours < 24) return `Hace ${diffHours}h`

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer'

  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays < 7) {
    return date.toLocaleDateString('es', { weekday: 'long' })
  }

  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

interface TransactionHistoryProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TransactionHistory({ open, onOpenChange }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoading(true)
    setTransactions([])
    setNextCursor(null)

    api<TransactionsResponse>('/api/user/transactions?limit=20')
      .then((res) => {
        if (cancelled) return
        setTransactions(res.transactions)
        setNextCursor(res.nextCursor)
      })
      .catch(() => {
        if (!cancelled) toast.error('Error al cargar el historial')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [open])

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return

    setLoadingMore(true)
    api<TransactionsResponse>(`/api/user/transactions?limit=20&cursor=${nextCursor}`)
      .then((res) => {
        setTransactions((prev) => [...prev, ...res.transactions])
        setNextCursor(res.nextCursor)
      })
      .catch(() => {
        toast.error('Error al cargar más transacciones')
      })
      .finally(() => setLoadingMore(false))
  }, [nextCursor, loadingMore])

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Historial de Polvo Estelar">
      <div className="px-1 pt-2 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: 'var(--accent-color)', borderTopColor: 'transparent' }}
            />
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <span className="text-2xl" style={{ color: 'var(--text-muted)' }}>✦</span>
            <p
              className="text-sm font-light tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              Aún no hay transacciones
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {transactions.map((tx) => {
              const isEarn = tx.type === 'earn'
              return (
                <div
                  key={tx.id}
                  className="flex items-center gap-3 rounded-lg px-1 py-2.5"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: isEarn
                        ? 'rgba(74, 222, 128, 0.1)'
                        : 'rgba(248, 113, 113, 0.1)',
                    }}
                  >
                    {isEarn ? (
                      <ArrowUp className="h-4 w-4" style={{ color: 'rgba(74, 222, 128, 0.9)' }} />
                    ) : (
                      <ArrowDown className="h-4 w-4" style={{ color: 'rgba(248, 113, 113, 0.9)' }} />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-light tracking-wide"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {REASON_LABELS[tx.reason] ?? tx.reason}
                    </p>
                    <p
                      className="text-[11px] font-light tracking-wide"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatRelativeDate(tx.createdAt)}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p
                      className="text-sm font-light tabular-nums tracking-wide"
                      style={{
                        color: isEarn
                          ? 'rgba(74, 222, 128, 0.9)'
                          : 'rgba(248, 113, 113, 0.9)',
                      }}
                    >
                      {isEarn ? '+' : '-'}{tx.amount}
                    </p>
                    <p
                      className="text-[11px] font-light tabular-nums tracking-wide"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Saldo: {tx.balanceAfter}
                    </p>
                  </div>
                </div>
              )
            })}

            {nextCursor && (
              <div className="pt-2 text-center">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-xs font-light tracking-wide transition-colors hover:opacity-80 disabled:opacity-50"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {loadingMore ? 'Cargando...' : 'Cargar más'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
