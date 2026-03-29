import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useUserEconomy } from '@/hooks/useUserEconomy'
import { api, ApiError } from '@/lib/api/client'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { StardustBalance } from '@/components/economy/StardustBalance'
import { PurchaseDialog } from '@/components/economy/PurchaseDialog'
import { ThemePreviewCard } from '@/components/shop/ThemePreviewCard'
import { BuyStardustSheet } from '@/components/shop/BuyStardustSheet'
import { getShopItemsByCategory } from '@/domain/shopCatalog'
import { getThemeDefinition } from '@/domain/themes'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { showStardustToast } from '@/components/economy/StardustToast'
import type { ShopItem } from '@/domain/shopCatalog'
import type { PaymentStatus } from '@/domain/contracts'
import { useTour } from '@/hooks/useTour'
import { shopIntroSteps } from '@/tours/shopIntroTour'

interface PaymentStatusResponse {
  status: PaymentStatus
  stardustAmount: number
}

const themeItems = getShopItemsByCategory('theme')

async function fireStarConfetti() {
  const confetti = (await import('canvas-confetti')).default
  const defaults = {
    spread: 360, ticks: 50, gravity: 0, decay: 0.94, startVelocity: 30,
    colors: ['#FFE400', '#FFBD00', '#E89400', '#FFD700', '#FFA500'],
  }
  const shoot = () => {
    confetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ['star'] })
    confetti({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ['circle'] })
  }
  setTimeout(shoot, 0)
  setTimeout(shoot, 150)
}

export function ShopPage() {
  const { loading: authLoading } = useRequireAuth()
  const { economy, loading: economyLoading, error: economyError, refetch } = useUserEconomy()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [purchaseItem, setPurchaseItem] = useState<ShopItem | null>(null)
  const [showBuySheet, setShowBuySheet] = useState(false)

  useTour({
    tourId: 'shop-intro',
    steps: shopIntroSteps,
    enabled: !economyLoading && !economyError,
  })

  useEffect(() => {
    const paymentRef = searchParams.get('payment')
    if (!paymentRef) return

    setSearchParams({}, { replace: true })
    toast.info('Verificando tu pago...')

    let cancelled = false

    const poll = async () => {
      for (let i = 0; i < 30; i++) {
        if (cancelled) return
        await new Promise(r => setTimeout(r, 2000))
        if (cancelled) return
        try {
          const result = await api<PaymentStatusResponse>(
            `/api/payments/${paymentRef}/status`,
          )
          if (result.status === 'approved') {
            fireStarConfetti()
            showStardustToast(result.stardustAmount, 'purchase')
            refetch()
            return
          }
          if (result.status === 'declined' || result.status === 'error' || result.status === 'voided') {
            toast.error(result.status === 'declined' ? 'El pago fue rechazado' : 'Error procesando el pago')
            return
          }
        } catch {
          // Network error — continue
        }
      }
      if (!cancelled) {
        toast.info('Tu pago está siendo procesado. El Polvo Estelar se acreditará pronto.')
      }
    }

    poll()

    return () => { cancelled = true }
  }, [searchParams, setSearchParams, refetch])

  if (authLoading || economyLoading) return <LoadingScreen />

  if (economyError || !economy) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6"
        style={{ background: 'var(--bg-void)' }}>
        <span className="mb-4 text-3xl">✦</span>
        <h2 className="mb-2 text-base font-medium" style={{ color: 'var(--text-primary)' }}>
          No se pudo cargar la tienda
        </h2>
        <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          Verifica tu conexión e intenta de nuevo.
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-xl px-4 py-2 text-sm"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'var(--text-primary)',
          }}
        >
          Reintentar
        </button>
      </div>
    )
  }

  const isOwned = (itemId: string) =>
    economy.inventory.some(inv => inv.itemId === itemId)

  const handlePurchase = async () => {
    if (!purchaseItem) return
    try {
      await api<{ newBalance: number; itemId: string }>('/api/shop/purchase', {
        method: 'POST',
        body: JSON.stringify({ itemId: purchaseItem.itemId }),
      })
      refetch()
      toast.success(`¡${purchaseItem.name} desbloqueado!`)
      setPurchaseItem(null)
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message || 'Error al comprar')
      } else {
        toast.error('Error de conexión')
      }
    }
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden"
      style={{ background: 'var(--bg-void)' }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 pt-6 pb-2 sm:px-8 sm:pt-8">
        <BlurFade delay={0.1} duration={0.4}>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => navigate('/skies')}
            >
              <ArrowLeft className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
            </Button>
            <h1
              className="text-xl font-light tracking-[0.08em] sm:text-2xl"
              style={{
                color: 'var(--text-primary)',
                fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
              }}
            >
              Tienda
            </h1>
          </div>
        </BlurFade>

        <BlurFade delay={0.15} duration={0.4}>
          <div data-tour="shop-balance">
            <StardustBalance balance={economy.stardust} compact />
          </div>
        </BlurFade>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto px-5 pt-4 pb-8 sm:px-8">
        <BlurFade delay={0.1} duration={0.4}>
          <p
            className="mb-4 text-sm font-light tracking-wide"
            style={{ color: 'var(--text-muted)' }}
          >
            Temas
          </p>
        </BlurFade>

        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3" data-tour="theme-grid">
          {themeItems.map((item, i) => {
            const theme = item.themeId ? getThemeDefinition(item.themeId) : null
            if (!theme) return null

            return (
              <BlurFade key={item.itemId} delay={0.15 + i * 0.06} duration={0.4}>
                <ThemePreviewCard
                  item={item}
                  theme={theme}
                  owned={isOwned(item.itemId)}
                  balance={economy.stardust}
                  onPurchase={(itemId) => {
                    const selected = themeItems.find(t => t.itemId === itemId)
                    if (selected) setPurchaseItem(selected)
                  }}
                />
              </BlurFade>
            )
          })}
        </div>

        {/* Buy Stardust CTA */}
        <BlurFade delay={0.15 + themeItems.length * 0.06 + 0.1} duration={0.4}>
          <button
            onClick={() => setShowBuySheet(true)}
            className="mt-6 flex w-full max-w-2xl mx-auto items-center gap-4 rounded-xl p-4 text-left transition-transform duration-200 hover:scale-[1.01]"
            data-tour="buy-stardust-cta"
            style={{
              background: 'linear-gradient(135deg, rgba(255,215,0,0.08), rgba(255,165,0,0.04))',
              border: '1px solid rgba(255,215,0,0.15)',
            }}
          >
            <span
              className="text-2xl shrink-0"
              style={{ filter: 'drop-shadow(0 0 8px rgba(255,215,0,0.4))' }}
            >
              ✦
            </span>
            <div>
              <p
                className="text-sm font-medium tracking-wide"
                style={{ color: '#FFD700' }}
              >
                Obtén más Polvo Estelar
              </p>
              <p
                className="text-xs font-light tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                Desde $5.000 COP · Nequi, PSE, Tarjeta
              </p>
            </div>
          </button>
        </BlurFade>
      </main>

      {purchaseItem && (
        <PurchaseDialog
          open={purchaseItem !== null}
          onOpenChange={(open) => { if (!open) setPurchaseItem(null) }}
          itemName={purchaseItem.name}
          price={purchaseItem.price}
          currentBalance={economy.stardust}
          onConfirm={handlePurchase}
          onBuyStardust={() => {
            setPurchaseItem(null)
            setShowBuySheet(true)
          }}
        />
      )}

      <BuyStardustSheet
        open={showBuySheet}
        onOpenChange={setShowBuySheet}
      />
    </div>
  )
}
