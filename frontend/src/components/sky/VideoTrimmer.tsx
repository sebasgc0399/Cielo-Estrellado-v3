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

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const tenths = Math.floor((seconds % 1) * 10)
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`
}

export function VideoTrimmer({ file, onConfirm, onCancel }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)

  // Create and revoke object URL
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setObjectUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Get duration from video metadata
  const handleMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video || !isFinite(video.duration) || video.duration <= 0) return
    const dur = video.duration
    setDuration(dur)
    setTrimStart(0)
    setTrimEnd(Math.min(dur, MAX_CLIP_DURATION))
  }, [])

  // Playback loop: constrain to trim range
  useEffect(() => {
    const video = videoRef.current
    if (!video || duration <= 0) return

    const tick = () => {
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    video.play().catch(() => { /* autoplay blocked, user can interact */ })
    rafRef.current = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(rafRef.current)
  }, [trimStart, trimEnd, duration])

  const handleStartChange = (value: number) => {
    // Clamp: at least MIN_CLIP_DURATION before trimEnd, and trimEnd - trimStart <= MAX_CLIP_DURATION
    const maxStart = trimEnd - MIN_CLIP_DURATION
    const clamped = Math.min(value, maxStart)
    setTrimStart(Math.max(0, clamped))
    if (videoRef.current) videoRef.current.currentTime = Math.max(0, clamped)
  }

  const handleEndChange = (value: number) => {
    // Clamp: at least MIN_CLIP_DURATION after trimStart, and no more than MAX_CLIP_DURATION from trimStart
    const minEnd = trimStart + MIN_CLIP_DURATION
    const maxEnd = trimStart + MAX_CLIP_DURATION
    const clamped = Math.max(minEnd, Math.min(value, maxEnd, duration))
    setTrimEnd(clamped)
  }

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
      {/* Video preview */}
      {objectUrl && (
        <video
          ref={videoRef}
          src={objectUrl}
          playsInline
          muted
          onLoadedMetadata={handleMetadata}
          onDurationChange={handleMetadata}
          className="w-full rounded-lg object-contain"
          style={{ maxHeight: '40vh' }}
        />
      )}

      {/* Trim slider track */}
      {duration > 0 && (
        <div className="space-y-3">
          <div className="relative h-10 w-full">
            {/* Background track — dimmed outside range */}
            <div
              className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 rounded-full"
              style={{ background: 'rgba(255, 255, 255, 0.06)' }}
            />
            {/* Selected range highlight — blue glow */}
            <div
              className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
              style={{
                left: `${leftPercent}%`,
                width: `${rightPercent - leftPercent}%`,
                background: 'linear-gradient(90deg, rgba(140, 180, 255, 0.5), rgba(100, 160, 255, 0.6))',
                boxShadow: '0 0 8px rgba(140, 180, 255, 0.25)',
              }}
            />
            {/* Start slider */}
            <input
              type="range"
              className="trim-slider"
              min={0}
              max={duration}
              step={0.1}
              value={trimStart}
              onChange={(e) => handleStartChange(Number(e.target.value))}
            />
            {/* End slider */}
            <input
              type="range"
              className="trim-slider"
              min={0}
              max={duration}
              step={0.1}
              value={trimEnd}
              onChange={(e) => handleEndChange(Number(e.target.value))}
            />
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
