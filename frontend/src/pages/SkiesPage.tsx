import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useUserEconomy } from '@/hooks/useUserEconomy'
import { api, ApiError } from '@/lib/api/client'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { motion } from 'motion/react'
import { Plus, Pencil, Trash2, Store } from 'lucide-react'
import { ShimmerButton } from '@/components/ui/shimmer-button'
import { getInitials } from '@/lib/getInitials'
import { StardustBalance } from '@/components/economy/StardustBalance'
import { StreakIndicator } from '@/components/economy/StreakIndicator'
import { DailyRewardModal } from '@/components/economy/DailyRewardModal'
import { TransactionHistory } from '@/components/economy/TransactionHistory'
import { StardustOnboarding } from '@/components/economy/StardustOnboarding'
import { PurchaseDialog } from '@/components/economy/PurchaseDialog'
import type { SkyRecord, MemberRole } from '@/domain/contracts'
import { SKY_TITLE_MAX_LENGTH } from '@/domain/policies'
import { getShopItem } from '@/domain/shopCatalog'
import { useTour } from '@/hooks/useTour'
import { skiesWelcomeSteps } from '@/tours/skiesWelcomeTour'

type SkyEntry = { skyId: string; sky: SkyRecord; role: MemberRole }
type SkiesResponse = { skies: SkyEntry[] }

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: 'Dueño',
  editor: 'Editor',
  viewer: 'Lector',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function SkiesPage() {
  const { user, loading: authLoading } = useRequireAuth()
  const { economy, error: economyError, refetch } = useUserEconomy()
  const navigate = useNavigate()

  const [showRewards, setShowRewards] = useState(true)
  const [skies, setSkies] = useState<SkyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem('cielo-estrellado:stardust-onboarding-dismissed') === 'true'
  )
  const [purchaseOpen, setPurchaseOpen] = useState(false)

  // Edit state
  const [editEntry, setEditEntry] = useState<SkyEntry | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete state
  const [deleteEntry, setDeleteEntry] = useState<SkyEntry | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // Tour: filter steps for elements that exist in DOM
  const tourSteps = useMemo(
    () => skiesWelcomeSteps.filter(step => {
      if (step.element === '[data-tour="streak-indicator"]') {
        return document.querySelector('[data-tour="streak-indicator"]') !== null
      }
      return true
    }),
    [economy?.loginStreak]
  )

  const { isActive: tourActive } = useTour({
    tourId: 'skies-welcome',
    steps: tourSteps,
    enabled: economy !== null && economy.loginStreak <= 1 && !showRewards,
  })

  const dismissOnboarding = useCallback(() => {
    setOnboardingDismissed(true)
    localStorage.setItem('cielo-estrellado:stardust-onboarding-dismissed', 'true')
  }, [])

  const handleHistoryOpen = useCallback(() => setHistoryOpen(true), [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    api<SkiesResponse>('/api/skies')
      .then((res) => {
        if (!cancelled) setSkies(res.skies)
      })
      .catch(() => {
        if (!cancelled) toast.error('Error al cargar tus cielos')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    if (economyError) {
      toast.error('No se pudieron cargar los datos de economía')
    }
  }, [economyError])

  if (authLoading || !user) return <LoadingScreen />

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return

    setCreating(true)
    try {
      const res = await api<{ skyId: string }>('/api/skies', {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      setSheetOpen(false)
      setNewTitle('')
      navigate(`/sky/${res.skyId}`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setSheetOpen(false)
        setPurchaseOpen(true)
      } else {
        toast.error('Error al crear el cielo')
      }
    } finally {
      setCreating(false)
    }
  }

  const handlePurchaseSkySlot = async () => {
    try {
      await api<{ newBalance: number; itemId: string }>('/api/shop/purchase', {
        method: 'POST',
        body: JSON.stringify({ itemId: 'sky-slot' }),
      })
      refetch()
      toast.success('¡Nuevo espacio desbloqueado!')
      setPurchaseOpen(false)
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message || 'Error al comprar el espacio')
      } else {
        toast.error('Error de conexión')
      }
    }
  }

  const handleEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editEntry) return
    const title = editTitle.trim()
    if (!title) return

    setSaving(true)
    try {
      await api(`/api/skies/${editEntry.skyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      setSkies(prev => prev.map(s =>
        s.skyId === editEntry.skyId
          ? { ...s, sky: { ...s.sky, title } }
          : s
      ))
      toast.success('Nombre actualizado')
      setEditEntry(null)
    } catch {
      toast.error('Error al actualizar el nombre')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteEntry) return

    setDeleting(true)
    try {
      await api(`/api/skies/${deleteEntry.skyId}`, { method: 'DELETE' })
      setSkies(prev => prev.filter(s => s.skyId !== deleteEntry.skyId))
      toast.success('Cielo eliminado')
      setDeleteEntry(null)
      setDeleteConfirmText('')
    } catch {
      toast.error('Error al eliminar el cielo')
    } finally {
      setDeleting(false)
    }
  }

  const openEdit = (entry: SkyEntry) => {
    setEditTitle(entry.sky.title)
    setEditEntry(entry)
  }

  const openDelete = (entry: SkyEntry) => {
    setDeleteConfirmText('')
    setDeleteEntry(entry)
  }

  const displayName = user.displayName || user.email?.split('@')[0] || 'Explorador'

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SkyCanvas demo />

      <div className="relative z-10 flex h-full flex-col">
        {/* Header */}
        <header className="px-5 pt-6 pb-2 sm:px-8 sm:pt-8">
          {/* Row 1: Identity — name left, avatar right */}
          <div className="flex items-center justify-between gap-4">
            <BlurFade delay={0.15} duration={0.5}>
              <div className="min-w-0">
                <p
                  className="text-sm font-light tracking-wide"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Bienvenido de vuelta
                </p>
                <h1
                  className="truncate text-xl font-light tracking-[0.08em] sm:text-2xl"
                  style={{
                    color: 'var(--text-primary)',
                    fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                  }}
                >
                  {displayName}
                </h1>
              </div>
            </BlurFade>

            <BlurFade delay={0.2} duration={0.4}>
              <button
                onClick={() => navigate('/profile')}
                className="shrink-0 rounded-full transition-opacity hover:opacity-80"
              >
                <Avatar size="default">
                  {user.photoURL ? (
                    <AvatarImage src={user.photoURL} alt={displayName} />
                  ) : null}
                  <AvatarFallback>{getInitials(user.displayName, user.email)}</AvatarFallback>
                </Avatar>
              </button>
            </BlurFade>
          </div>

          {/* Row 2: Economy bar — streak left, balance + store right */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <BlurFade delay={0.25} duration={0.4}>
              <div>
                {economy ? (
                  economy.loginStreak > 0 ? (
                    <div data-tour="streak-indicator">
                      <StreakIndicator
                        currentStreak={economy.loginStreak}
                        previousStreak={economy.previousStreak}
                      />
                    </div>
                  ) : null
                ) : (
                  <div className="h-5 w-32 animate-pulse rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
                )}
              </div>
            </BlurFade>

            <div className="flex items-center gap-2">
              {economy ? (
                <BlurFade delay={0.28} duration={0.4}>
                  <div data-tour="stardust-balance">
                    <StardustBalance balance={economy.stardust} compact onClick={handleHistoryOpen} />
                  </div>
                </BlurFade>
              ) : (
                <div className="h-7 w-16 animate-pulse rounded-full" style={{ background: 'rgba(255,255,255,0.04)' }} />
              )}
              <BlurFade delay={0.3} duration={0.4}>
                <button
                  onClick={() => navigate('/shop')}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors hover:bg-white/[0.08]"
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                  aria-label="Tienda"
                  data-tour="store-button"
                >
                  <Store className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                  <span
                    className="hidden min-[360px]:inline text-xs font-light tracking-wide"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Tienda
                  </span>
                </button>
              </BlurFade>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-5 pt-4 pb-28 sm:px-8">
          {economy && !onboardingDismissed && !tourActive && economy.stardust <= 100 && economy.loginStreak <= 1 && (
            <StardustOnboarding onDismiss={dismissOnboarding} />
          )}

          {loading ? (
            <div className="flex items-center justify-center pt-24">
              <div
                className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: 'var(--accent-color)', borderTopColor: 'transparent' }}
              />
            </div>
          ) : skies.length === 0 ? (
            /* Empty state */
            <BlurFade delay={0.3} duration={0.6}>
              <div className="flex flex-col items-center justify-center pt-16 text-center">
                {/* Celestial illustration */}
                <div className="relative mb-8 h-28 w-28">
                  {/* Glow halo */}
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: 'radial-gradient(circle, rgba(140, 180, 255, 0.1) 0%, transparent 70%)',
                    }}
                  />
                  {/* Moon + stars SVG */}
                  <motion.svg
                    viewBox="0 0 112 112"
                    fill="none"
                    className="relative h-full w-full"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                  >
                    {/* Crescent moon */}
                    <motion.path
                      d="M56 28C56 44.5685 44.5685 56 28 56C44.5685 56 56 67.4315 56 84C56 67.4315 67.4315 56 84 56C67.4315 56 56 44.5685 56 28Z"
                      fill="url(#moonGrad)"
                      filter="drop-shadow(0 0 12px rgba(140, 180, 255, 0.3))"
                      animate={{ scale: [1, 1.04, 1] }}
                      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    {/* Small stars */}
                    <motion.circle
                      cx="26" cy="30" r="1.5"
                      fill="rgba(255, 255, 255, 0.6)"
                      animate={{ opacity: [0.3, 0.8, 0.3] }}
                      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    />
                    <motion.circle
                      cx="82" cy="26" r="1"
                      fill="rgba(255, 255, 255, 0.5)"
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut', delay: 0.5 }}
                    />
                    <motion.circle
                      cx="90" cy="42" r="1.2"
                      fill="rgba(255, 255, 255, 0.4)"
                      animate={{ opacity: [0.2, 0.7, 0.2] }}
                      transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
                    />
                    <motion.circle
                      cx="20" cy="70" r="0.8"
                      fill="rgba(255, 255, 255, 0.5)"
                      animate={{ opacity: [0.4, 0.9, 0.4] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', delay: 0.8 }}
                    />
                    <motion.circle
                      cx="88" cy="78" r="1.3"
                      fill="rgba(255, 255, 255, 0.45)"
                      animate={{ opacity: [0.3, 0.8, 0.3] }}
                      transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
                    />
                    {/* Tiny accent star — 4-pointed */}
                    <motion.path
                      d="M36 82L37 79L38 82L41 83L38 84L37 87L36 84L33 83L36 82Z"
                      fill="rgba(255, 215, 0, 0.6)"
                      animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.2, 1] }}
                      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                    />
                    <defs>
                      <linearGradient id="moonGrad" x1="28" y1="28" x2="84" y2="84">
                        <stop offset="0%" stopColor="rgb(140, 180, 255)" />
                        <stop offset="100%" stopColor="rgba(140, 180, 255, 0.6)" />
                      </linearGradient>
                    </defs>
                  </motion.svg>
                </div>

                <h2
                  className="mb-2 text-xl font-light tracking-wide"
                  style={{
                    color: 'var(--text-primary)',
                    fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                  }}
                >
                  Tu primer cielo te espera
                </h2>
                <p
                  className="mb-8 max-w-[260px] text-sm font-light leading-relaxed"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Crea un cielo para guardar tus estrellas y compartirlas con quienes más quieres.
                </p>
                <ShimmerButton
                  shimmerColor="rgba(140, 180, 255, 0.5)"
                  background="rgba(140, 180, 255, 0.1)"
                  className="gap-2 text-sm font-light tracking-wide"
                  onClick={() => setSheetOpen(true)}
                  data-tour="create-sky-fab"
                >
                  <Plus className="h-4 w-4" />
                  Crear mi primer cielo
                </ShimmerButton>
              </div>
            </BlurFade>
          ) : (
            /* Sky grid */
            <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
              {skies.map((entry, i) => (
                <BlurFade key={entry.skyId} delay={0.2 + i * 0.08} duration={0.4}>
                  <button
                    onClick={() => navigate(`/sky/${entry.skyId}`)}
                    className="group w-full text-left transition-all duration-200"
                    style={{
                      background: 'var(--glass-bg)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 'var(--radius-card)',
                      backdropFilter: 'blur(var(--glass-blur))',
                      WebkitBackdropFilter: 'blur(var(--glass-blur))',
                      boxShadow: 'var(--shadow-elevated)',
                    }}
                  >
                    <div className="p-5">
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <h3
                          className="text-base font-light tracking-wide transition-colors duration-200 group-hover:text-[var(--accent-color)]"
                          style={{
                            color: 'var(--text-primary)',
                            fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                          }}
                        >
                          {entry.sky.title}
                        </h3>
                        <Badge variant="outline" className="shrink-0 text-[10px] tracking-wider uppercase">
                          {ROLE_LABELS[entry.role]}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <p
                          className="text-xs font-light tracking-wide"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {formatDate(entry.sky.createdAt)}
                        </p>
                        {entry.role === 'owner' && (
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); openEdit(entry) }}
                              className="rounded-md p-1.5 transition-colors hover:bg-white/[0.08]"
                              aria-label="Editar nombre"
                            >
                              <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); openDelete(entry) }}
                              className="rounded-md p-1.5 transition-colors hover:bg-red-400/10"
                              aria-label="Eliminar cielo"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-400/70" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </BlurFade>
              ))}
            </div>
          )}
        </main>

        {/* Floating action button */}
        {skies.length > 0 && (
          <BlurFade delay={0.5} duration={0.4}>
            <button
              onClick={() => setSheetOpen(true)}
              className="fixed right-6 bottom-6 z-20 flex h-14 w-14 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 active:scale-95 animate-[fab-glow_3s_ease-in-out_infinite]"
              style={{
                background: 'radial-gradient(circle at 40% 40%, rgba(180, 210, 255, 0.25), rgba(100, 150, 255, 0.08))',
                border: '1px solid rgba(180, 210, 255, 0.20)',
                boxShadow: '0 0 20px rgba(140, 180, 255, 0.15), 0 4px 12px rgba(0, 0, 0, 0.3)',
              }}
              aria-label="Crear nuevo cielo"
              data-tour="create-sky-fab"
            >
              <span
                className="text-2xl"
                style={{
                  color: 'rgba(200, 220, 255, 0.9)',
                  filter: 'drop-shadow(0 0 6px rgba(180, 210, 255, 0.5))',
                }}
              >
                ✦
              </span>
            </button>
          </BlurFade>
        )}
      </div>

      {/* Create sky bottom sheet */}
      <BottomSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Nuevo cielo"
      >
        <form onSubmit={handleCreate} className="space-y-5 px-1 pt-2 pb-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="sky-title"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Nombre del cielo
            </Label>
            <Input
              id="sky-title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Mi cielo estrellado"
              maxLength={SKY_TITLE_MAX_LENGTH}
              required
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
            <p
              className="text-right text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {newTitle.length}/{SKY_TITLE_MAX_LENGTH}
            </p>
          </div>
          <Button
            type="submit"
            variant="glass"
            size="lg"
            className="h-11 w-full tracking-wide"
            disabled={!newTitle.trim() || creating}
          >
            {creating ? 'Creando...' : 'Crear cielo'}
          </Button>
        </form>
      </BottomSheet>

      {/* Edit sky name bottom sheet */}
      <BottomSheet
        open={editEntry !== null}
        onOpenChange={(open) => { if (!open) setEditEntry(null) }}
        title="Editar cielo"
      >
        <form onSubmit={handleEdit} className="space-y-5 px-1 pt-2 pb-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="edit-sky-title"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Nombre del cielo
            </Label>
            <Input
              id="edit-sky-title"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Mi cielo estrellado"
              maxLength={SKY_TITLE_MAX_LENGTH}
              required
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
            <p
              className="text-right text-[11px]"
              style={{ color: 'var(--text-muted)' }}
            >
              {editTitle.length}/{SKY_TITLE_MAX_LENGTH}
            </p>
          </div>
          <Button
            type="submit"
            variant="glass"
            size="lg"
            className="h-11 w-full tracking-wide"
            disabled={!editTitle.trim() || saving}
          >
            {saving ? 'Guardando...' : 'Guardar'}
          </Button>
        </form>
      </BottomSheet>

      {/* Delete confirmation dialog */}
      <Dialog open={deleteEntry !== null} onOpenChange={(open) => { if (!open) { setDeleteEntry(null); setDeleteConfirmText('') } }}>
        <DialogContent
          style={{
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(var(--glass-blur))',
            WebkitBackdropFilter: 'blur(var(--glass-blur))',
            border: '1px solid var(--glass-border)',
          }}
        >
          <DialogHeader>
            <DialogTitle style={{ color: 'var(--text-primary)' }}>
              Eliminar {deleteEntry?.sky.title}
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Se eliminarán todas las estrellas, miembros e invitaciones. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label
              htmlFor="delete-confirm"
              className="text-xs font-normal tracking-wide"
              style={{ color: 'var(--text-secondary)' }}
            >
              Escribe <span className="font-medium text-[var(--text-primary)]">{deleteEntry?.sky.title}</span> para confirmar
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteEntry?.sky.title}
              autoFocus
              className="h-10 bg-white/[0.03] border-white/[0.08] placeholder:text-white/20"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => { setDeleteEntry(null); setDeleteConfirmText('') }}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="glass-danger"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmText !== deleteEntry?.sky.title}
            >
              {deleting ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showRewards && economy?.rewards && economy.rewards.daily > 0 && (
        <DailyRewardModal
          rewards={economy.rewards}
          previousStreak={economy.previousStreak}
          onClose={() => setShowRewards(false)}
        />
      )}

      <TransactionHistory open={historyOpen} onOpenChange={setHistoryOpen} />

      <PurchaseDialog
        open={purchaseOpen}
        onOpenChange={setPurchaseOpen}
        itemName="Espacio para cielo"
        price={getShopItem('sky-slot')!.price}
        currentBalance={economy?.stardust ?? 0}
        onConfirm={handlePurchaseSkySlot}
      />
    </div>
  )
}
