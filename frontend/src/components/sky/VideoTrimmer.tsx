import { useEffect, useRef, useState, useCallback } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Scissors } from 'lucide-react'

interface VideoTrimmerProps {
  file: File
  onConfirm: (trimStart: number, trimEnd: number) => void
  onCancel: () => void
}

const MAX_CLIP_DURATION = 6
const MIN_CLIP_DURATION = 1
const FRAME_COUNT = 10

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`
}

function clampStart(value: number, trimEnd: number): number {
  return Math.max(0, Math.min(value, trimEnd - MIN_CLIP_DURATION))
}

function clampEnd(value: number, trimStart: number, duration: number): number {
  const minEnd = trimStart + MIN_CLIP_DURATION
  const maxEnd = Math.min(trimStart + MAX_CLIP_DURATION, duration)
  return Math.max(minEnd, Math.min(value, maxEnd))
}

async function waitForSeeked(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>(resolve => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    // Fallback for Safari 14 where onseeked may not fire
    setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }, 500)
  })
}

export function VideoTrimmer({ file, onConfirm, onCancel }: VideoTrimmerProps) {
  const playbackRef = useRef<HTMLVideoElement>(null)
  const extractRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)

  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [dragging, setDragging] = useState<'start' | 'end' | null>(null)

  // Create and revoke object URL
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Get duration from playback video metadata
  const handleMetadata = useCallback(() => {
    const video = playbackRef.current
    if (!video || !isFinite(video.duration) || video.duration <= 0) return
    const dur = video.duration
    setDuration(dur)
    setTrimStart(0)
    setTrimEnd(Math.min(dur, MAX_CLIP_DURATION))
  }, [])

  // Extract thumbnails progressively once duration is known
  useEffect(() => {
    if (duration <= 0 || !objectUrl) return
    let cancelled = false

    const extract = async () => {
      const video = extractRef.current
      if (!video) return

      // Wait for the extraction video to be ready
      if (video.readyState < 1) {
        await new Promise<void>(resolve => {
          video.onloadedmetadata = () => resolve()
        })
      }

      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const thumbHeight = 56
      const thumbWidth = video.videoWidth > 0
        ? Math.round((video.videoWidth / video.videoHeight) * thumbHeight)
        : 100
      canvas.width = thumbWidth
      canvas.height = thumbHeight

      const interval = video.duration / FRAME_COUNT

      for (let i = 0; i < FRAME_COUNT; i++) {
        if (cancelled) return
        video.currentTime = i * interval
        await waitForSeeked(video)
        if (cancelled) return
        ctx.drawImage(video, 0, 0, thumbWidth, thumbHeight)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6)
        setThumbnails(prev => {
          const next = [...prev]
          next[i] = dataUrl
          return next
        })
      }
    }

    setThumbnails([])
    extract()
    return () => { cancelled = true }
  }, [duration, objectUrl])

  // Playback loop: constrain to trim range
  useEffect(() => {
    const video = playbackRef.current
    if (!video || duration <= 0) return

    const tick = () => {
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    video.play().catch(() => { /* autoplay blocked */ })
    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [trimStart, trimEnd, duration])

  // Drag: convert pixel position to time
  const pixelToTime = useCallback((clientX: number): number => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return ratio * duration
  }, [duration])

  const handlePointerDown = useCallback((e: React.PointerEvent, handle: 'start' | 'end') => {
    e.preventDefault()
    setDragging(handle)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return
    const time = pixelToTime(e.clientX)
    if (dragging === 'start') {
      const clamped = clampStart(time, trimEnd)
      setTrimStart(clamped)
      if (playbackRef.current) playbackRef.current.currentTime = clamped
    } else {
      setTrimEnd(clampEnd(time, trimStart, duration))
    }
  }, [dragging, trimEnd, trimStart, duration, pixelToTime])

  const handlePointerUp = useCallback(() => {
    setDragging(null)
  }, [])

  const selectedDuration = trimEnd - trimStart
  const leftPercent = duration > 0 ? (trimStart / duration) * 100 : 0
  const rightPercent = duration > 0 ? (trimEnd / duration) * 100 : 100

  return (
    <motion.div
      className="space-y-4 px-2 pt-3 pb-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      {/* Playback video preview */}
      {objectUrl && (
        <video
          ref={playbackRef}
          src={objectUrl}
          playsInline
          muted
          onLoadedMetadata={handleMetadata}
          onDurationChange={handleMetadata}
          className="w-full rounded-lg object-contain"
          style={{ maxHeight: '40vh' }}
        />
      )}

      {/* Hidden video for frame extraction */}
      {objectUrl && (
        <video
          ref={extractRef}
          src={objectUrl}
          playsInline
          muted
          preload="auto"
          className="hidden"
        />
      )}

      {/* Filmstrip with handles */}
      {duration > 0 && (
        <div className="space-y-3">
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-lg select-none"
            style={{ height: 56, touchAction: 'none' }}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            {/* Filmstrip thumbnails with progressive loading */}
            <div className="flex h-full">
              {Array.from({ length: FRAME_COUNT }).map((_, i) => (
                thumbnails[i] ? (
                  <img key={i} src={thumbnails[i]} className="h-full flex-1 object-cover" draggable={false} />
                ) : (
                  <div key={i} className="h-full flex-1" style={{
                    background: 'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 100%)',
                    backgroundSize: '200% 100%',
                    animation: 'skeleton-sweep 1.8s ease-in-out infinite',
                  }} />
                )
              ))}
            </div>

            {/* Overlay left (outside range) */}
            <div
              className="absolute inset-y-0 left-0"
              style={{ width: `${leftPercent}%`, background: 'rgba(0,0,0,0.6)' }}
            />

            {/* Overlay right (outside range) */}
            <div
              className="absolute inset-y-0 right-0"
              style={{ width: `${100 - rightPercent}%`, background: 'rgba(0,0,0,0.6)' }}
            />

            {/* Selected range border */}
            <div
              className="absolute inset-y-0 pointer-events-none"
              style={{
                left: `${leftPercent}%`,
                width: `${rightPercent - leftPercent}%`,
                borderTop: '2px solid rgba(100, 160, 255, 0.8)',
                borderBottom: '2px solid rgba(100, 160, 255, 0.8)',
              }}
            />

            {/* Handle left — 44px hit area, 4px visual */}
            <div
              className="absolute inset-y-0 cursor-col-resize flex items-center justify-center"
              style={{ width: 44, left: `calc(${leftPercent}% - 22px)` }}
              onPointerDown={(e) => handlePointerDown(e, 'start')}
            >
              <div className="h-6 w-1 rounded-full bg-white" style={{ boxShadow: '0 0 6px rgba(100,160,255,0.8)' }} />
            </div>

            {/* Handle right — 44px hit area, 4px visual */}
            <div
              className="absolute inset-y-0 cursor-col-resize flex items-center justify-center"
              style={{ width: 44, left: `calc(${rightPercent}% - 22px)` }}
              onPointerDown={(e) => handlePointerDown(e, 'end')}
            >
              <div className="h-6 w-1 rounded-full bg-white" style={{ boxShadow: '0 0 6px rgba(100,160,255,0.8)' }} />
            </div>
          </div>

          {/* Time labels */}
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: 'var(--text-muted)' }}>
              {formatTime(trimStart)} – {formatTime(trimEnd)}
            </span>
            <span style={{ color: selectedDuration > MAX_CLIP_DURATION ? '#f87171' : 'var(--text-secondary)' }}>
              <Scissors className="mr-1 inline-block h-3 w-3" />
              {selectedDuration.toFixed(1)}s / {MAX_CLIP_DURATION.toFixed(1)}s
            </span>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="h-11 flex-1 tracking-wide"
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          variant="glass"
          size="lg"
          className="h-11 flex-1 tracking-wide"
          onClick={() => onConfirm(trimStart, trimEnd)}
          disabled={duration <= 0}
        >
          Adjuntar
        </Button>
      </div>
    </motion.div>
  )
}
