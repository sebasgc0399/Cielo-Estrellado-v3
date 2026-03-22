import { useEffect, useState } from 'react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase/client'
import { BottomSheet } from '@/components/ui/BottomSheet'
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
      <div className="space-y-4 px-1 pb-4">
        {/* Image */}
        {imageUrl && (
          <div className="overflow-hidden rounded-lg">
            <img
              src={imageUrl}
              alt={star.title ?? 'Estrella'}
              className="w-full object-cover"
              style={{ maxHeight: 240 }}
            />
          </div>
        )}

        {/* Title */}
        {star.title && (
          <h2
            className="text-lg font-light tracking-wide"
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
            className="whitespace-pre-wrap text-sm font-light leading-relaxed"
            style={{ color: 'var(--text-secondary)' }}
          >
            {star.message}
          </p>
        )}

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
      </div>
    </BottomSheet>
  )
}
