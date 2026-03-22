import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useRequireAuth } from '@/lib/auth/useRequireAuth'
import { useSkyData } from '@/hooks/useSkyData'
import { useSkyStars, type StarWithId } from '@/hooks/useSkyStars'
import { SkyCanvas } from '@/components/sky/SkyCanvas'
import { FloatingToolbar } from '@/components/sky/FloatingToolbar'
import { StarOverlay } from '@/components/sky/StarOverlay'
import { StarFormSheet } from '@/components/sky/StarFormSheet'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { LoadingScreen } from '@/components/ui/LoadingScreen'
import { BlurFade } from '@/components/ui/blur-fade'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import type { SkyConfig } from '@/engine/SkyEngine'

export function SkyPage() {
  const { skyId } = useParams<{ skyId: string }>()
  const { user, loading: authLoading } = useRequireAuth()
  const navigate = useNavigate()

  const { sky, role, loading: skyLoading, error } = useSkyData(skyId!)
  const { stars, userStars, loading: starsLoading } = useSkyStars(skyId!)

  // UI state
  const [selectedStar, setSelectedStar] = useState<StarWithId | null>(null)
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [formStar, setFormStar] = useState<StarWithId | null>(null)
  const [formPosition, setFormPosition] = useState<{ x: number; y: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false)

  // Build SkyConfig from personalization
  const skyConfig: SkyConfig | undefined = sky
    ? {
        twinkle: sky.personalization.twinkleEnabled,
        nebula: sky.personalization.nebulaEnabled,
        shootingStars: sky.personalization.shootingStarsEnabled,
        quality: 'high',
        motion: 'mouse',
      }
    : undefined

  // --- Handlers ---

  const handleStarTap = useCallback((starId: string) => {
    const star = stars.find(s => s.starId === starId)
    if (star) setSelectedStar(star)
  }, [stars])

  const handleEmptyTap = useCallback((nx: number, ny: number) => {
    if (role === 'owner' || role === 'editor') {
      setFormPosition({ x: nx, y: ny })
      setFormStar(null)
      setFormMode('create')
    }
  }, [role])

  const handleStarDragEnd = useCallback(async (starId: string, nx: number, ny: number): Promise<boolean> => {
    try {
      await api(`/api/skies/${skyId}/stars/${starId}`, {
        method: 'PATCH',
        body: JSON.stringify({ xNormalized: nx, yNormalized: ny }),
      })
      return true
    } catch {
      toast.error('Error al mover la estrella')
      return false
    }
  }, [skyId])

  const handleEdit = useCallback((star: StarWithId) => {
    setSelectedStar(null)
    setFormStar(star)
    setFormPosition(null)
    setFormMode('edit')
  }, [])

  const handleAddStar = useCallback(() => {
    setFormPosition(null)
    setFormStar(null)
    setFormMode('create')
  }, [])

  const handleFormSuccess = useCallback(() => {
    setFormMode(null)
    setFormStar(null)
    setFormPosition(null)
    setSelectedStar(null)
  }, [])

  // --- Loading / Error states ---

  if (authLoading || !user) return <LoadingScreen />

  if (skyLoading || starsLoading) return <LoadingScreen />

  if (error || !sky || !role) {
    return (
      <div className="relative h-full w-full overflow-hidden">
        <SkyCanvas demo />
        <div className="relative z-10 flex h-full items-center justify-center p-4">
          <BlurFade delay={0.2} duration={0.5}>
            <div
              className="max-w-sm space-y-4 px-8 py-10 text-center"
              style={{
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-card)',
                backdropFilter: 'blur(var(--glass-blur))',
                WebkitBackdropFilter: 'blur(var(--glass-blur))',
                boxShadow: 'var(--shadow-elevated)',
              }}
            >
              <h2
                className="text-lg font-light tracking-wide"
                style={{
                  color: 'var(--text-primary)',
                  fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
                }}
              >
                {error ?? 'Error al cargar el cielo'}
              </h2>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => navigate('/skies')}
              >
                <ArrowLeft className="h-4 w-4" />
                Volver a mis cielos
              </Button>
            </div>
          </BlurFade>
        </div>
      </div>
    )
  }

  const canEdit = role === 'owner' || role === 'editor'

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Interactive sky canvas */}
      <SkyCanvas
        userStars={userStars}
        config={skyConfig}
        highlightedStarId={selectedStar?.starId ?? null}
        onStarTap={handleStarTap}
        onEmptyTap={canEdit ? handleEmptyTap : undefined}
        onStarDragEnd={canEdit ? handleStarDragEnd : undefined}
      />

      {/* Floating toolbar */}
      <FloatingToolbar
        role={role}
        onAddStar={handleAddStar}
        onCollaborators={() => setCollaboratorsOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onBack={() => navigate('/skies')}
      />

      {/* Star overlay (view details) */}
      {selectedStar && (
        <StarOverlay
          star={selectedStar}
          role={role}
          currentUserId={user.uid}
          onClose={() => setSelectedStar(null)}
          onEdit={() => handleEdit(selectedStar)}
        />
      )}

      {/* Star form sheet (create/edit) */}
      {formMode && (
        <StarFormSheet
          open
          onOpenChange={(open) => { if (!open) handleFormSuccess() }}
          skyId={skyId!}
          mode={formMode}
          star={formStar ?? undefined}
          position={formPosition ?? undefined}
          onSuccess={handleFormSuccess}
        />
      )}

      {/* Settings placeholder */}
      <BottomSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Configuración"
      >
        <div className="px-1 pb-6 pt-2">
          <p className="text-sm font-light" style={{ color: 'var(--text-muted)' }}>
            Próximamente — personalización del cielo.
          </p>
        </div>
      </BottomSheet>

      {/* Collaborators placeholder */}
      <BottomSheet
        open={collaboratorsOpen}
        onOpenChange={setCollaboratorsOpen}
        title="Colaboradores"
      >
        <div className="px-1 pb-6 pt-2">
          <p className="text-sm font-light" style={{ color: 'var(--text-muted)' }}>
            Próximamente — invita a otros a tu cielo.
          </p>
        </div>
      </BottomSheet>
    </div>
  )
}
