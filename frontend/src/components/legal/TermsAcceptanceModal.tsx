import { useState } from 'react'
import { useAuth } from '@/lib/auth/AuthContext'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

const TERMS_VERSION = '2026-03-29'

export function TermsAcceptanceModal() {
  const { needsTerms, acceptTerms, signOut } = useAuth()
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!needsTerms) return null

  const handleAccept = async () => {
    setSubmitting(true)
    try {
      await acceptTerms(TERMS_VERSION)
    } catch {
      toast.error('Error al aceptar los terminos. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecline = async () => {
    await signOut()
  }

  return (
    <Dialog open modal>
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
              color: 'var(--text-primary)',
              fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
            }}
          >
            Bienvenido a Cielo Estrellado
          </DialogTitle>
          <DialogDescription
            className="text-[13px] font-light leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Para continuar usando la aplicacion, acepta nuestros documentos legales.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2.5">
          <input
            type="checkbox"
            id="terms-modal"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer rounded accent-[var(--accent-color)]"
          />
          <label
            htmlFor="terms-modal"
            className="cursor-pointer text-[12px] font-light leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            Acepto los{' '}
            <a
              href="/legal/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--accent-color)' }}
            >
              Terminos de Servicio
            </a>{' '}
            y la{' '}
            <a
              href="/legal/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
              style={{ color: 'var(--accent-color)' }}
            >
              Politica de Privacidad
            </a>
          </label>
        </div>

        <DialogFooter className="border-t-white/[0.06] bg-transparent">
          <Button
            variant="ghost"
            className="text-sm font-light"
            onClick={handleDecline}
            disabled={submitting}
          >
            No acepto
          </Button>
          <Button
            variant="glass"
            className="text-sm font-light"
            disabled={!accepted || submitting}
            onClick={handleAccept}
          >
            {submitting ? 'Aceptando...' : 'Aceptar y continuar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
