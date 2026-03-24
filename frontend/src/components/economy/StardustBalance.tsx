import { NumberTicker } from '@/components/ui/number-ticker'

interface StardustBalanceProps {
  balance: number
  compact?: boolean
  onClick?: () => void
}

export function formatCompact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US')
  if (n < 1_000_000) {
    const k = n / 1_000
    return k >= 100 ? `${Math.floor(k)}K` : `${+k.toFixed(1)}K`
  }
  const m = n / 1_000_000
  return m >= 100 ? `${Math.floor(m)}M` : `${+m.toFixed(1)}M`
}

export function StardustBalance({ balance, compact, onClick }: StardustBalanceProps) {
  const Component = onClick ? 'button' : 'div'
  const useCompact = compact && balance >= 10_000

  return (
    <Component
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors${
        onClick ? ' cursor-pointer hover:bg-white/[0.08]' : ''
      }`}
      style={{
        background: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      <span className="text-sm" style={{ color: '#FFD700' }}>
        ✦
      </span>
      {useCompact ? (
        <span
          className="text-sm font-light tracking-wide tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        >
          {formatCompact(balance)}
        </span>
      ) : (
        <NumberTicker
          value={balance}
          className="text-sm font-light tracking-wide tabular-nums"
          style={{ color: 'var(--text-primary)' }}
        />
      )}
    </Component>
  )
}
