import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, Users, Settings, ArrowLeft } from 'lucide-react'
import type { MemberRole } from '@/domain/contracts'

interface FloatingToolbarProps {
  role: MemberRole
  creationMode?: boolean
  forceVisible?: boolean
  onAddStar: () => void
  onCollaborators: () => void
  onSettings: () => void
  onBack: () => void
}

const AUTO_HIDE_MS = 3000

export function FloatingToolbar({
  role,
  creationMode,
  forceVisible: forceVisibleProp,
  onAddStar,
  onCollaborators,
  onSettings,
  onBack,
}: FloatingToolbarProps) {
  const [visible, setVisible] = useState(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const resetTimer = useCallback(() => {
    setVisible(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!creationMode) {
      timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS)
    }
  }, [creationMode])

  useEffect(() => {
    resetTimer()

    const onActivity = () => resetTimer()
    window.addEventListener('pointermove', onActivity)
    window.addEventListener('pointerdown', onActivity)
    window.addEventListener('keydown', onActivity)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener('pointermove', onActivity)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
    }
  }, [resetTimer])

  // Keep toolbar visible during creation mode or when forced
  useEffect(() => {
    if (forceVisibleProp || creationMode) {
      setVisible(true)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [forceVisibleProp, creationMode])

  const canEdit = role === 'owner' || role === 'editor'

  const buttons: { icon: typeof Plus; label: string; onClick: () => void; show: boolean; active: boolean }[] = [
    { icon: ArrowLeft, label: 'Volver', onClick: onBack, show: true, active: false },
    { icon: Plus, label: 'Crear estrella', onClick: onAddStar, show: canEdit, active: !!creationMode },
    { icon: Users, label: 'Colaboradores', onClick: onCollaborators, show: role === 'owner', active: false },
    { icon: Settings, label: 'Configuración', onClick: onSettings, show: true, active: false },
  ]

  const visibleButtons = buttons.filter(b => b.show)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed z-30 bottom-6 left-1/2 -translate-x-1/2 md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:translate-x-0"
        >
          <div
            className="flex items-center gap-1 rounded-full px-2 py-1.5 md:flex-col md:px-1.5 md:py-2"
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              backdropFilter: 'blur(var(--glass-blur))',
              WebkitBackdropFilter: 'blur(var(--glass-blur))',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 48px rgba(140, 180, 255, 0.06)',
            }}
          >
            {visibleButtons.map(({ icon: Icon, label, onClick, active }) => (
              <button
                key={label}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick()
                }}
                className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150 ${
                  active
                    ? 'bg-white/[0.12]'
                    : 'hover:bg-white/[0.08] active:bg-white/[0.12]'
                }`}
                aria-label={label}
                title={label}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  style={{ color: active ? 'var(--accent-color, #8cb4ff)' : 'var(--text-secondary)' }}
                  strokeWidth={1.5}
                />
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
