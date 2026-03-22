import { useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useAuth } from '@/lib/auth/AuthContext'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { ArrowLeft, LogOut } from 'lucide-react'

function getInitials(name: string | null, email: string | null): string {
  if (name) {
    const parts = name.split(' ').filter(Boolean)
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase()
  }
  return email ? email[0].toUpperCase() : '?'
}

export function ProfilePage() {
  const { user, loading } = useRequireAuth()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  if (loading || !user) return <LoadingScreen />

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const displayName = user.displayName || user.email?.split('@')[0] || 'Explorador'

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SkyCanvas demo />

      <div className="relative z-10 flex h-full flex-col">
        {/* Back button */}
        <header className="px-5 pt-6 sm:px-8 sm:pt-8">
          <BlurFade delay={0.1} duration={0.4}>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => navigate('/skies')}
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
          </BlurFade>
        </header>

        {/* Centered card */}
        <div className="flex flex-1 items-center justify-center p-4">
          <BlurFade delay={0.2} duration={0.6} direction="up" offset={12}>
            <div
              className="w-full max-w-[360px] space-y-6 px-8 py-10"
              style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-card)',
                backdropFilter: 'blur(var(--glass-blur))',
                WebkitBackdropFilter: 'blur(var(--glass-blur))',
                boxShadow: 'var(--shadow-elevated), 0 0 80px rgba(140, 180, 255, 0.04)',
              }}
            >
              {/* Avatar + info */}
              <div className="flex flex-col items-center space-y-3">
                <Avatar size="lg">
                  {user.photoURL ? (
                    <AvatarImage src={user.photoURL} alt={displayName} />
                  ) : null}
                  <AvatarFallback className="text-base">
                    {getInitials(user.displayName, user.email)}
                  </AvatarFallback>
                </Avatar>

                <div className="text-center">
                  <h2
                    className="text-lg font-light tracking-wide"
                    style={{
                      color: 'var(--text-primary)',
                      fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                    }}
                  >
                    {displayName}
                  </h2>
                  {user.email && (
                    <p
                      className="mt-0.5 text-sm font-light"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {user.email}
                    </p>
                  )}
                </div>
              </div>

              <Separator className="opacity-50" />

              {/* Actions */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 w-full gap-2 text-sm font-normal tracking-wide"
                  onClick={handleSignOut}
                >
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </BlurFade>
        </div>
      </div>
    </div>
  )
}
