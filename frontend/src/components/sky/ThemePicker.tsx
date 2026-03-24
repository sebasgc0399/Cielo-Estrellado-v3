import { useState } from 'react'
import { getAllThemes } from '@/domain/themes'
import { cn } from '@/lib/utils'
import type { InventoryItem } from '@/domain/contracts'

interface ThemePickerProps {
  currentThemeId: string | null
  onThemeChange: (themeId: string) => Promise<void>
  inventory: InventoryItem[]
}

export function ThemePicker({ currentThemeId, onThemeChange, inventory }: ThemePickerProps) {
  const [applying, setApplying] = useState<string | null>(null)

  const ownedThemeIds = new Set(
    inventory.filter(i => i.category === 'theme').map(i => i.itemId),
  )

  const availableThemes = getAllThemes().filter(
    t => t.id === 'classic' || ownedThemeIds.has(`theme-${t.id}`),
  )

  const activeId = currentThemeId ?? 'classic'

  const handleClick = async (themeId: string) => {
    if (themeId === activeId || applying) return
    setApplying(themeId)
    try {
      await onThemeChange(themeId)
    } finally {
      setApplying(null)
    }
  }

  return (
    <div className="flex gap-2 overflow-x-auto p-1 pb-2 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
      {availableThemes.map(theme => {
        const isActive = theme.id === activeId
        const isApplying = applying === theme.id

        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => handleClick(theme.id)}
            disabled={isApplying}
            className={cn(
              'flex w-20 shrink-0 snap-start flex-col items-center gap-1 rounded-lg p-1 transition-all',
              isActive
                ? 'ring-2 ring-[#FFD700]'
                : 'border border-white/[0.08] hover:border-white/[0.16]',
              isApplying && 'animate-pulse opacity-60',
            )}
          >
            <div
              className="h-12 w-full rounded-md"
              style={{
                background: `linear-gradient(135deg, ${theme.colors.nebulaBaseStartColor}, ${theme.colors.nebulaBaseEndColor})`,
              }}
            />
            <span
              className="w-full truncate text-center text-[10px] font-light"
              style={{ color: 'var(--text-secondary)' }}
            >
              {theme.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}
