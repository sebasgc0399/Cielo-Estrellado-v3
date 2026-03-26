import { useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import confetti from 'canvas-confetti'
import { BlurFade } from '@/components/ui/blur-fade'
import { NumberTicker } from '@/components/ui/number-ticker'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { BorderBeam } from '@/components/ui/border-beam'
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

function fireStarConfetti() {
  const defaults = {
    spread: 360, ticks: 50, gravity: 0, decay: 0.94, startVelocity: 30,
    colors: ['#FFE400', '#FFBD00', '#E89400', '#FFD700', '#FFA500'],
  }
  const shoot = () => {
    confetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ['star'] })
    confetti({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ['circle'] })
  }
  setTimeout(shoot, 0)
  setTimeout(shoot, 150)
}

export function DailyRewardModal({ rewards, previousStreak, onClose }: DailyRewardModalProps) {
  const total = rewards.daily + rewards.weekly + rewards.streak

  useEffect(() => {
    fireStarConfetti()
  }, [])

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
          className="relative w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-2xl p-6 text-center"
          style={{
            background: 'rgba(10, 15, 30, 0.92)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
        >
          <BorderBeam
            colorFrom="#FFD700"
            colorTo="rgb(140, 180, 255)"
            size={80}
            duration={8}
            borderWidth={1}
          />

          {/* Icon — SVG star with radial glow */}
          <BlurFade delay={0.1} duration={0.4}>
            <div className="relative mb-3 flex justify-center">
              <div
                className="absolute inset-0"
                style={{
                  background: 'radial-gradient(circle, rgba(255, 215, 0, 0.15) 0%, transparent 70%)',
                }}
              />
              <motion.svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <path
                  d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z"
                  fill="url(#starGradient)"
                  filter="drop-shadow(0 0 6px rgba(255, 215, 0, 0.5))"
                />
                <defs>
                  <linearGradient id="starGradient" x1="4" y1="2" x2="20" y2="20">
                    <stop offset="0%" stopColor="#FFE400" />
                    <stop offset="100%" stopColor="#FFB800" />
                  </linearGradient>
                </defs>
              </motion.svg>
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
              <span
                className="text-4xl font-light"
                style={{ color: '#FFD700', textShadow: '0 0 20px rgba(255, 215, 0, 0.3)' }}
              >
                +
              </span>
              <NumberTicker
                value={total}
                className="text-4xl font-light tabular-nums tracking-wide"
                style={{ color: '#FFD700', textShadow: '0 0 20px rgba(255, 215, 0, 0.3)' }}
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

          {/* Separator */}
          <div className="mx-auto mb-4 h-px w-16" style={{ background: 'rgba(255, 255, 255, 0.06)' }} />

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
              <div className="mb-5 flex justify-center">
                <StreakIndicator
                  currentStreak={rewards.streakDays}
                  previousStreak={previousStreak}
                  className="justify-center"
                />
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
