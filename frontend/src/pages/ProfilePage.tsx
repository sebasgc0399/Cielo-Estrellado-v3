import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useAuth } from '@/lib/auth/AuthContext'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import {
  ArrowLeft,
  LogOut,
  Trash2,
  FileText,
  Shield,
  ChevronRight,
  Mail,
} from 'lucide-react'
import { getInitials } from '@/lib/getInitials'
import { toast } from 'sonner'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
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

function formatMemberSince(dateString: string): string {
  const date = new Date(dateString)
  const month = date.toLocaleDateString('es', { month: 'long' })
  const year = date.getFullYear()
  return `Miembro desde ${month} ${year}`
}

const CONFIRMATION_WORD = 'ELIMINAR'

export function ProfilePage() {
  const { user, loading } = useRequireAuth()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [confirmInput, setConfirmInput] = useState('')

  if (loading || !user) return <LoadingScreen />

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  const handleDeleteRequest = () => {
    setDeleteDialogOpen(false)
    setConfirmInput('')
    toast.info(
      'Para eliminar tu cuenta, contacta a sebasgc0399@gmail.com. Procesaremos tu solicitud en maximo 15 dias habiles.',
    )
  }

  const displayName = user.displayName || user.email?.split('@')[0] || 'Explorador'
  const isGoogle = user.providers.includes('google.com')

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
              {/* Section 1 — Profile */}
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
                      fontFamily:
                        "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                    }}
                  >
                    {displayName}
                  </h2>
                  <div className="mt-1.5 flex items-center justify-center gap-1.5">
                    {isGoogle ? (
                      <GoogleIcon className="h-3.5 w-3.5" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                    )}
                    {user.email && (
                      <p
                        className="text-sm font-light"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {user.email}
                      </p>
                    )}
                  </div>
                  {user.createdAt && (
                    <p
                      className="mt-1 text-xs font-light"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatMemberSince(user.createdAt)}
                    </p>
                  )}
                </div>
              </div>

              {/* Section 2 — Legal */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <Separator className="flex-1 opacity-30" />
                  <span
                    className="text-[11px] font-light tracking-[0.2em] uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Legal
                  </span>
                  <Separator className="flex-1 opacity-30" />
                </div>

                <div className="space-y-1.5">
                  <a
                    href="/legal/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.06]"
                    style={{ border: '1px solid transparent' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--glass-border)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'transparent'
                    }}
                  >
                    <FileText className="h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    <span
                      className="flex-1 text-sm font-light tracking-wide"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Terminos de Servicio
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </a>

                  <a
                    href="/legal/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-200 hover:bg-white/[0.06]"
                    style={{ border: '1px solid transparent' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--glass-border)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'transparent'
                    }}
                  >
                    <Shield className="h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    <span
                      className="flex-1 text-sm font-light tracking-wide"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      Politica de Privacidad
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  </a>
                </div>
              </div>

              {/* Section 3 — Account */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <Separator className="flex-1 opacity-30" />
                  <span
                    className="text-[11px] font-light tracking-[0.2em] uppercase"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Cuenta
                  </span>
                  <Separator className="flex-1 opacity-30" />
                </div>

                <div className="space-y-2">
                  <Button
                    variant="ghost"
                    size="lg"
                    className="h-11 w-full gap-2 text-sm font-normal tracking-wide"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-4 w-4" />
                    Cerrar sesion
                  </Button>

                  <Button
                    variant="glass-danger"
                    size="lg"
                    className="h-11 w-full gap-2 text-sm font-normal tracking-wide"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar mi cuenta
                  </Button>
                </div>
              </div>
            </div>
          </BlurFade>
        </div>
      </div>

      {/* Delete Account Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent
          showCloseButton={false}
          style={{
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            backdropFilter: 'blur(var(--glass-blur))',
            WebkitBackdropFilter: 'blur(var(--glass-blur))',
          }}
        >
          <DialogHeader>
            <DialogTitle
              className="text-base font-light tracking-wide"
              style={{
                color: 'rgb(248, 113, 113)',
                fontFamily:
                  "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
              }}
            >
              Eliminar tu cuenta?
            </DialogTitle>
            <DialogDescription
              className="text-[13px] font-light leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              Esta accion es irreversible. Se eliminaran permanentemente:
            </DialogDescription>
          </DialogHeader>

          <ul
            className="space-y-1 pl-4 text-[13px] font-light leading-relaxed list-disc"
            style={{ color: 'var(--text-secondary)' }}
          >
            <li>Tu perfil y datos personales</li>
            <li>Todas tus estrellas y su contenido (imagenes y videos)</li>
            <li>Tu historial de transacciones</li>
          </ul>

          <p
            className="text-[13px] font-light leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            Los cielos donde eres propietario seran eliminados. Los cielos donde eres
            miembro seguiran existiendo sin ti.
          </p>

          <div className="space-y-1.5">
            <label
              htmlFor="delete-confirm"
              className="text-xs font-light tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              Escribe <span style={{ color: 'rgb(248, 113, 113)' }}>{CONFIRMATION_WORD}</span> para
              confirmar
            </label>
            <Input
              id="delete-confirm"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={CONFIRMATION_WORD}
              autoComplete="off"
              className="bg-white/[0.03] border-white/[0.08] placeholder:text-white/20 focus-visible:border-[rgb(248,113,113)]/40"
            />
          </div>

          <DialogFooter className="border-t-white/[0.06] bg-transparent">
            <Button
              variant="ghost"
              className="text-sm font-light"
              onClick={() => {
                setDeleteDialogOpen(false)
                setConfirmInput('')
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="glass-danger"
              className="text-sm font-light"
              disabled={confirmInput !== CONFIRMATION_WORD}
              onClick={handleDeleteRequest}
            >
              Eliminar cuenta permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
