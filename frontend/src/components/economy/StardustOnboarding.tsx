import { useEffect } from 'react'
import { BlurFade } from '@/components/ui/blur-fade'
import { X } from 'lucide-react'

interface StardustOnboardingProps {
  onDismiss: () => void
}

export function StardustOnboarding({ onDismiss }: StardustOnboardingProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <BlurFade delay={0.3} duration={0.4}>
      <div
        className="mx-auto mb-4 flex max-w-md items-start gap-3 rounded-xl p-3"
        style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <span className="shrink-0 text-lg" style={{ color: '#FFD700' }}>
          ✦
        </span>

        <div className="min-w-0 flex-1">
          <p
            className="mb-1 text-sm font-medium tracking-wide"
            style={{ color: 'var(--text-primary)' }}
          >
            Polvo Estelar ✦
          </p>
          <p
            className="text-xs font-light leading-relaxed tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Gana Polvo Estelar al crear estrellas, iniciar sesión cada día y mantener tu racha.
            Úsalo para desbloquear temas.
          </p>
        </div>

        <button
          onClick={onDismiss}
          className="shrink-0 transition-colors"
          aria-label="Cerrar"
        >
          <X
            className="h-5 w-5"
            style={{ color: 'var(--text-muted)' }}
          />
        </button>
      </div>
    </BlurFade>
  )
}
