import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useUserEconomy } from '@/hooks/useUserEconomy'
import { api, ApiError } from '@/lib/api/client'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { StardustBalance } from '@/components/economy/StardustBalance'
import { PurchaseDialog } from '@/components/economy/PurchaseDialog'
import { ThemePreviewCard } from '@/components/shop/ThemePreviewCard'
import { getShopItemsByCategory } from '@/domain/shopCatalog'
import { getThemeDefinition } from '@/domain/themes'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import type { ShopItem } from '@/domain/shopCatalog'

const themeItems = getShopItemsByCategory('theme')

export function ShopPage() {
  const { loading: authLoading } = useRequireAuth()
  const { economy, loading: economyLoading, refetch } = useUserEconomy()
  const navigate = useNavigate()

  const [purchaseItem, setPurchaseItem] = useState<ShopItem | null>(null)

  if (authLoading || economyLoading || !economy) return <LoadingScreen />

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
          <StardustBalance balance={economy.stardust} compact />
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

        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 md:grid-cols-3">
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
      </main>

      {purchaseItem && (
        <PurchaseDialog
          open={purchaseItem !== null}
          onOpenChange={(open) => { if (!open) setPurchaseItem(null) }}
          itemName={purchaseItem.name}
          price={purchaseItem.price}
          currentBalance={economy.stardust}
          onConfirm={handlePurchase}
        />
      )}
    </div>
  )
}
