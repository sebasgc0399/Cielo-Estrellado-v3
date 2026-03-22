import { NumberTicker } from '@/components/ui/number-ticker'

interface StardustBalanceProps {
  balance: number
  onClick?: () => void
}

export function StardustBalance({ balance, onClick }: StardustBalanceProps) {
  const Component = onClick ? 'button' : 'div'

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
      <NumberTicker
        value={balance}
        className="text-sm font-light tracking-wide tabular-nums"
        style={{ color: 'var(--text-primary)' }}
      />
    </Component>
  )
}
