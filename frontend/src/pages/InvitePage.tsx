import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useAuth } from '@/lib/auth/AuthContext'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api, ApiError } from '@/lib/api/client'
import { toast } from 'sonner'
import { showStardustToast } from '@/components/economy/StardustToast'
import type { InviteRole } from '@/domain/contracts'

type ValidPreview = {
  valid: true
  inviteId: string
  skyId: string
  skyTitle: string
  role: InviteRole
}

type InvalidPreview = {
  valid: false
  reason: 'not_found' | 'expired' | 'revoked' | 'accepted'
}

type InvitePreview = ValidPreview | InvalidPreview

const ROLE_LABELS: Record<InviteRole, string> = {
  editor: 'Editor',
  viewer: 'Lector',
}

const INVALID_TITLES: Record<InvalidPreview['reason'], string> = {
  not_found: 'Invitación no encontrada',
  expired: 'Esta invitación ha expirado',
  revoked: 'Esta invitación fue revocada',
  accepted: 'Esta invitación ya fue utilizada',
}

const glassStyle = {
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 'var(--radius-card)',
  backdropFilter: 'blur(var(--glass-blur))',
  WebkitBackdropFilter: 'blur(var(--glass-blur))',
  boxShadow: 'var(--shadow-elevated), 0 0 80px rgba(140, 180, 255, 0.04)',
} as const

const serifFont = {
  fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
} as const

export function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)

  useEffect(() => {
    if (!token) return

    api<InvitePreview>(`/api/invites/${token}/preview`)
      .then(setPreview)
      .catch(() => {
        setPreview({ valid: false, reason: 'not_found' })
      })
      .finally(() => setLoading(false))
  }, [token])

  const handleAccept = async () => {
    if (!token || !preview?.valid) return

    setAccepting(true)
    try {
      const response = await api<{ skyId: string; rewards?: { stardustEarned: number } }>(`/api/invites/${token}/accept`, {
        method: 'POST',
      })
      navigate(`/sky/${response.skyId}`, { replace: true })
      if (response.rewards?.stardustEarned) {
        showStardustToast(response.rewards.stardustEarned, 'invite_accepted')
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        navigate(`/sky/${preview.skyId}`, { replace: true })
        toast('Ya eres miembro de este cielo')
      } else {
        toast.error('Error al aceptar la invitación')
      }
    } finally {
      setAccepting(false)
    }
  }

  const isReady = !loading && !authLoading

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SkyCanvas demo />

      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <BlurFade delay={0.2} duration={0.6} direction="up" offset={12}>
          <div
            className="w-full max-w-[380px] space-y-6 px-8 py-10"
            style={glassStyle}
          >
            {!isReady ? (
              /* Loading state */
              <div className="flex justify-center py-8">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
              </div>
            ) : preview?.valid ? (
              /* Valid invite */
              <>
                <div className="space-y-3 text-center">
                  <BlurFade delay={0.4} duration={0.5}>
                    <h1
                      className="text-[1.75rem] font-light leading-tight tracking-[0.2em]"
                      style={{ color: 'var(--text-primary)', ...serifFont }}
                    >
                      {preview.skyTitle}
                    </h1>
                  </BlurFade>

                  <BlurFade delay={0.5} duration={0.5}>
                    <div className="flex justify-center">
                      <Badge
                        variant="outline"
                        className="text-[10px] tracking-wider uppercase"
                      >
                        {ROLE_LABELS[preview.role]}
                      </Badge>
                    </div>
                  </BlurFade>

                  <BlurFade delay={0.55} duration={0.5}>
                    <p
                      className="text-sm font-light"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      Has sido invitado como {ROLE_LABELS[preview.role]} a este cielo
                    </p>
                  </BlurFade>
                </div>

                <BlurFade delay={0.6} duration={0.4}>
                  {user ? (
                    <Button
                      size="lg"
                      className="h-11 w-full text-sm font-normal tracking-wide"
                      onClick={handleAccept}
                      disabled={accepting}
                    >
                      {accepting ? 'Aceptando...' : 'Aceptar invitación'}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-11 w-full text-sm font-normal tracking-wide"
                      onClick={() => navigate(`/login?redirect=/invite/${token}`)}
                    >
                      Iniciar sesión para aceptar
                    </Button>
                  )}
                </BlurFade>
              </>
            ) : (
              /* Invalid invite */
              <>
                <div className="space-y-2 text-center">
                  <BlurFade delay={0.4} duration={0.5}>
                    <h1
                      className="text-[1.75rem] font-light leading-tight tracking-[0.2em]"
                      style={{ color: 'var(--text-primary)', ...serifFont }}
                    >
                      {preview ? INVALID_TITLES[preview.reason] : INVALID_TITLES.not_found}
                    </h1>
                  </BlurFade>

                  <BlurFade delay={0.5} duration={0.5}>
                    <p
                      className="text-sm font-light"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      El enlace ya no es válido
                    </p>
                  </BlurFade>
                </div>

                <BlurFade delay={0.55} duration={0.4}>
                  {user ? (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-11 w-full text-sm font-normal tracking-wide"
                      onClick={() => navigate('/skies')}
                    >
                      Ir a mis cielos
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="lg"
                      className="h-11 w-full text-sm font-normal tracking-wide"
                      onClick={() => navigate('/login')}
                    >
                      Iniciar sesión
                    </Button>
                  )}
                </BlurFade>
              </>
            )}
          </div>
        </BlurFade>
      </div>
    </div>
  )
}
