import { useEffect, useRef, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, Users, Settings, ArrowLeft } from 'lucide-react'
import type { MemberRole } from '@/domain/contracts'

interface FloatingToolbarProps {
  role: MemberRole
  onAddStar: () => void
  onCollaborators: () => void
  onSettings: () => void
  onBack: () => void
}

const AUTO_HIDE_MS = 3000

export function FloatingToolbar({
  role,
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
    timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS)
  }, [])

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

  const canEdit = role === 'owner' || role === 'editor'

  const buttons: { icon: typeof Plus; label: string; onClick: () => void; show: boolean }[] = [
    { icon: ArrowLeft, label: 'Volver', onClick: onBack, show: true },
    { icon: Plus, label: 'Crear estrella', onClick: onAddStar, show: canEdit },
    { icon: Users, label: 'Colaboradores', onClick: onCollaborators, show: role === 'owner' },
    { icon: Settings, label: 'Configuración', onClick: onSettings, show: true },
  ]

  const visibleButtons = buttons.filter(b => b.show)

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2"
        >
          <div
            className="flex items-center gap-1 rounded-full px-2 py-1.5"
            style={{
              background: 'var(--glass-bg)',
              border: '1px solid var(--glass-border)',
              backdropFilter: 'blur(var(--glass-blur))',
              WebkitBackdropFilter: 'blur(var(--glass-blur))',
              boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4), 0 0 48px rgba(140, 180, 255, 0.06)',
            }}
          >
            {visibleButtons.map(({ icon: Icon, label, onClick }) => (
              <button
                key={label}
                onClick={(e) => {
                  e.stopPropagation()
                  onClick()
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-150 hover:bg-white/[0.08] active:bg-white/[0.12]"
                aria-label={label}
                title={label}
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  style={{ color: 'var(--text-secondary)' }}
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
