import { useMemo } from 'react'
import type { ShopItem } from '@/domain/shopCatalog'
import type { ThemeDefinition } from '@/domain/themes'

interface ThemePreviewCardProps {
  item: ShopItem
  theme: ThemeDefinition
  owned: boolean
  balance: number
  onPurchase: (itemId: string) => void
}

const STAR_POSITIONS = [
  { top: '20%', left: '15%', size: 3 },
  { top: '45%', left: '70%', size: 4 },
  { top: '30%', left: '40%', size: 3 },
  { top: '65%', left: '25%', size: 5 },
  { top: '50%', left: '85%', size: 3 },
]

export function ThemePreviewCard({ item, theme, owned, balance, onPurchase }: ThemePreviewCardProps) {
  const canAfford = balance >= item.price

  const headerStyle = useMemo(() => ({
    background: `linear-gradient(135deg, ${theme.colors.nebulaBaseStartColor}, ${theme.colors.nebulaBaseEndColor})`,
  }), [theme.colors.nebulaBaseStartColor, theme.colors.nebulaBaseEndColor])

  const starStyles = useMemo(() =>
    STAR_POSITIONS.map(star => ({
      width: `${star.size}px`,
      height: `${star.size}px`,
      top: star.top,
      left: star.left,
      background: theme.colors.userStarColor,
      boxShadow: `0 0 ${star.size + 3}px ${theme.colors.glowColor}`,
    })),
    [theme.colors.userStarColor, theme.colors.glowColor],
  )

  const nebulaOverlayStyle = useMemo(() => ({
    background: `radial-gradient(ellipse at 60% 40%, ${theme.colors.nebulaAccentColor}, transparent 70%)`,
  }), [theme.colors.nebulaAccentColor])

  return (
    <div
      className="overflow-hidden rounded-xl transition-transform duration-200 hover:scale-[1.02]"
      style={{
        background: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Theme preview */}
      <div
        className="relative h-32 overflow-hidden"
        style={headerStyle}
      >
        {starStyles.map((style, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={style}
          />
        ))}
        {/* Nebula accent overlay */}
        <div
          className="absolute inset-0"
          style={nebulaOverlayStyle}
        />
      </div>

      {/* Info */}
      <div className="p-3">
        <p
          className="text-sm font-medium tracking-wide"
          style={{ color: 'var(--text-primary)' }}
        >
          {theme.name}
        </p>

        <div className="mt-2">
          {owned ? (
            <span
              className="text-xs font-medium tracking-wide"
              style={{ color: 'rgba(134, 239, 172, 0.9)' }}
            >
              Adquirido ✓
            </span>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-xs tabular-nums" style={{ color: '#FFD700' }}>
                  ✦ {item.price}
                </span>
                <button
                  onClick={() => onPurchase(item.itemId)}
                  disabled={!canAfford}
                  className="rounded-full px-3 py-1 text-xs font-medium tracking-wide transition-all"
                  style={{
                    background: canAfford ? 'rgba(255, 215, 0, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: `1px solid ${canAfford ? 'rgba(255, 215, 0, 0.3)' : 'rgba(255, 255, 255, 0.06)'}`,
                    color: canAfford ? '#FFD700' : 'var(--text-muted)',
                    opacity: canAfford ? 1 : 0.5,
                    cursor: canAfford ? 'pointer' : 'default',
                  }}
                >
                  Comprar
                </button>
              </div>
              {!canAfford && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(balance / item.price) * 100}%`,
                      background: '#FFD700',
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
