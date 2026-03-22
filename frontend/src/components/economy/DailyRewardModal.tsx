import { motion, AnimatePresence } from 'motion/react'
import { BlurFade } from '@/components/ui/blur-fade'
import { NumberTicker } from '@/components/ui/number-ticker'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { StreakIndicator } from '@/components/economy/StreakIndicator'

interface DailyRewardModalProps {
  rewards: {
    daily: number
    weekly: number
    streak: number
    streakDays: number
  }
  previousStreak: number
  onClose: () => void
}

export function DailyRewardModal({ rewards, previousStreak, onClose }: DailyRewardModalProps) {
  const total = rewards.daily + rewards.weekly + rewards.streak

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="w-[calc(100%-2rem)] max-w-sm rounded-2xl p-6 text-center"
          style={{
            background: 'rgba(10, 15, 30, 0.90)',
            border: '1px solid rgba(255, 255, 255, 0.10)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Icon */}
          <BlurFade delay={0.1} duration={0.4}>
            <div
              className="mb-3 text-4xl"
              style={{
                color: '#FFD700',
                filter: 'drop-shadow(0 0 12px rgba(255, 215, 0, 0.4))',
              }}
            >
              ✦
            </div>
          </BlurFade>

          {/* Title */}
          <BlurFade delay={0.15} duration={0.4}>
            <h2
              className="mb-4 text-lg font-light tracking-wide"
              style={{
                color: 'var(--text-primary)',
                fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
              }}
            >
              Recompensa diaria
            </h2>
          </BlurFade>

          {/* Total */}
          <BlurFade delay={0.25} duration={0.4}>
            <div className="mb-1 flex items-center justify-center gap-1.5">
              <span style={{ color: '#FFD700' }}>+</span>
              <NumberTicker
                value={total}
                className="text-3xl font-light tabular-nums tracking-wide"
                style={{ color: '#FFD700' }}
              />
            </div>
            <p
              className="mb-5 text-sm font-light tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Polvo Estelar
            </p>
          </BlurFade>

          {/* Streak broken message */}
          {previousStreak > 3 && rewards.streakDays === 1 && (
            <BlurFade delay={0.3} duration={0.3}>
              <p
                className="mb-4 text-xs font-light leading-relaxed tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Tu racha de {previousStreak} días se reinició, pero hoy empiezas de nuevo
              </p>
            </BlurFade>
          )}

          {/* Breakdown */}
          <div className="mb-5 space-y-1.5">
            <BlurFade delay={0.35} duration={0.3}>
              <p
                className="text-xs font-light tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Login diario: +{rewards.daily}
              </p>
            </BlurFade>

            {rewards.weekly > 0 && (
              <BlurFade delay={0.4} duration={0.3}>
                <p
                  className="text-xs font-light tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Bonus semanal: +{rewards.weekly}
                </p>
              </BlurFade>
            )}

            {rewards.streak > 0 && (
              <BlurFade delay={0.45} duration={0.3}>
                <p
                  className="text-xs font-light tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Racha de {rewards.streakDays} días: +{rewards.streak}
                </p>
              </BlurFade>
            )}
          </div>

          {/* Streak indicator */}
          {rewards.streakDays > 0 && (
            <BlurFade delay={0.5} duration={0.3}>
              <div className="mb-5">
                <StreakIndicator currentStreak={rewards.streakDays} previousStreak={previousStreak} />
              </div>
            </BlurFade>
          )}

          {/* CTA */}
          <BlurFade delay={0.55} duration={0.3}>
            <ShimmerButton
              onClick={onClose}
              shimmerColor="rgba(255, 215, 0, 0.6)"
              background="rgba(255, 255, 255, 0.06)"
              className="mx-auto text-sm font-light tracking-wide"
            >
              Genial
            </ShimmerButton>
          </BlurFade>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
