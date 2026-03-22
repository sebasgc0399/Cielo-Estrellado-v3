import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase/client'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Edit3 } from 'lucide-react'
import type { StarRecord, MemberRole } from '@/domain/contracts'

interface StarOverlayProps {
  star: StarRecord & { starId: string }
  role: MemberRole
  currentUserId: string
  onClose: () => void
  onEdit: () => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function StarOverlay({ star, role, currentUserId, onClose, onEdit }: StarOverlayProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!star.imagePath) return
    let cancelled = false

    getDownloadURL(ref(storage, star.imagePath))
      .then((url) => {
        if (!cancelled) setImageUrl(url)
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [star.imagePath])

  const canEdit =
    role === 'owner' ||
    (role === 'editor' && star.authorUserId === currentUserId)

  return (
    <BottomSheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="space-y-4 px-2 pb-6"
      >
        {/* Image */}
        {imageUrl && (
          <div className="overflow-hidden rounded-xl">
            <img
              src={imageUrl}
              alt={star.title ?? 'Estrella'}
              className="w-full object-cover"
              style={{ maxHeight: 280 }}
            />
          </div>
        )}

        {/* Title */}
        {star.title && (
          <h2
            className="text-xl font-light leading-tight tracking-wide"
            style={{
              color: 'var(--text-primary)',
              fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
            }}
          >
            {star.title}
          </h2>
        )}

        {/* Message */}
        {star.message && (
          <p
            className="whitespace-pre-wrap text-sm font-light leading-loose"
            style={{ color: 'var(--text-secondary)' }}
          >
            {star.message}
          </p>
        )}

        <Separator className="opacity-20" />

        {/* Meta */}
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {formatDate(star.createdAt)}
            {star.year != null && ` · ${star.year}`}
          </p>

          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={onEdit}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Editar
            </Button>
          )}
        </div>
      </motion.div>
    </BottomSheet>
  )
}
