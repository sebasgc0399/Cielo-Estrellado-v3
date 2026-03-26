import { cn } from '@/lib/utils'

interface StreakIndicatorProps {
  currentStreak: number
  previousStreak: number
  className?: string
}

export function StreakIndicator({ currentStreak, previousStreak, className }: StreakIndicatorProps) {
  const completedDots = currentStreak === 0 ? 0 : currentStreak >= 7 ? 7 : currentStreak % 7 || 7

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* 7-day circles */}
      <div className="flex gap-1">
        {Array.from({ length: 7 }, (_, i) => {
          const isCompleted = i < completedDots
          const isCurrent = i === completedDots - 1 && currentStreak > 0

          return (
            <div
              key={i}
              className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
              style={
                isCompleted
                  ? {
                      background: 'rgba(255, 215, 0, 0.15)',
                      border: '1px solid rgba(255, 215, 0, 0.4)',
                      ...(isCurrent
                        ? { boxShadow: '0 0 8px rgba(255, 215, 0, 0.25)' }
                        : {}),
                    }
                  : {
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                    }
              }
            >
              {isCompleted && (
                <span className="text-[8px]" style={{ color: '#FFD700' }}>
                  ✦
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Streak text — inline */}
      <span
        className="text-xs font-light tracking-wide whitespace-nowrap"
        style={{ color: 'var(--text-muted)' }}
      >
        {currentStreak === 0 && previousStreak > 0 ? (
          <>{previousStreak}d</>
        ) : currentStreak >= 7 ? (
          <>🔥 <span style={{ color: '#FFD700' }}>{currentStreak}</span>d</>
        ) : (
          <>{currentStreak}d</>
        )}
      </span>
    </div>
  )
}
