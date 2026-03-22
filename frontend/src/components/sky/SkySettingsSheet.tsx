import { useState, useCallback, useRef, useEffect } from 'react'
import { motion } from 'motion/react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Sparkles, Palette, Gauge, LogOut, Type } from 'lucide-react'
import type { SkyRecord, SkyTheme, SkyDensity, MemberRole } from '@/domain/contracts'
import { SKY_TITLE_MAX_LENGTH } from '@/domain/policies'
import type { SkyConfig } from '@/engine/SkyEngine'

interface SkySettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sky: SkyRecord
  skyId: string
  role: MemberRole
  onConfigChange: (config: SkyConfig) => void
  onLeave?: () => void
  onTitleChange?: (newTitle: string) => void
}

interface SegmentOption<T extends string> {
  label: string
  value: T
}

function SegmentedControl<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: SegmentOption<T>[]
  selected: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex rounded-full p-1" style={{ background: 'rgba(255, 255, 255, 0.04)' }}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-1 rounded-full px-3 py-1.5 text-xs font-light tracking-wide transition-all duration-150',
            selected === opt.value
              ? 'bg-white/[0.12] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const themeOptions: SegmentOption<SkyTheme>[] = [
  { label: 'Clásico', value: 'classic' },
  { label: 'Romántico', value: 'romantic' },
  { label: 'Noche profunda', value: 'deep-night' },
]

const densityOptions: SegmentOption<SkyDensity>[] = [
  { label: 'Baja', value: 'low' },
  { label: 'Media', value: 'medium' },
  { label: 'Alta', value: 'high' },
]

const motionOptions: SegmentOption<'mouse' | 'gyro'>[] = [
  { label: 'Ratón', value: 'mouse' },
  { label: 'Giroscopio', value: 'gyro' },
]

export function SkySettingsSheet({
  open,
  onOpenChange,
  sky,
  skyId,
  role,
  onConfigChange,
  onLeave,
  onTitleChange,
}: SkySettingsSheetProps) {
  const [localConfig, setLocalConfig] = useState<SkyConfig>(() => ({
    twinkle: sky.personalization.twinkleEnabled,
    nebula: sky.personalization.nebulaEnabled,
    shootingStars: sky.personalization.shootingStarsEnabled,
    quality: 'high',
    motion: 'mouse',
  }))
  const [theme, setTheme] = useState<SkyTheme>(sky.personalization.theme)
  const [density, setDensity] = useState<SkyDensity>(sky.personalization.density)
  const [editingTitle, setEditingTitle] = useState(sky.title)
  const [savingTitle, setSavingTitle] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const persistTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const schedulePersist = useCallback((personalization: Partial<import('@/domain/contracts').SkyPersonalization>) => {
    if (persistTimeout.current) clearTimeout(persistTimeout.current)
    persistTimeout.current = setTimeout(async () => {
      try {
        await api(`/api/skies/${skyId}`, {
          method: 'PATCH',
          body: JSON.stringify({ personalization }),
        })
      } catch {
        toast.error('Error al guardar configuración')
      }
    }, 800)
  }, [skyId])

  useEffect(() => {
    return () => {
      if (persistTimeout.current) clearTimeout(persistTimeout.current)
    }
  }, [])

  const updateConfig = useCallback((patch: Partial<SkyConfig>) => {
    setLocalConfig(prev => {
      const next = { ...prev, ...patch }
      onConfigChange(next)
      return next
    })
  }, [onConfigChange])

  const handleNebulaChange = (checked: boolean) => {
    updateConfig({ nebula: checked })
    schedulePersist({
      nebulaEnabled: checked,
      twinkleEnabled: localConfig.twinkle,
      shootingStarsEnabled: localConfig.shootingStars,
      theme,
      density,
    })
  }

  const handleTwinkleChange = (checked: boolean) => {
    updateConfig({ twinkle: checked })
    schedulePersist({
      nebulaEnabled: localConfig.nebula,
      twinkleEnabled: checked,
      shootingStarsEnabled: localConfig.shootingStars,
      theme,
      density,
    })
  }

  const handleShootingStarsChange = (checked: boolean) => {
    updateConfig({ shootingStars: checked })
    schedulePersist({
      nebulaEnabled: localConfig.nebula,
      twinkleEnabled: localConfig.twinkle,
      shootingStarsEnabled: checked,
      theme,
      density,
    })
  }

  const handleThemeChange = (value: SkyTheme) => {
    setTheme(value)
    schedulePersist({
      nebulaEnabled: localConfig.nebula,
      twinkleEnabled: localConfig.twinkle,
      shootingStarsEnabled: localConfig.shootingStars,
      theme: value,
      density,
    })
  }

  const handleDensityChange = (value: SkyDensity) => {
    setDensity(value)
    schedulePersist({
      nebulaEnabled: localConfig.nebula,
      twinkleEnabled: localConfig.twinkle,
      shootingStarsEnabled: localConfig.shootingStars,
      theme,
      density: value,
    })
  }

  const handleQualityChange = (checked: boolean) => {
    updateConfig({ quality: checked ? 'high' : 'low' })
  }

  const handleMotionChange = (value: 'mouse' | 'gyro') => {
    updateConfig({ motion: value })
  }

  const handleSaveTitle = async () => {
    const title = editingTitle.trim()
    if (!title || title === sky.title) return

    setSavingTitle(true)
    try {
      await api(`/api/skies/${skyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      })
      onTitleChange?.(title)
      toast.success('Nombre actualizado')
    } catch {
      toast.error('Error al actualizar el nombre')
    } finally {
      setSavingTitle(false)
    }
  }

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await api(`/api/skies/${skyId}/members/leave`, { method: 'POST' })
      setConfirmLeave(false)
      onOpenChange(false)
      onLeave?.()
    } catch {
      toast.error('Error al abandonar el cielo')
    } finally {
      setLeaving(false)
    }
  }

  const isOwner = role === 'owner'

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={isOwner ? 'Configuración' : 'Ajustes'}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="px-2 pb-8 pt-2 space-y-5"
        >
          {/* Section: Nombre del cielo (owner only) */}
          {isOwner && (
            <>
              <div>
                <h3 className="flex items-center gap-1.5 text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
                  <Type className="h-4 w-4" />
                  Nombre del cielo
                </h3>
                <div className="flex gap-2">
                  <Input
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    maxLength={SKY_TITLE_MAX_LENGTH}
                    className="h-9 flex-1 bg-white/[0.03] border-white/[0.08] text-sm font-light"
                  />
                  <Button
                    size="sm"
                    className="h-9 shrink-0"
                    onClick={handleSaveTitle}
                    disabled={savingTitle || !editingTitle.trim() || editingTitle.trim() === sky.title}
                  >
                    {savingTitle ? 'Guardando...' : 'Guardar'}
                  </Button>
                </div>
              </div>

              <Separator className="my-1 opacity-30" />
            </>
          )}

          {/* Section A - Efectos visuales (owner only) */}
          {isOwner && (
            <>
              <div>
                <h3 className="flex items-center gap-1.5 text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
                  <Sparkles className="h-4 w-4" />
                  Efectos visuales
                </h3>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
                    Nebulosa
                  </span>
                  <Switch checked={localConfig.nebula} onCheckedChange={handleNebulaChange} />
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
                    Parpadeo
                  </span>
                  <Switch checked={localConfig.twinkle} onCheckedChange={handleTwinkleChange} />
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
                    Estrellas fugaces
                  </span>
                  <Switch checked={localConfig.shootingStars} onCheckedChange={handleShootingStarsChange} />
                </div>
              </div>

              <Separator className="my-1 opacity-30" />

              {/* Section B - Apariencia (owner only) */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
                  <Palette className="h-4 w-4" />
                  Apariencia
                </h3>
                <label className="text-xs tracking-wide text-[var(--text-muted)] mb-2 block">
                  Tema
                </label>
                <SegmentedControl options={themeOptions} selected={theme} onChange={handleThemeChange} />

                <label className="text-xs tracking-wide text-[var(--text-muted)] mb-2 mt-4 block">
                  Densidad de estrellas
                </label>
                <SegmentedControl options={densityOptions} selected={density} onChange={handleDensityChange} />
              </div>

              <Separator className="my-1 opacity-30" />
            </>
          )}

          {/* Section C - Rendimiento (all roles) */}
          <div>
            <h3 className="flex items-center gap-1.5 text-xs tracking-wide uppercase text-[var(--text-muted)] mb-3">
              <Gauge className="h-4 w-4" />
              Rendimiento
            </h3>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
                Calidad alta
              </span>
              <Switch
                checked={localConfig.quality === 'high'}
                onCheckedChange={handleQualityChange}
              />
            </div>

            <label className="text-xs tracking-wide text-[var(--text-muted)] mb-2 mt-4 block">
              Movimiento
            </label>
            <SegmentedControl options={motionOptions} selected={localConfig.motion} onChange={handleMotionChange} />
          </div>

          {/* Leave sky (non-owner only) */}
          {!isOwner && (
            <>
              <Separator className="my-1 opacity-30" />
              <div>
                <Button
                  variant="ghost"
                  className="w-full gap-2 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  onClick={() => setConfirmLeave(true)}
                >
                  <LogOut className="h-4 w-4" />
                  Abandonar este cielo
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </BottomSheet>

      {/* Leave confirmation dialog */}
      <Dialog open={confirmLeave} onOpenChange={setConfirmLeave}>
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
              Abandonar cielo
            </DialogTitle>
            <DialogDescription style={{ color: 'var(--text-secondary)' }}>
              Perderás acceso a este cielo y sus estrellas. Necesitarás una nueva invitación para volver.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmLeave(false)}
              disabled={leaving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeave}
              disabled={leaving}
            >
              {leaving ? 'Saliendo...' : 'Abandonar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
