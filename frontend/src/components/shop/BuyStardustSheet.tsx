import { useState } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BlurFade } from '@/components/ui/blur-fade'
import { PackageCard, type PackageTier } from '@/components/shop/PackageCard'
import { STARDUST_PACKAGES, getStardustPackage } from '@/domain/stardustPackages'
import { api, ApiError } from '@/lib/api/client'
import { toast } from 'sonner'

interface BuyStardustSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface CreatePaymentResponse {
  paymentId: string
  reference: string
  amountInCents: number
  currency: 'COP'
  integritySignature: string
  publicKey: string
}

const TIERS: PackageTier[] = ['basic', 'mid', 'high', 'premium', 'legendary']

export function BuyStardustSheet({ open, onOpenChange }: BuyStardustSheetProps) {
  const [purchasingId, setPurchasingId] = useState<string | null>(null)

  const handleBuy = async (packageId: string) => {
    const pkg = getStardustPackage(packageId)
    if (!pkg) return

    setPurchasingId(packageId)

    try {
      const payment = await api<CreatePaymentResponse>('/api/payments/create', {
        method: 'POST',
        body: JSON.stringify({ packageId }),
      })

      const redirectUrl = `${window.location.origin}/shop?payment=${payment.reference}`

      const checkoutUrl = new URL('https://checkout.wompi.co/p/')
      checkoutUrl.searchParams.set('public-key', payment.publicKey)
      checkoutUrl.searchParams.set('currency', payment.currency)
      checkoutUrl.searchParams.set('amount-in-cents', String(payment.amountInCents))
      checkoutUrl.searchParams.set('reference', payment.reference)
      checkoutUrl.searchParams.set('signature:integrity', payment.integritySignature)
      checkoutUrl.searchParams.set('redirect-url', redirectUrl)

      window.location.href = checkoutUrl.toString()
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
