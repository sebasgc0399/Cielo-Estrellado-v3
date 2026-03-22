import { useEffect, useRef, type PointerEvent } from 'react'
import { SkyEngine } from '@/engine/SkyEngine'
import type { SkyConfig } from '@/engine/SkyEngine'
import { cn } from '@/lib/utils'
import './SkyCanvas.css'

type SkyCanvasProps = {
  className?: string
  demo?: boolean
}

const DEFAULT_CONFIG: SkyConfig = {
  twinkle: true,
  nebula: true,
  shootingStars: true,
  quality: 'high',
  motion: 'mouse',
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))

export function SkyCanvas({ className }: SkyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const farRef = useRef<HTMLCanvasElement>(null)
  const midRef = useRef<HTMLCanvasElement>(null)
  const nearRef = useRef<HTMLCanvasElement>(null)
  const nebulaRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<SkyEngine | null>(null)

  // Engine lifecycle
  useEffect(() => {
    if (!farRef.current || !midRef.current || !nearRef.current || !nebulaRef.current || !fxRef.current) {
      return
    }

    const engine = new SkyEngine({
      far: farRef.current,
      mid: midRef.current,
      near: nearRef.current,
      nebula: nebulaRef.current,
      fx: fxRef.current,
    })
    engineRef.current = engine
    engine.setConfig(DEFAULT_CONFIG)
    engine.start()

    return () => {
      engine.stop()
      engineRef.current = null
    }
  }, [])

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleResize = () => {
      const rect = container.getBoundingClientRect()
      engineRef.current?.resize(rect.width, rect.height, 2)
    }

    handleResize()
    const observer = new ResizeObserver(handleResize)
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top

    // Parallax input normalized to [-1, 1]
    const nx = clamp((localX - rect.width / 2) / (rect.width / 2), -1, 1)
    const ny = clamp((localY - rect.height / 2) / (rect.height / 2), -1, 1)
    engineRef.current?.setInputTarget(nx, ny)

    // Pointer glow
    engineRef.current?.setPointer(localX, localY, true)
  }

  const handlePointerLeave = () => {
    engineRef.current?.setPointer(0, 0, false)
    engineRef.current?.setInputTarget(0, 0)
  }

  return (
    <div
      ref={containerRef}
      className={cn('sky-canvas', className)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={nebulaRef} className="sky-layer" aria-hidden="true" />
      <canvas ref={farRef} className="sky-layer" aria-hidden="true" />
      <canvas ref={midRef} className="sky-layer" aria-hidden="true" />
      <canvas ref={nearRef} className="sky-layer" aria-hidden="true" />
      <canvas ref={fxRef} className="sky-layer" aria-hidden="true" />
    </div>
  )
}
