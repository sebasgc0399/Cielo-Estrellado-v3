import { useEffect, useRef, type PointerEvent } from 'react'
import { SkyEngine } from '@/engine/SkyEngine'
import type { SkyConfig, UserStar } from '@/engine/SkyEngine'
import { cn } from '@/lib/utils'
import './SkyCanvas.css'

type DragState = {
  starId: string
  frozenOffsetX: number
  frozenOffsetY: number
  canvasW: number
  canvasH: number
}

type SkyCanvasProps = {
  className?: string
  demo?: boolean
  userStars?: UserStar[]
  config?: SkyConfig
  highlightedStarId?: string | null
  creationMode?: boolean
  onStarTap?: (starId: string) => void
  onEmptyTap?: (nx: number, ny: number) => void
  onStarDragEnd?: (starId: string, nx: number, ny: number) => Promise<boolean>
}

const DEFAULT_CONFIG: SkyConfig = {
  twinkle: true,
  nebula: true,
  shootingStars: true,
  quality: 'high',
  motion: 'mouse',
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export function SkyCanvas({
  className,
  demo,
  userStars,
  config,
  highlightedStarId,
  creationMode,
  onStarTap,
  onEmptyTap,
  onStarDragEnd,
}: SkyCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const farRef = useRef<HTMLCanvasElement>(null)
  const midRef = useRef<HTMLCanvasElement>(null)
  const nearRef = useRef<HTMLCanvasElement>(null)
  const nebulaRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<SkyEngine | null>(null)

  // Drag refs — no React state to avoid re-renders during drag
  const userStarsRef = useRef<UserStar[]>([])
  const originalStarsRef = useRef<UserStar[]>([])
  const dragStateRef = useRef<DragState | null>(null)
  const isDraggingRef = useRef(false)
  const dropPendingRef = useRef(false)
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null)
  const configRef = useRef<SkyConfig>(config ?? DEFAULT_CONFIG)

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
    engine.setConfig(config ?? DEFAULT_CONFIG)
    engine.start()

    return () => {
      engine.stop()
      engineRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ResizeObserver (debounced)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleResize = () => {
      const rect = container.getBoundingClientRect()
      const dprCap = (config ?? DEFAULT_CONFIG).quality === 'high' ? 2 : 1.35
      engineRef.current?.resize(rect.width, rect.height, dprCap)
    }

    handleResize()

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(handleResize, 150)
    })
    observer.observe(container)
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout)
      observer.disconnect()
    }
  }, [config])

  // Sync config to engine
  useEffect(() => {
    configRef.current = config ?? DEFAULT_CONFIG
    if (config) engineRef.current?.setConfig(config)
  }, [config])

  // Sync userStars to engine
  useEffect(() => {
    const stars = userStars ?? []
    userStarsRef.current = stars

    // Apply highlighted flag
    const withHighlight = highlightedStarId
      ? stars.map(s => s.id === highlightedStarId ? { ...s, highlighted: true } : s)
      : stars

    engineRef.current?.setUserStars(withHighlight)
  }, [userStars, highlightedStarId])

  // Sync creation mode data attribute
  useEffect(() => {
    const c = containerRef.current
    if (!c) return
    if (creationMode) {
      c.dataset.creationMode = 'true'
    } else {
      delete c.dataset.creationMode
    }
  }, [creationMode])

  // --- Pointer helpers ---

  const updatePointer = (event: PointerEvent<HTMLDivElement>, active: boolean) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    engineRef.current?.setPointer(x, y, active)
    if (configRef.current.motion === 'mouse') {
      const nx = clamp((x - rect.width / 2) / (rect.width / 2), -1, 1)
      const ny = clamp((y - rect.height / 2) / (rect.height / 2), -1, 1)
      engineRef.current?.setInputTarget(nx, ny)
    }
  }

  const clearDragDataAttrs = () => {
    const c = containerRef.current
    if (!c) return
    delete c.dataset.dragging
    delete c.dataset.hoveringStar
  }

  // --- Demo mode: simplified handlers ---

  if (demo) {
    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
      updatePointer(event, true)
    }
    const handlePointerLeave = () => {
      engineRef.current?.setPointer(0, 0, false)
      if (configRef.current.motion === 'mouse') {
        engineRef.current?.setInputTarget(0, 0)
      }
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

  // --- Interactive mode handlers ---

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const downX = event.clientX - rect.left
    const downY = event.clientY - rect.top

    // Try to start drag (non-touch, has drag handler, no drop in flight)
    if (onStarDragEnd && event.pointerType !== 'touch' && !dropPendingRef.current) {
      const hitId = engineRef.current?.hitTest(downX, downY) ?? null
      if (hitId) {
        if (!engineRef.current) return
        // 1. Capture parallax offset before freezing
        const offset = engineRef.current.getUserStarParallaxOffset()
        // 2. Freeze parallax: inputTarget = inputCurrent
        engineRef.current.syncInputTargetToCurrent()
        // 3. Save snapshot for revert
        originalStarsRef.current = [...userStarsRef.current]
        // 4. Enter DRAG_READY
        dragStateRef.current = {
          starId: hitId,
          frozenOffsetX: offset.x,
          frozenOffsetY: offset.y,
          canvasW: rect.width,
          canvasH: rect.height,
        }
        pointerDownPos.current = { x: downX, y: downY }
        return
      }
    }

    // Normal branch
    pointerDownPos.current = { x: downX, y: downY }
    updatePointer(event, true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const container = containerRef.current
    const rect = container?.getBoundingClientRect()
    if (!rect) return

    const curX = event.clientX - rect.left
    const curY = event.clientY - rect.top

    // Drag branch — completely isolated
    if (dragStateRef.current !== null) {
      const downPos = pointerDownPos.current
      if (!isDraggingRef.current && downPos) {
        const dx = curX - downPos.x
        const dy = curY - downPos.y
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          isDraggingRef.current = true
          if (container) container.dataset.dragging = 'true'
        }
      }

      if (isDraggingRef.current) {
        const { starId, frozenOffsetX, frozenOffsetY, canvasW, canvasH } = dragStateRef.current
        const nx = clamp((curX - frozenOffsetX) / canvasW, 0, 1)
        const ny = clamp((curY - frozenOffsetY) / canvasH, 0, 1)
        engineRef.current?.setUserStars(
          userStarsRef.current.map(s => s.id === starId ? { ...s, x: nx, y: ny } : s),
        )
      }
      return
    }

    // Idle: hover cursor for stars
    if (onStarDragEnd && container && !dropPendingRef.current) {
      const hitId = engineRef.current?.hitTest(curX, curY) ?? null
      if (hitId) {
        container.dataset.hoveringStar = 'true'
      } else {
        delete container.dataset.hoveringStar
      }
    }

    // Normal pointer update (parallax + glow)
    updatePointer(event, true)
  }

  const handlePointerUp = async (event: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()

    // --- DRAG COMMIT ---
    if (isDraggingRef.current && dragStateRef.current) {
      if (!rect) {
        engineRef.current?.setUserStars(originalStarsRef.current)
        isDraggingRef.current = false
        dragStateRef.current = null
        pointerDownPos.current = null
        clearDragDataAttrs()
        return
      }

      const { starId, frozenOffsetX, frozenOffsetY, canvasW, canvasH } = dragStateRef.current
      const upX = event.clientX - rect.left
      const upY = event.clientY - rect.top
      const nx = clamp((upX - frozenOffsetX) / canvasW, 0, 1)
      const ny = clamp((upY - frozenOffsetY) / canvasH, 0, 1)

      const updatedStars = userStarsRef.current.map(s =>
        s.id === starId ? { ...s, x: nx, y: ny } : s,
      )
      engineRef.current?.setUserStars(updatedStars)

      isDraggingRef.current = false
      dragStateRef.current = null
      pointerDownPos.current = null
      clearDragDataAttrs()

      dropPendingRef.current = true
      let ok = false
      try {
        ok = (await onStarDragEnd?.(starId, nx, ny)) ?? true
      } catch {
        ok = false
      }

      if (ok) {
        userStarsRef.current = updatedStars
        originalStarsRef.current = [...updatedStars]
      } else {
        engineRef.current?.setUserStars(originalStarsRef.current)
      }
      dropPendingRef.current = false
      return
    }

    // --- DRAG_READY → CLICK (dist ≤ 5) ---
    if (dragStateRef.current && pointerDownPos.current && rect) {
      const { starId } = dragStateRef.current
      const upX = event.clientX - rect.left
      const upY = event.clientY - rect.top
      const dx = upX - pointerDownPos.current.x
      const dy = upY - pointerDownPos.current.y

      dragStateRef.current = null
      pointerDownPos.current = null
      clearDragDataAttrs()

      if (Math.sqrt(dx * dx + dy * dy) <= 5) {
        onStarTap?.(starId)
      }
      return
    }

    // Clean up leftover drag state
    if (dragStateRef.current) {
      dragStateRef.current = null
      pointerDownPos.current = null
      clearDragDataAttrs()
      return
    }

    // --- NORMAL CLICK ---
    if (!rect || !pointerDownPos.current) {
      updatePointer(event, false)
      pointerDownPos.current = null
      return
    }

    const upX = event.clientX - rect.left
    const upY = event.clientY - rect.top
    const dx = upX - pointerDownPos.current.x
    const dy = upY - pointerDownPos.current.y
    pointerDownPos.current = null

    updatePointer(event, false)

    if (Math.sqrt(dx * dx + dy * dy) > 5) return

    const nx = clamp(upX / rect.width, 0, 1)
    const ny = clamp(upY / rect.height, 0, 1)
    const hitId = engineRef.current?.hitTest(upX, upY) ?? null

    if (hitId) {
      onStarTap?.(hitId)
    } else {
      onEmptyTap?.(nx, ny)
    }
  }

  const handlePointerLeave = () => {
    if (dragStateRef.current && isDraggingRef.current) {
      engineRef.current?.setUserStars(originalStarsRef.current)
    }
    dragStateRef.current = null
    isDraggingRef.current = false
    pointerDownPos.current = null
    clearDragDataAttrs()

    engineRef.current?.setPointer(0, 0, false)
    if (configRef.current.motion === 'mouse') {
      engineRef.current?.setInputTarget(0, 0)
    }
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current && isDraggingRef.current) {
      engineRef.current?.setUserStars(originalStarsRef.current)
    }
    dragStateRef.current = null
    isDraggingRef.current = false
    pointerDownPos.current = null
    clearDragDataAttrs()

    updatePointer(event, false)
  }

  return (
    <div
      ref={containerRef}
      className={cn('sky-canvas', className)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
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
