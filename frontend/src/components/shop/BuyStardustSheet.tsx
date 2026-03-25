import { useState } from 'react'
import confetti from 'canvas-confetti'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BlurFade } from '@/components/ui/blur-fade'
import { PackageCard, type PackageTier } from '@/components/shop/PackageCard'
import { showStardustToast } from '@/components/economy/StardustToast'
import { STARDUST_PACKAGES, getStardustPackage } from '@/domain/stardustPackages'
import { api, ApiError } from '@/lib/api/client'
import { toast } from 'sonner'
import type { PaymentStatus } from '@/domain/contracts'

interface BuyStardustSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPurchaseComplete: () => void
}

interface CreatePaymentResponse {
  paymentId: string
  reference: string
  amountInCents: number
  currency: 'COP'
  integritySignature: string
  publicKey: string
}

interface PaymentStatusResponse {
  status: PaymentStatus
  stardustAmount: number
}

const TIERS: PackageTier[] = ['basic', 'mid', 'high', 'premium', 'legendary']

const MAX_POLL_ATTEMPTS = 15
const POLL_INTERVAL_MS = 2000

// Singleton promise to avoid loading the widget script multiple times
let wompiPromise: Promise<void> | null = null

function loadWompiWidget(): Promise<void> {
  if (window.WidgetCheckout) return Promise.resolve()
  if (wompiPromise) return wompiPromise
  wompiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.wompi.co/widget.js'
    script.onload = () => resolve()
    script.onerror = () => {
      wompiPromise = null
      reject(new Error('No se pudo cargar el widget de pago'))
    }
    document.head.appendChild(script)
  })
  return wompiPromise
}

function fireStarConfetti() {
  const defaults = {
    spread: 360,
    ticks: 50,
    gravity: 0,
    decay: 0.94,
    startVelocity: 30,
    colors: ['#FFE400', '#FFBD00', '#E89400', '#FFD700', '#FFA500'],
  }

  const shoot = () => {
    confetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ['star'] })
    confetti({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ['circle'] })
  }

  setTimeout(shoot, 0)
  setTimeout(shoot, 150)
}

export function BuyStardustSheet({ open, onOpenChange, onPurchaseComplete }: BuyStardustSheetProps) {
  const [purchasingId, setPurchasingId] = useState<string | null>(null)

  const startPolling = async (reference: string) => {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))

      try {
        const result = await api<PaymentStatusResponse>(
          `/api/payments/${reference}/status`,
        )

        if (result.status === 'approved') {
          fireStarConfetti()
          showStardustToast(result.stardustAmount, 'purchase')
          onPurchaseComplete()
          setPurchasingId(null)
          onOpenChange(false)
          return
        }

        if (result.status === 'declined' || result.status === 'error' || result.status === 'voided') {
          toast.error(
            result.status === 'declined'
              ? 'El pago fue rechazado'
              : 'Error procesando el pago',
          )
          setPurchasingId(null)
          return
        }
      } catch {
        // Network error during polling — continue trying
      }
    }

    toast.info('Tu pago está siendo procesado. El Polvo Estelar se acreditará pronto.')
    setPurchasingId(null)
  }

  const handleBuy = async (packageId: string) => {
    const pkg = getStardustPackage(packageId)
    if (!pkg) return

    setPurchasingId(packageId)

    try {
      const payment = await api<CreatePaymentResponse>('/api/payments/create', {
        method: 'POST',
        body: JSON.stringify({ packageId }),
      })

      await loadWompiWidget()

      if (!window.WidgetCheckout) {
        throw new Error('Widget de pago no disponible')
      }

      const checkout = new window.WidgetCheckout({
        currency: payment.currency,
        amountInCents: payment.amountInCents,
        reference: payment.reference,
        publicKey: payment.publicKey,
        signature: { integrity: payment.integritySignature },
        redirectUrl: `${window.location.origin}/shop?payment=${payment.reference}`,
      })

      checkout.open(() => {
        startPolling(payment.reference)
      })
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message || 'Error al crear el pago')
      } else {
        toast.error('Error de conexión. Intenta de nuevo.')
      }
      setPurchasingId(null)
    }
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Polvo Estelar">
      <div className="space-y-3 px-1 pt-1 pb-4">
        {STARDUST_PACKAGES.map((pkg, i) => (
          <BlurFade key={pkg.packageId} delay={0.1 + i * 0.06} duration={0.4}>
            <PackageCard
              pkg={pkg}
              tier={TIERS[i]}
              purchasing={purchasingId !== null}
              onBuy={handleBuy}
            />
          </BlurFade>
        ))}

        <BlurFade delay={0.1 + STARDUST_PACKAGES.length * 0.06} duration={0.4}>
          <p
            className="pt-2 text-center text-[11px] font-light tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Pagos seguros con Wompi · Nequi, PSE, Tarjeta
          </p>
        </BlurFade>
      </div>
    </BottomSheet>
  )
}
