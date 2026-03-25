import { useMemo } from 'react'
import type { ShopItem } from '@/domain/shopCatalog'
import type { ThemeDefinition } from '@/domain/themes'
import type { StarShape } from '@/engine/SkyEngine'
import { Badge } from '@/components/ui/badge'

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

const FIREFLY_POSITIONS = [
  { top: '25%', left: '30%' },
  { top: '55%', left: '65%' },
  { top: '40%', left: '18%' },
  { top: '70%', left: '78%' },
]

const METEOR_TRAILS = [
  { top: '8%', left: '20%', delay: '0s', width: 48 },
  { top: '30%', left: '50%', delay: '1.2s', width: 36 },
  { top: '18%', left: '68%', delay: '2.4s', width: 42 },
]

const CLIP_PATHS: Record<Exclude<StarShape, 'circle'>, string> = {
  heart: 'path("M4 1.5C2.6 0 0 0.6 0 2.8c0 1.3 1 2.5 4 4.7 3-2.2 4-3.4 4-4.7C8 0.6 5.4 0 4 1.5z")',
  crystal: 'polygon(50% 0%, 85% 50%, 50% 100%, 15% 50%)',
  flower: 'polygon(50% 0%, 62% 32%, 98% 35%, 70% 57%, 79% 91%, 50% 72%, 21% 91%, 30% 57%, 2% 35%, 38% 32%)',
}

type EffectType = 'meteor' | 'fireflies' | 'constellations' | null

function getEffectType(theme: ThemeDefinition): EffectType {
  if (theme.effects?.meteorShower) return 'meteor'
  if (theme.effects?.fireflies) return 'fireflies'
  if (theme.effects?.constellationLines) return 'constellations'
  return null
}

function hasSpecialEffects(theme: ThemeDefinition): boolean {
  return theme.effects !== undefined
}

function MeteorOverlay({ headColor, tailColor }: { headColor: string; tailColor: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
      {METEOR_TRAILS.map((trail, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            top: trail.top,
            left: trail.left,
            width: `${trail.width}px`,
            height: '2px',
            background: `linear-gradient(90deg, transparent, ${tailColor}, ${headColor})`,
            borderRadius: '1px',
            transform: 'rotate(32deg)',
            transformOrigin: 'left center',
            animation: `meteor-trail 2.8s ease-in-out ${trail.delay} infinite`,
            boxShadow: `0 0 6px ${headColor}`,
          }}
        />
      ))}
    </div>
  )
}

function FireflyOverlay({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
      {FIREFLY_POSITIONS.map((pos, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            top: pos.top,
            left: pos.left,
            width: '5px',
            height: '5px',
            background: color,
            boxShadow: `0 0 8px 2px ${color}, 0 0 16px 4px ${color}`,
            animation: `firefly-pulse 2.8s ease-in-out ${i * 0.7}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

function ConstellationOverlay({ lineColor }: { lineColor: string }) {
  const connections = [
    [0, 2], [2, 1], [1, 4], [2, 3], [3, 0],
  ] as const

  return (
    <svg
      className="absolute inset-0"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ pointerEvents: 'none' }}
    >
      {connections.map(([a, b], i) => {
        const starA = STAR_POSITIONS[a]
        const starB = STAR_POSITIONS[b]
        const x1 = parseFloat(starA.left)
        const y1 = parseFloat(starA.top)
        const x2 = parseFloat(starB.left)
        const y2 = parseFloat(starB.top)
        return (
          <line
            key={i}
            x1={x1} y1={y1}
            x2={x2} y2={y2}
            stroke={lineColor}
            strokeWidth="0.3"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

export function ThemePreviewCard({ item, theme, owned, balance, onPurchase }: ThemePreviewCardProps) {
  const canAfford = balance >= item.price
  const effectType = getEffectType(theme)
  const starShape = theme.effects?.starShape
  const isSpecial = hasSpecialEffects(theme)

  const headerStyle = useMemo(() => ({
    background: `linear-gradient(135deg, ${theme.colors.nebulaBaseStartColor}, ${theme.colors.nebulaBaseEndColor})`,
  }), [theme.colors.nebulaBaseStartColor, theme.colors.nebulaBaseEndColor])

  const starStyles = useMemo(() => {
    const hasShape = starShape && starShape !== 'circle'
    return STAR_POSITIONS.map(star => {
      const displaySize = hasShape ? Math.max(star.size, 7) : star.size
      return {
        width: `${displaySize}px`,
        height: `${displaySize}px`,
        top: star.top,
        left: star.left,
        background: theme.colors.userStarColor,
        boxShadow: `0 0 ${displaySize + 3}px ${theme.colors.glowColor}`,
        ...(hasShape ? { clipPath: CLIP_PATHS[starShape as Exclude<StarShape, 'circle'>] } : { borderRadius: '50%' }),
      }
    })
  }, [theme.colors.userStarColor, theme.colors.glowColor, starShape])

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
            className="absolute"
            style={style}
          />
        ))}
        {/* Nebula accent overlay */}
        <div
          className="absolute inset-0"
          style={nebulaOverlayStyle}
        />

        {/* Effect-specific overlays */}
        {effectType === 'meteor' && (
          <MeteorOverlay
            headColor={theme.colors.shootingStarHeadColor}
            tailColor={theme.colors.shootingStarTailColor}
          />
        )}
        {effectType === 'fireflies' && theme.effects?.fireflies && (
          <FireflyOverlay color={theme.effects.fireflies.color} />
        )}
        {effectType === 'constellations' && theme.effects?.constellationLines && (
          <ConstellationOverlay lineColor={theme.effects.constellationLines.color} />
        )}

        {/* Special badge */}
        {isSpecial && (
          <Badge
            variant="outline"
            className="absolute top-2 right-2 h-4 border-0 px-1.5 py-0 text-[10px]"
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(8px)',
              color: theme.colors.userStarColor,
            }}
          >
            Especial
          </Badge>
        )}
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
