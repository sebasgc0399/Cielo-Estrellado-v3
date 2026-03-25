import { NumberTicker } from '@/components/ui/number-ticker'
import { Button } from '@/components/ui/button'

import { formatCOP } from '@/lib/formatCOP'
import type { StardustPackage } from '@/domain/contracts'

export type PackageTier = 'basic' | 'mid' | 'high' | 'premium' | 'legendary'

interface PackageCardProps {
  pkg: StardustPackage
  tier: PackageTier
  purchasing: boolean
  onBuy: (packageId: string) => void
}

const TIER_CONFIG: Record<PackageTier, {
  icon: string
  iconSize: string
  badge: string | null
  highlight: string | null
  borderColor: string
  bgTint: string
  shadow: string
  iconFilter: string
}> = {
  basic: {
    icon: '✦',
    iconSize: 'text-xl',
    badge: null,
    highlight: null,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    bgTint: 'rgba(255, 255, 255, 0.03)',
    shadow: 'none',
    iconFilter: 'drop-shadow(0 0 4px rgba(255, 215, 0, 0.3))',
  },
  mid: {
    icon: '✨',
    iconSize: 'text-xl',
    badge: null,
    highlight: null,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    bgTint: 'rgba(255, 255, 255, 0.03)',
    shadow: 'none',
    iconFilter: 'drop-shadow(0 0 6px rgba(255, 215, 0, 0.3))',
  },
  high: {
    icon: '✨',
    iconSize: 'text-2xl',
    badge: null,
    highlight: null,
    borderColor: 'rgba(255, 215, 0, 0.12)',
    bgTint: 'rgba(255, 215, 0, 0.02)',
    shadow: 'none',
    iconFilter: 'drop-shadow(0 0 8px rgba(255, 215, 0, 0.35))',
  },
  premium: {
    icon: '💎',
    iconSize: 'text-2xl',
    badge: 'Popular',
    highlight: null,
    borderColor: 'rgba(255, 215, 0, 0.25)',
    bgTint: 'rgba(255, 215, 0, 0.03)',
    shadow: '0 0 12px rgba(255, 215, 0, 0.08)',
    iconFilter: 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.4))',
  },
  legendary: {
    icon: '🌌',
    iconSize: 'text-3xl',
    badge: 'Mejor valor',
    highlight: null,
    borderColor: 'rgba(255, 215, 0, 0.35)',
    bgTint: 'linear-gradient(135deg, rgba(255, 215, 0, 0.04), rgba(255, 165, 0, 0.02))',
    shadow: '0 0 20px rgba(255, 215, 0, 0.12), 0 0 15px rgba(255, 215, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.3)',
    iconFilter: 'drop-shadow(0 0 14px rgba(255, 215, 0, 0.5))',
  },
}

export function PackageCard({ pkg, tier, purchasing, onBuy }: PackageCardProps) {
  const config = TIER_CONFIG[tier]
  const isLegendary = tier === 'legendary'

  return (
    <div className="relative">
      {/* Floating badge */}
      {config.badge && (
        <div
          className="absolute -top-2.5 left-4 z-10 rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wider uppercase"
          style={{
            background: isLegendary
              ? 'linear-gradient(135deg, rgba(255, 215, 0, 0.25), rgba(255, 165, 0, 0.20))'
              : 'rgba(255, 215, 0, 0.15)',
            border: '1px solid rgba(255, 215, 0, 0.30)',
            color: '#FFD700',
            boxShadow: isLegendary
              ? '0 0 12px rgba(255, 215, 0, 0.15)'
              : '0 0 8px rgba(255, 215, 0, 0.10)',
          }}
        >
          {config.badge}
        </div>
      )}

      {/* Card */}
      <div
        className="relative overflow-hidden rounded-xl p-3.5 transition-transform duration-200 hover:scale-[1.01]"
        style={{
          background: config.bgTint.startsWith('linear')
            ? config.bgTint
            : config.bgTint,
          border: `1px solid ${config.borderColor}`,
          boxShadow: config.shadow,
        }}
      >
        {/* Row layout */}
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div
            className={`${config.iconSize} shrink-0 leading-none`}
            style={{ filter: config.iconFilter }}
          >
            {config.icon}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <p
              className="text-sm font-light tracking-wide"
              style={{
                color: 'var(--text-primary)',
                fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
              }}
            >
              {pkg.name}
            </p>

            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="flex items-center gap-1">
                <span className="text-xs" style={{ color: '#FFD700' }}>✦</span>
                <NumberTicker
                  value={pkg.stardustAmount}
                  className="text-sm font-medium tabular-nums tracking-wide"
                  style={{ color: '#FFD700' }}
                />
              </span>

              {pkg.bonusPercent > 0 && (
                <span
                  className="rounded-full px-1.5 py-px text-[10px] font-medium tracking-wide"
                  style={{
                    background: 'rgba(255, 215, 0, 0.12)',
                    color: '#FFD700',
                  }}
                >
                  +{pkg.bonusPercent}%
                </span>
              )}
            </div>

            <p
              className="mt-0.5 text-xs font-light tracking-wide tabular-nums"
              style={{ color: 'var(--text-muted)' }}
            >
              {formatCOP(pkg.priceInCents)}
            </p>
          </div>

          {/* Buy button */}
          <Button
            variant="glass-gold"
            size="sm"
            disabled={purchasing}
            onClick={() => onBuy(pkg.packageId)}
            className="shrink-0"
          >
            {purchasing ? 'Procesando...' : 'Comprar'}
          </Button>
        </div>
      </div>
    </div>
  )
}
