interface StreakIndicatorProps {
  currentStreak: number
  previousStreak: number
}

export function StreakIndicator({ currentStreak, previousStreak }: StreakIndicatorProps) {
  const completedDots = currentStreak === 0 ? 0 : currentStreak >= 7 ? 7 : currentStreak % 7 || 7

  return (
    <div className="mt-2 flex flex-col gap-2">
      {/* 7-day circles */}
      <div className="flex gap-1.5">
        {Array.from({ length: 7 }, (_, i) => {
          const isCompleted = i < completedDots
          const isCurrent = i === completedDots - 1 && currentStreak > 0

          return (
            <div
              key={i}
              className="flex h-7 w-7 items-center justify-center rounded-full"
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
                <span className="text-[10px]" style={{ color: '#FFD700' }}>
                  ✦
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Streak text */}
      <p
        className="text-xs font-light tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {currentStreak === 0 && previousStreak > 0 ? (
          <>Racha anterior: {previousStreak} días</>
        ) : currentStreak >= 7 ? (
          <>
            🔥 <span style={{ color: '#FFD700' }}>{currentStreak}</span> días
          </>
        ) : (
          <>{currentStreak} días</>
        )}
      </p>

      {/* Progress bar toward 30-day streak */}
      {currentStreak >= 7 && (
        <div className="flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full"
            style={{ background: 'rgba(255, 255, 255, 0.06)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((currentStreak / 30) * 100, 100)}%`,
                background: 'linear-gradient(90deg, #FFD700, #FFA500)',
                ...(currentStreak >= 30
                  ? { boxShadow: '0 0 8px rgba(255, 215, 0, 0.4)' }
                  : {}),
              }}
            />
          </div>
          <span
            className="text-[10px] font-light tracking-wide tabular-nums"
            style={{ color: 'var(--text-muted)' }}
          >
            {currentStreak}/30
          </span>
        </div>
      )}
    </div>
  )
}
