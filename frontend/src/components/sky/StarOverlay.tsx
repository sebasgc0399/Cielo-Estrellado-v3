import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ref, getDownloadURL } from 'firebase/storage'
import { storage } from '@/lib/firebase/storage'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Edit3, X, Loader2, VolumeX, Volume2, Maximize2 } from 'lucide-react'
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

const downloadUrlCache = new Map<string, string>()

export function StarOverlay({ star, role, currentUserId, onClose, onEdit }: StarOverlayProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  const [muted, setMuted] = useState(true)

  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    setImageUrl(null)
    setVideoUrl(null)
    setThumbnailUrl(null)
    setImageLoaded(false)

    if (!star.mediaPath) return
    // Don't resolve URLs if still processing
    if (star.mediaStatus === 'processing' || star.mediaStatus === 'error') return

    let cancelled = false

    const resolveUrl = async (path: string): Promise<string | null> => {
      const cached = downloadUrlCache.get(path)
      if (cached) return cached
      try {
        const url = await getDownloadURL(ref(storage, path))
        downloadUrlCache.set(path, url)
        return url
      } catch {
        return null
      }
    }

    if (star.mediaType === 'video') {
      Promise.all([
        resolveUrl(star.mediaPath),
        star.thumbnailPath ? resolveUrl(star.thumbnailPath) : Promise.resolve(null),
      ]).then(([vidUrl, thumbUrl]) => {
        if (cancelled) return
        setVideoUrl(vidUrl)
        setThumbnailUrl(thumbUrl)
      })
    } else {
      // Image or legacy (mediaType null)
      resolveUrl(star.mediaPath).then((url) => {
        if (!cancelled) setImageUrl(url)
      })
    }

    return () => { cancelled = true }
  }, [star.mediaPath, star.mediaType, star.mediaStatus, star.thumbnailPath])

  // Reset muted when star changes
  useEffect(() => {
    setMuted(true)
  }, [star.starId])

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const canEdit =
    role === 'owner' ||
    (role === 'editor' && star.authorUserId === currentUserId)

  return (
    <>
      <BottomSheet open onOpenChange={(open) => { if (!open) onClose() }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="space-y-4 px-2 pb-6"
        >
          {/* Processing state */}
          {star.mediaStatus === 'processing' && (
            <div
              className="flex items-center justify-center gap-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', minHeight: 120, padding: '1.5rem' }}
            >
              <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Procesando clip...</p>
            </div>
          )}

          {/* Video playback */}
          {star.mediaType === 'video' && star.mediaStatus === 'ready' && (
            <div className="relative overflow-hidden rounded-xl" style={{ minHeight: 120 }}>
              {/* Skeleton shimmer while video loads */}
              {!videoUrl && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'skeleton-sweep 1.8s ease-in-out infinite',
                  }}
                />
              )}
              {videoUrl && (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    poster={thumbnailUrl ?? undefined}
                    autoPlay
                    muted={muted}
                    loop
                    playsInline
                    className="w-full rounded-xl object-contain cursor-pointer"
                    style={{ maxHeight: '50vh' }}
                    onClick={() => setMuted(prev => !prev)}
                  />
                  {/* Mute indicator */}
                  <div className="absolute bottom-3 right-3 rounded-full bg-black/50 p-1.5 pointer-events-none">
                    {muted ? (
                      <VolumeX className="h-3.5 w-3.5 text-white/70" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5 text-white/70" />
                    )}
                  </div>
                  {/* Fullscreen button — bottom-left, away from overlay close button */}
                  <button
                    onClick={() => setFullscreen(true)}
                    className="absolute bottom-3 left-3 rounded-full bg-black/50 p-1.5 transition-colors hover:bg-black/70"
                  >
                    <Maximize2 className="h-3.5 w-3.5 text-white/70" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Image display (existing + legacy support) */}
          {(star.mediaType === 'image' || (!star.mediaType && star.mediaPath)) && star.mediaStatus !== 'processing' && (
            <div className="relative overflow-hidden rounded-xl" style={{ minHeight: 120 }}>
              {/* Skeleton shimmer */}
              {!imageLoaded && (
                <div
                  className="absolute inset-0 rounded-xl"
                  style={{
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'skeleton-sweep 1.8s ease-in-out infinite',
                  }}
                />
              )}
              {/* Actual image */}
              {imageUrl && (
                <img
                  src={imageUrl}
                  alt={star.title ?? 'Estrella'}
                  className="w-full rounded-xl object-contain cursor-pointer transition-opacity duration-500 ease-out"
                  style={{ maxHeight: '50vh', opacity: imageLoaded ? 1 : 0 }}
                  onLoad={() => setImageLoaded(true)}
                  onClick={() => setFullscreen(true)}
                />
              )}
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

      {/* Fullscreen media viewer */}
      <AnimatePresence>
        {fullscreen && (videoUrl || imageUrl) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-60 flex items-center justify-center"
            style={{ background: 'rgba(5, 8, 15, 0.95)' }}
            onClick={() => setFullscreen(false)}
          >
            {star.mediaType === 'video' && videoUrl ? (
              <motion.video
                src={videoUrl}
                autoPlay
                muted={false}
                loop
                playsInline
                controls={false}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="object-contain"
                style={{ maxWidth: '95vw', maxHeight: '95vh' }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : imageUrl ? (
              <motion.img
                src={imageUrl}
                alt={star.title ?? 'Estrella'}
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.85, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="object-contain"
                style={{ maxWidth: '95vw', maxHeight: '95vh' }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : null}
            <button
              onClick={() => setFullscreen(false)}
              className="absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
