import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '@/lib/auth/AuthContext'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

function getAuthErrorMessage(error: unknown, isRegister: boolean): string {
  const code = (error as { code?: string })?.code ?? ''

  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email o contraseña incorrectos'
    case 'auth/email-already-in-use':
      return 'Ya existe una cuenta con este email'
    case 'auth/weak-password':
      return 'La contraseña debe tener al menos 6 caracteres'
    case 'auth/invalid-email':
      return 'El email no es válido'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Intenta de nuevo más tarde'
    case 'auth/popup-closed-by-user':
      return 'Se cerró la ventana de Google'
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana. Permite popups e intenta de nuevo'
    default:
      return isRegister ? 'Error al crear la cuenta' : 'Error al iniciar sesión'
  }
}

export function LoginPage() {
  const { user, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const redirectTo = searchParams.get('redirect') || '/skies'

  // Already authenticated → redirect
  useEffect(() => {
    if (!loading && user) {
      navigate(redirectTo, { replace: true })
    }
  }, [user, loading, navigate, redirectTo])

  // Avoid flash while checking auth state
  if (loading || user) return null

  const handleGoogleSignIn = async () => {
    try {
      setSubmitting(true)
      await signInWithGoogle()
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error(getAuthErrorMessage(err, false))
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (isRegister) {
        await signUpWithEmail(email, password)
      } else {
        await signInWithEmail(email, password)
      }
      navigate(redirectTo, { replace: true })
    } catch (err) {
      toast.error(getAuthErrorMessage(err, isRegister))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Animated sky background */}
      <SkyCanvas demo />

      {/* Login card overlay */}
      <div className="relative z-10 flex h-full items-center justify-center p-4">
        <BlurFade delay={0.2} duration={0.6} direction="up" offset={12}>
          <div
            className="w-full max-w-[380px] space-y-6 px-8 py-10"
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius-card)',
              backdropFilter: 'blur(var(--glass-blur))',
              WebkitBackdropFilter: 'blur(var(--glass-blur))',
              boxShadow: 'var(--shadow-elevated), 0 0 80px rgba(140, 180, 255, 0.04)',
            }}
          >
            {/* Header */}
            <div className="space-y-2 text-center">
              <BlurFade delay={0.4} duration={0.5}>
                <h1
                  className="text-[1.75rem] font-light leading-tight tracking-[0.2em]"
                  style={{
                    color: 'var(--text-primary)',
                    fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                  }}
                >
                  Cielo Estrellado
                </h1>
              </BlurFade>
              <BlurFade delay={0.5} duration={0.5}>
                <p
                  className="text-sm font-light tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isRegister ? 'Crea tu cuenta para comenzar' : 'Tu cielo te espera'}
                </p>
              </BlurFade>
            </div>

            {/* Google button */}
            <BlurFade delay={0.55} duration={0.4}>
              <Button
                variant="outline"
                size="lg"
                className="h-11 w-full gap-2.5 text-sm font-normal tracking-wide"
                onClick={handleGoogleSignIn}
                disabled={submitting}
              >
                <GoogleIcon />
                Continuar con Google
              </Button>
            </BlurFade>

            {/* Separator */}
            <BlurFade delay={0.6} duration={0.4}>
              <div className="flex items-center gap-4">
                <Separator className="flex-1 opacity-50" />
                <span
                  className="text-xs font-light tracking-widest uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  o
                </span>
                <Separator className="flex-1 opacity-50" />
              </div>
            </BlurFade>

            {/* Email/password form */}
            <BlurFade delay={0.65} duration={0.4}>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="email"
                    className="text-xs font-normal tracking-wide"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Email
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@email.com"
                    required
                    autoComplete="email"
                    className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20 focus-visible:border-[var(--accent-color)]/40"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="password"
                    className="text-xs font-normal tracking-wide"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Contraseña
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    minLength={6}
                    className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20 focus-visible:border-[var(--accent-color)]/40"
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="h-11 w-full text-sm font-normal tracking-wide"
                  disabled={submitting}
                >
                  {submitting
                    ? (isRegister ? 'Creando cuenta...' : 'Iniciando sesión...')
                    : (isRegister ? 'Crear cuenta' : 'Iniciar sesión')}
                </Button>
              </form>
            </BlurFade>

            {/* Toggle mode */}
            <BlurFade delay={0.7} duration={0.4}>
              <p
                className="text-center text-[13px] font-light"
                style={{ color: 'var(--text-secondary)' }}
              >
                {isRegister ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
                <button
                  type="button"
                  onClick={() => setIsRegister(!isRegister)}
                  className="underline underline-offset-4 transition-colors duration-200"
                  style={{ color: 'var(--accent-color)' }}
                >
                  {isRegister ? 'Inicia sesión' : 'Crea una'}
                </button>
              </p>
            </BlurFade>
          </div>
        </BlurFade>
      </div>
    </div>
  )
}
