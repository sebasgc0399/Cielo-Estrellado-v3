import { useState, useCallback, useRef, useEffect } from 'react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { api } from '@/lib/api/client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { SkyRecord, SkyTheme, SkyDensity } from '@/domain/contracts'
import type { SkyConfig } from '@/engine/SkyEngine'

interface SkySettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sky: SkyRecord
  skyId: string
  onConfigChange: (config: SkyConfig) => void
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
  onConfigChange,
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

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Configuración">
      <div className="px-1 pb-6 pt-2 space-y-5">
        {/* Section A - Efectos visuales */}
        <div>
          <h3 className="text-xs tracking-wide uppercase text-muted mb-3">
            Efectos visuales
          </h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
              Nebulosa
            </span>
            <Switch checked={localConfig.nebula} onCheckedChange={handleNebulaChange} />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
              Parpadeo
            </span>
            <Switch checked={localConfig.twinkle} onCheckedChange={handleTwinkleChange} />
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
              Estrellas fugaces
            </span>
            <Switch checked={localConfig.shootingStars} onCheckedChange={handleShootingStarsChange} />
          </div>
        </div>

        <Separator className="my-1 opacity-50" />

        {/* Section B - Apariencia */}
        <div>
          <h3 className="text-xs tracking-wide uppercase text-muted mb-3">
            Apariencia
          </h3>
          <label className="text-xs tracking-wide text-muted mb-2 block">
            Tema
          </label>
          <SegmentedControl options={themeOptions} selected={theme} onChange={handleThemeChange} />

          <label className="text-xs tracking-wide text-muted mb-2 mt-4 block">
            Densidad de estrellas
          </label>
          <SegmentedControl options={densityOptions} selected={density} onChange={handleDensityChange} />
        </div>

        <Separator className="my-1 opacity-50" />

        {/* Section C - Rendimiento */}
        <div>
          <h3 className="text-xs tracking-wide uppercase text-muted mb-3">
            Rendimiento
          </h3>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm font-light" style={{ color: 'var(--text-secondary)' }}>
              Calidad alta
            </span>
            <Switch
              checked={localConfig.quality === 'high'}
              onCheckedChange={handleQualityChange}
            />
          </div>

          <label className="text-xs tracking-wide text-muted mb-2 mt-4 block">
            Movimiento
          </label>
          <SegmentedControl options={motionOptions} selected={localConfig.motion} onChange={handleMotionChange} />
        </div>
      </div>
    </BottomSheet>
  )
}
