export type QualityLevel = 'high' | 'low'
export type MotionMode = 'mouse' | 'gyro'

export type StarColorRange = {
  rMin: number; rMax: number
  gMin: number; gMax: number
  bMin: number; bMax: number
}

export type ThemeColors = {
  starColorRange: StarColorRange
  userStarColor: string
  userStarHighlightColor: string
  nebulaBaseStartColor: string
  nebulaBaseEndColor: string
  nebulaAccentColor: string
  nebulaOverlayColor: string
  shootingStarHeadColor: string
  shootingStarTailColor: string
  glowColor: string
  pointerGlowCenterColor: string
  pointerGlowMidColor: string
  userStarGlowColor: string
}

export type ThemeParams = {
  colors: ThemeColors
  effects?: ThemeEffects
}

export type MeteorShowerEffect = {
  frequency: number      // meteoros por segundo (0.5 = uno cada 2s)
  trailLength: number    // longitud del trail en px
  colors: string[]       // colores del meteoro (se elige random)
}

export type FirefliesEffect = {
  count: number          // cantidad de luciérnagas (15-40)
  color: string          // color principal
  glowRadius: number     // radio del glow (3-8px)
  speed: number          // velocidad de movimiento (0.5 = lento, 1.5 = rápido)
}

export type ConstellationLinesEffect = {
  maxDistance: number     // distancia máxima como fracción del canvas (0.08 = 8%)
  color: string          // color de las líneas
  opacity: number        // opacidad base de las líneas (0.1-0.3)
}

export type StarShape = 'circle' | 'heart' | 'crystal' | 'flower'

export type ThemeEffects = {
  meteorShower?: MeteorShowerEffect
  fireflies?: FirefliesEffect
  constellationLines?: ConstellationLinesEffect
  starShape?: StarShape
}

export type SkyConfig = {
  twinkle: boolean
  nebula: boolean
  shootingStars: boolean
  quality: QualityLevel
  motion: MotionMode
  theme?: ThemeParams
}

export type UserStar = {
  id: string
  x: number
  y: number
  highlighted?: boolean
}

type LayerName = 'far' | 'mid' | 'near'

type LayerCanvases = {
  far: HTMLCanvasElement
  mid: HTMLCanvasElement
  near: HTMLCanvasElement
  nebula: HTMLCanvasElement
  fx: HTMLCanvasElement
}

type Star = {
  x: number
  y: number
  radius: number
  baseAlpha: number
  twinkleSpeed: number
  twinklePhase: number
  twinkleAmp: number
  color: string
}

type ShootingStar = {
  x: number
  y: number
  vx: number
  vy: number
  dirX: number
  dirY: number
  length: number
  life: number
  age: number
}

type LayerSettings = {
  count: number
  minRadius: number
  maxRadius: number
  blur: number
  parallax: number
  alphaMin: number
  alphaMax: number
  twinkleAmpMin: number
  twinkleAmpMax: number
}

type InternalUserStar = {
  id: string
  highlighted: boolean
  x: number
  y: number
  radius: number
  baseAlpha: number
  twinkleSpeed: number
  twinklePhase: number
  twinkleAmp: number
  color: string
  blur: number
  pulseSpeed: number
}

type EngineOptions = {
  onFps?: (fps: number) => void
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const rand = (min: number, max: number) => min + Math.random() * (max - min)

function parseRgba(color: string): [number, number, number, number] {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!m) return [0, 0, 0, 1]
  return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1]
}

// Fallback cuando config.theme es undefined — replica exactamente los valores hardcodeados originales.
// Los campos con alpha dinámico (shootingStarHeadColor, etc.) se almacenan con alpha en factor=1;
// el engine aplica globalAlpha=fade/strength en render, por lo que alpha_efectivo = alpha_color × factor.
const DEFAULT_THEME: ThemeColors = {
  // starColorRange: rangos del rango efectivo de la fórmula temp original (no los clamp boundaries).
  // Derivado de: r=clamp(210+temp*2,180,255), g=clamp(220+temp,190,255), b=clamp(255-temp*1.2,205,255)
  // con temp=rand(-8,12) → efectivo r:[194,234], g:[212,232], b:[241,255]
  starColorRange: { rMin: 194, rMax: 234, gMin: 212, gMax: 232, bMin: 241, bMax: 255 },
  userStarColor: 'rgb(255, 245, 225)',
  userStarHighlightColor: 'rgb(255, 250, 235)',
  nebulaBaseStartColor: 'rgba(7, 12, 32, 0.9)',
  nebulaBaseEndColor: 'rgba(4, 6, 16, 0.9)',
  nebulaAccentColor: 'rgba(70, 120, 200, 0.25)',
  nebulaOverlayColor: 'rgba(120, 90, 180, 0.18)',
  shootingStarHeadColor: 'rgba(240, 252, 255, 0.9)',
  shootingStarTailColor: 'rgba(170, 210, 255, 0.35)',
  glowColor: 'rgba(138, 170, 255, 0.45)',
  pointerGlowCenterColor: 'rgba(150, 200, 255, 0.25)',
  pointerGlowMidColor: 'rgba(110, 150, 255, 0.12)',
  userStarGlowColor: 'rgba(255, 235, 200, 0.6)',
}

export class SkyEngine {
  private layers: Record<LayerName, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; stars: Star[]; settings: LayerSettings }>
  private nebulaCanvas: HTMLCanvasElement
  private nebulaCtx: CanvasRenderingContext2D
  private fxCanvas: HTMLCanvasElement
  private fxCtx: CanvasRenderingContext2D
  private config: SkyConfig
  private width = 0
  private height = 0
  private dpr = 1
  private rafId = 0
  private lastTime = 0
  private fpsFrameCount = 0
  private fpsLastTime = 0
  private inputTarget = { x: 0, y: 0 }
  private inputCurrent = { x: 0, y: 0 }
  private pointer = { x: 0, y: 0, smoothX: 0, smoothY: 0, active: false, strength: 0, lastMove: 0 }
  private shootingStars: ShootingStar[] = []
  private nextShootingTime = 0
  private nebulaTexture: HTMLCanvasElement | null = null
  private needsStars = true
  private needsNebula = true
  private userStarDefs: UserStar[] = []
  private userStarCache: InternalUserStar[] = []
  private needsUserStars = false
  private readonly userStarParallax = 0
  private onFps?: (fps: number) => void
  private fireflies: Array<{
    x: number; y: number
    vx: number; vy: number
    phase: number; pulseSpeed: number
  }> = []

  constructor(canvases: LayerCanvases, options: EngineOptions = {}) {
    const farCtx = canvases.far.getContext('2d')
    const midCtx = canvases.mid.getContext('2d')
    const nearCtx = canvases.near.getContext('2d')
    const nebulaCtx = canvases.nebula.getContext('2d')
    const fxCtx = canvases.fx.getContext('2d')
    if (!farCtx || !midCtx || !nearCtx || !nebulaCtx || !fxCtx) {
      throw new Error('Canvas context missing')
    }

    this.config = {
      twinkle: true,
      nebula: true,
      shootingStars: true,
      quality: 'high',
      motion: 'mouse',
    }
    this.layers = {
      far: { canvas: canvases.far, ctx: farCtx, stars: [], settings: this.buildLayerSettings('far') },
      mid: { canvas: canvases.mid, ctx: midCtx, stars: [], settings: this.buildLayerSettings('mid') },
      near: { canvas: canvases.near, ctx: nearCtx, stars: [], settings: this.buildLayerSettings('near') },
    }
    this.nebulaCanvas = canvases.nebula
    this.nebulaCtx = nebulaCtx
    this.fxCanvas = canvases.fx
    this.fxCtx = fxCtx
    this.onFps = options.onFps
  }

  setConfig(next: SkyConfig) {
    const prev = this.config
    this.config = { ...next }
    if (!prev || prev.quality !== next.quality) {
      this.needsStars = true
      this.needsNebula = true
    }
    if (!prev || prev.nebula !== next.nebula) {
      this.needsNebula = true
    }
    if (!prev || JSON.stringify(prev.theme) !== JSON.stringify(next.theme)) {
      this.needsStars = true
      this.needsNebula = true
      this.nebulaTexture = null
    }
    if (!next.shootingStars) {
      this.shootingStars = []
    }
    if (!prev || prev.shootingStars !== next.shootingStars || prev.quality !== next.quality) {
      this.scheduleNextShooting(performance.now())
    }
    // Inicializar fireflies si el tema las tiene
    const effects = next.theme?.effects
    if (effects?.fireflies) {
      if (this.fireflies.length !== effects.fireflies.count) {
        this.fireflies = Array.from({ length: effects.fireflies.count }, () => ({
          x: Math.random(),
          y: Math.random(),
          vx: (Math.random() - 0.5) * 0.0003,
          vy: (Math.random() - 0.5) * 0.0003,
          phase: Math.random() * Math.PI * 2,
          pulseSpeed: 0.3 + Math.random() * 0.4,
        }))
      }
    } else {
      this.fireflies = []
    }
  }

  private getColors(): ThemeColors {
    return this.config.theme?.colors ?? DEFAULT_THEME
  }

  private getEffects(): ThemeEffects | undefined {
    return this.config.theme?.effects
  }

  resize(width: number, height: number, dprCap: number) {
    if (!width || !height) return
    this.width = width
    this.height = height
    this.dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    this.resizeCanvas(this.nebulaCanvas, this.nebulaCtx)
    this.resizeCanvas(this.fxCanvas, this.fxCtx)
    Object.values(this.layers).forEach((layer) => this.resizeCanvas(layer.canvas, layer.ctx))
    this.needsStars = true
    this.needsNebula = true
  }

  setInputTarget(x: number, y: number) {
    this.inputTarget.x = clamp(x, -1, 1)
    this.inputTarget.y = clamp(y, -1, 1)
  }

  setPointer(x: number, y: number, active: boolean) {
    this.pointer.x = x
    this.pointer.y = y
    if (active) {
      this.pointer.active = true
      this.pointer.lastMove = performance.now()
    } else {
      this.pointer.active = false
    }
  }

  setUserStars(stars: UserStar[]) {
    this.userStarDefs = stars
    this.needsUserStars = true
  }

  getParallaxOffset(): { x: number; y: number } {
    const nearParallax = this.layers.near.settings.parallax
    return {
      x: this.inputCurrent.x * this.width * nearParallax,
      y: this.inputCurrent.y * this.height * nearParallax,
    }
  }

  getUserStarParallaxOffset(): { x: number; y: number } {
    return {
      x: this.inputCurrent.x * this.width * this.userStarParallax,
      y: this.inputCurrent.y * this.height * this.userStarParallax,
    }
  }

  syncInputTargetToCurrent(): void {
    this.inputTarget.x = this.inputCurrent.x
    this.inputTarget.y = this.inputCurrent.y
  }

  hitTest(clientX: number, clientY: number): string | null {
    const offsetX = this.inputCurrent.x * this.width * this.userStarParallax
    const offsetY = this.inputCurrent.y * this.height * this.userStarParallax
    const hitRadius = 20
    let bestId: string | null = null
    let bestDist = hitRadius

    for (const us of this.userStarDefs) {
      const starPx = us.x * this.width + offsetX
      const starPy = us.y * this.height + offsetY
      const dx = clientX - starPx
      const dy = clientY - starPy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < bestDist) {
        bestDist = dist
        bestId = us.id
      }
    }
    return bestId
  }

  start() {
    if (this.rafId) return
    const now = performance.now()
    this.lastTime = now
    this.fpsFrameCount = 0
    this.fpsLastTime = now
    this.scheduleNextShooting(now)
    this.rafId = window.requestAnimationFrame(this.tick)
  }

  stop() {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }

  private resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const newW = Math.floor(this.width * this.dpr)
    const newH = Math.floor(this.height * this.dpr)
    if (canvas.width !== newW || canvas.height !== newH) {
      canvas.width = newW
      canvas.height = newH
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      ctx.imageSmoothingEnabled = true
    }
    canvas.style.width = `${this.width}px`
    canvas.style.height = `${this.height}px`
  }

  private buildLayerSettings(name: LayerName): LayerSettings {
    const area = Math.max(1, this.width * this.height)
    const qualityScale = this.config.quality === 'high' ? 1 : 0.6
    const baseCounts: Record<LayerName, number> = {
      far: Math.floor(area / 8000),
      mid: Math.floor(area / 12000),
      near: Math.floor(area / 18000),
    }

    const count = Math.max(24, Math.floor(baseCounts[name] * qualityScale))
    const radiusSets: Record<LayerName, [number, number]> = {
      far: [0.4, 1.1],
      mid: [0.6, 1.6],
      near: [0.9, 2.4],
    }
    const blur = this.config.quality === 'high' ? (name === 'far' ? 1.5 : name === 'mid' ? 1.8 : 2.2) : 0.6
    const parallax = name === 'far' ? 0.015 : name === 'mid' ? 0.035 : 0.06
    const alphaMin = name === 'far' ? 0.15 : name === 'mid' ? 0.25 : 0.35
    const alphaMax = name === 'far' ? 0.5 : name === 'mid' ? 0.65 : 0.85
    const twinkleAmpMin = name === 'far' ? 0.05 : name === 'mid' ? 0.08 : 0.1
    const twinkleAmpMax = name === 'far' ? 0.18 : name === 'mid' ? 0.22 : 0.26

    return {
      count,
      minRadius: radiusSets[name][0],
      maxRadius: radiusSets[name][1],
      blur,
      parallax,
      alphaMin,
      alphaMax,
      twinkleAmpMin,
      twinkleAmpMax,
    }
  }

  private rebuildStars() {
    this.layers.far.settings = this.buildLayerSettings('far')
    this.layers.mid.settings = this.buildLayerSettings('mid')
    this.layers.near.settings = this.buildLayerSettings('near')

    Object.values(this.layers).forEach((layer) => {
      layer.stars = this.createStars(layer.settings)
    })
  }

  private createStars(settings: LayerSettings): Star[] {
    const stars: Star[] = []
    const { rMin, rMax, gMin, gMax, bMin, bMax } = this.getColors().starColorRange
    for (let i = 0; i < settings.count; i += 1) {
      const r = rand(rMin, rMax)
      const g = rand(gMin, gMax)
      const b = rand(bMin, bMax)
      stars.push({
        x: Math.random(),
        y: Math.random(),
        radius: rand(settings.minRadius, settings.maxRadius),
        baseAlpha: rand(settings.alphaMin, settings.alphaMax),
        twinkleSpeed: rand(0.35, 0.9),
        twinklePhase: rand(0, Math.PI * 2),
        twinkleAmp: rand(settings.twinkleAmpMin, settings.twinkleAmpMax),
        color: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
      })
    }
    return stars
  }

  private buildUserStar(us: UserStar): InternalUserStar {
    const hl = us.highlighted ?? false
    return {
      id: us.id,
      highlighted: hl,
      x: us.x,
      y: us.y,
      radius: hl ? 4.5 : 3.5,
      baseAlpha: hl ? 1.0 : 0.92,
      twinkleSpeed: rand(0.35, 0.7),
      twinklePhase: rand(0, Math.PI * 2),
      twinkleAmp: hl ? 0.04 : 0.06,
      color: hl ? this.getColors().userStarHighlightColor : this.getColors().userStarColor,
      blur: hl ? 6.0 : 5.0,
      pulseSpeed: rand(0.4, 0.7),
    }
  }

  private ensureNebula() {
    if (!this.config.nebula) {
      this.nebulaCtx.clearRect(0, 0, this.width, this.height)
      return
    }
    if (!this.nebulaTexture) {
      this.nebulaTexture = this.buildNebulaTexture()
    }
    this.nebulaCtx.clearRect(0, 0, this.width, this.height)
    const alpha = this.config.quality === 'high' ? 0.22 : 0.14
    this.nebulaCtx.globalAlpha = alpha
    this.nebulaCtx.drawImage(this.nebulaTexture, 0, 0, this.width, this.height)
    this.nebulaCtx.globalAlpha = 1
  }

  private buildNebulaTexture() {
    const canvas = document.createElement('canvas')
    const scale = this.config.quality === 'high' ? 0.35 : 0.25
    const width = Math.floor(clamp(this.width * scale, 260, 680))
    const height = Math.floor(clamp(this.height * scale, 260, 680))
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas

    const { nebulaBaseStartColor, nebulaBaseEndColor, nebulaAccentColor, nebulaOverlayColor } = this.getColors()

    const base = ctx.createLinearGradient(0, 0, width, height)
    base.addColorStop(0, nebulaBaseStartColor)
    base.addColorStop(1, nebulaBaseEndColor)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, width, height)

    const [acR, acG, acB, acA] = parseRgba(nebulaAccentColor)

    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 10; i += 1) {
      const x = rand(0, width)
      const y = rand(0, height)
      const radius = rand(width * 0.18, width * 0.55)
      const hueShift = rand(-10, 18)
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
      grad.addColorStop(0, `rgba(${Math.round(acR + hueShift)}, ${Math.round(acG + hueShift)}, ${acB}, ${acA})`)
      grad.addColorStop(0.6, `rgba(${Math.round(acR - 20 + hueShift)}, ${Math.round(acG - 30 + hueShift)}, ${acB - 20}, ${acA * 0.32})`)
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }

    ctx.globalCompositeOperation = 'overlay'
    for (let i = 0; i < 4; i += 1) {
      const x = rand(0, width)
      const y = rand(0, height)
      const radius = rand(width * 0.2, width * 0.6)
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius)
      grad.addColorStop(0, nebulaOverlayColor)
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
    }

    ctx.globalCompositeOperation = 'source-over'
    return canvas
  }

  private scheduleNextShooting(now: number) {
    if (!this.config.shootingStars) {
      this.nextShootingTime = 0
      return
    }
    const minDelay = this.config.quality === 'high' ? 8000 : 14000
    const maxDelay = this.config.quality === 'high' ? 16000 : 26000
    const frequency = Math.max(0.1, this.getEffects()?.meteorShower?.frequency ?? 1)
    this.nextShootingTime = now + rand(minDelay, maxDelay) / frequency
  }

  private spawnShootingStar() {
    const meteor = this.getEffects()?.meteorShower
    const angle = rand(Math.PI * 0.2, Math.PI * 0.32)
    const speed = rand(900, 1300)
    const dirX = Math.cos(angle)
    const dirY = Math.sin(angle)
    const baseLength = rand(160, 260)
    const length = meteor ? baseLength * meteor.trailLength : baseLength
    const life = rand(0.9, 1.4)
    this.shootingStars.push({
      x: rand(-this.width * 0.1, this.width * 0.35),
      y: rand(-this.height * 0.15, this.height * 0.2),
      vx: dirX * speed,
      vy: dirY * speed,
      dirX,
      dirY,
      length,
      life,
      age: 0,
    })
  }

  private drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const s = size
    ctx.moveTo(x, y + s * 0.3)
    ctx.bezierCurveTo(x, y - s * 0.3, x - s, y - s * 0.3, x - s, y + s * 0.1)
    ctx.bezierCurveTo(x - s, y + s * 0.7, x, y + s * 1.1, x, y + s * 1.1)
    ctx.bezierCurveTo(x, y + s * 1.1, x + s, y + s * 0.7, x + s, y + s * 0.1)
    ctx.bezierCurveTo(x + s, y - s * 0.3, x, y - s * 0.3, x, y + s * 0.3)
  }

  private drawCrystal(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const w = size
    const h = size * 1.4
    ctx.moveTo(x, y - h)
    ctx.lineTo(x + w, y)
    ctx.lineTo(x, y + h)
    ctx.lineTo(x - w, y)
    ctx.closePath()
  }

  private drawFlower(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const petalR = size * 0.5
    const petalDist = size * 0.45
    for (let i = 0; i < 5; i += 1) {
      const angle = (i * Math.PI * 2) / 5 - Math.PI / 2
      const px = x + Math.cos(angle) * petalDist
      const py = y + Math.sin(angle) * petalDist
      ctx.moveTo(px + petalR, py)
      ctx.arc(px, py, petalR, 0, Math.PI * 2)
    }
    // Centro
    ctx.moveTo(x + petalR * 0.4, y)
    ctx.arc(x, y, petalR * 0.4, 0, Math.PI * 2)
  }

  private drawStarShape(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, shape: StarShape) {
    ctx.beginPath()
    switch (shape) {
      case 'heart':
        this.drawHeart(ctx, x, y, size)
        break
      case 'crystal':
        this.drawCrystal(ctx, x, y, size)
        break
      case 'flower':
        this.drawFlower(ctx, x, y, size)
        break
      default:
        ctx.arc(x, y, size, 0, Math.PI * 2)
    }
  }

  private renderStars(time: number) {
    const t = time / 1000
    Object.values(this.layers).forEach((layer) => {
      const ctx = layer.ctx
      const offsetX = this.inputCurrent.x * this.width * layer.settings.parallax
      const offsetY = this.inputCurrent.y * this.height * layer.settings.parallax
      ctx.clearRect(0, 0, this.width, this.height)
      ctx.save()
      ctx.shadowBlur = layer.settings.blur
      ctx.shadowColor = this.getColors().glowColor

      for (let i = 0; i < layer.stars.length; i += 1) {
        const star = layer.stars[i]
        const twinkle = this.config.twinkle ? Math.sin(t * star.twinkleSpeed + star.twinklePhase) : 0
        const alpha = clamp(star.baseAlpha + twinkle * star.twinkleAmp, 0.08, 1)
        const px = star.x * this.width + offsetX
        const py = star.y * this.height + offsetY
        if (px < -20 || py < -20 || px > this.width + 20 || py > this.height + 20) continue
        ctx.globalAlpha = alpha
        ctx.fillStyle = star.color
        ctx.beginPath()
        ctx.arc(px, py, star.radius, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      ctx.globalAlpha = 1
    })

    if (this.userStarCache.length > 0) {
      const nearCtx = this.layers.near.ctx
      const uOffsetX = this.inputCurrent.x * this.width * this.userStarParallax
      const uOffsetY = this.inputCurrent.y * this.height * this.userStarParallax
      const starShape = this.getEffects()?.starShape ?? 'circle'

      nearCtx.save()
      for (const us of this.userStarCache) {
        const twinkle = this.config.twinkle
          ? Math.sin(t * us.twinkleSpeed + us.twinklePhase)
          : 0
        const alpha = clamp(us.baseAlpha + twinkle * us.twinkleAmp, 0.08, 1)
        const pulse = 1.0 + 0.15 * Math.sin(t * us.pulseSpeed)
        const px = us.x * this.width + uOffsetX
        const py = us.y * this.height + uOffsetY
        if (px < -20 || py < -20 || px > this.width + 20 || py > this.height + 20) continue

        const r = us.radius * pulse

        // Outer halo
        nearCtx.shadowBlur = 0
        nearCtx.globalAlpha = alpha * 0.12
        nearCtx.fillStyle = us.color
        this.drawStarShape(nearCtx, px, py, r * 2.5, starShape)
        nearCtx.fill()

        // Core star
        nearCtx.shadowBlur = us.blur
        nearCtx.shadowColor = this.getColors().userStarGlowColor
        nearCtx.globalAlpha = alpha
        nearCtx.fillStyle = us.color
        this.drawStarShape(nearCtx, px, py, r, starShape)
        nearCtx.fill()
      }
      nearCtx.restore()
      nearCtx.globalAlpha = 1
    }
  }

  private renderEffects(dt: number, now: number) {
    this.fxCtx.clearRect(0, 0, this.width, this.height)

    if (this.config.shootingStars && now >= this.nextShootingTime) {
      this.spawnShootingStar()
      this.scheduleNextShooting(now)
    }

    if (this.shootingStars.length) {
      this.fxCtx.save()
      this.fxCtx.globalCompositeOperation = 'lighter'
      for (let i = this.shootingStars.length - 1; i >= 0; i -= 1) {
        const star = this.shootingStars[i]
        star.age += dt
        star.x += star.vx * dt
        star.y += star.vy * dt
        const lifeRatio = star.age / star.life
        if (lifeRatio >= 1) {
          this.shootingStars.splice(i, 1)
          continue
        }
        const fade = lifeRatio < 0.7 ? 1 : (1 - lifeRatio) / 0.3
        const tailX = star.x - star.dirX * star.length
        const tailY = star.y - star.dirY * star.length
        const { shootingStarTailColor, shootingStarHeadColor } = this.getColors()
        const meteor = this.getEffects()?.meteorShower
        const headColor = meteor?.colors.length
          ? meteor.colors[Math.floor(Math.random() * meteor.colors.length)]
          : shootingStarHeadColor
        const tailColor = meteor?.colors.length
          ? meteor.colors[Math.floor(Math.random() * meteor.colors.length)]
          : shootingStarTailColor
        const gradient = this.fxCtx.createLinearGradient(tailX, tailY, star.x, star.y)
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
        gradient.addColorStop(0.5, tailColor)
        gradient.addColorStop(1, headColor)
        this.fxCtx.globalAlpha = fade
        this.fxCtx.strokeStyle = gradient
        this.fxCtx.lineWidth = 2
        this.fxCtx.beginPath()
        this.fxCtx.moveTo(tailX, tailY)
        this.fxCtx.lineTo(star.x, star.y)
        this.fxCtx.stroke()
        this.fxCtx.fillStyle = 'rgba(255, 255, 255, 0.8)'
        this.fxCtx.beginPath()
        this.fxCtx.arc(star.x, star.y, 1.6, 0, Math.PI * 2)
        this.fxCtx.fill()
      }
      this.fxCtx.restore()
    }

    if (this.pointer.active && now - this.pointer.lastMove > 1200) {
      this.pointer.active = false
    }
    this.pointer.strength = lerp(this.pointer.strength, this.pointer.active ? 1 : 0, 0.08)
    this.pointer.smoothX = lerp(this.pointer.smoothX, this.pointer.x, 0.15)
    this.pointer.smoothY = lerp(this.pointer.smoothY, this.pointer.y, 0.15)

    if (this.pointer.strength > 0.02) {
      const radius = Math.min(this.width, this.height) * (0.16 + this.pointer.strength * 0.06)
      const gradient = this.fxCtx.createRadialGradient(
        this.pointer.smoothX,
        this.pointer.smoothY,
        0,
        this.pointer.smoothX,
        this.pointer.smoothY,
        radius,
      )
      const { pointerGlowCenterColor, pointerGlowMidColor } = this.getColors()
      gradient.addColorStop(0, pointerGlowCenterColor)
      gradient.addColorStop(0.5, pointerGlowMidColor)
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      this.fxCtx.save()
      this.fxCtx.globalAlpha = this.pointer.strength
      this.fxCtx.globalCompositeOperation = 'lighter'
      this.fxCtx.fillStyle = gradient
      this.fxCtx.fillRect(this.pointer.smoothX - radius, this.pointer.smoothY - radius, radius * 2, radius * 2)
      this.fxCtx.restore()
    }

    // Fireflies effect
    const effects = this.getEffects()
    if (this.fireflies.length > 0 && effects?.fireflies) {
      const ff = effects.fireflies

      this.fxCtx.save()
      this.fxCtx.globalCompositeOperation = 'lighter'

      for (const fly of this.fireflies) {
        // Movimiento errático tipo luciérnaga
        fly.vx += (Math.random() - 0.5) * 0.00005
        fly.vy += (Math.random() - 0.5) * 0.00005

        fly.x += fly.vx * ff.speed
        fly.y += fly.vy * ff.speed

        // Clamp velocidad
        const maxV = 0.0005 * ff.speed
        fly.vx = Math.max(-maxV, Math.min(maxV, fly.vx))
        fly.vy = Math.max(-maxV, Math.min(maxV, fly.vy))

        // Wrap around
        if (fly.x < 0) fly.x = 1
        if (fly.x > 1) fly.x = 0
        if (fly.y < 0) fly.y = 1
        if (fly.y > 1) fly.y = 0

        // Pulso de brillo
        fly.phase += fly.pulseSpeed * 0.016
        const brightness = 0.3 + 0.7 * Math.pow(Math.sin(fly.phase), 2)

        // Render
        const px = fly.x * this.width
        const py = fly.y * this.height

        this.fxCtx.globalAlpha = brightness
        const grad = this.fxCtx.createRadialGradient(px, py, 0, px, py, ff.glowRadius)
        grad.addColorStop(0, ff.color)
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
        this.fxCtx.fillStyle = grad
        this.fxCtx.fillRect(px - ff.glowRadius, py - ff.glowRadius, ff.glowRadius * 2, ff.glowRadius * 2)

        // Core brillante
        this.fxCtx.beginPath()
        this.fxCtx.arc(px, py, 1.2, 0, Math.PI * 2)
        this.fxCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        this.fxCtx.fill()
      }

      this.fxCtx.restore()
    }

    // Constellation lines effect
    if (effects?.constellationLines && this.layers.near.stars.length > 0) {
      const cl = effects.constellationLines
      const maxDist = cl.maxDistance * Math.min(this.width, this.height)
      const nearSettings = this.layers.near.settings
      const offsetX = this.inputCurrent.x * this.width * nearSettings.parallax
      const offsetY = this.inputCurrent.y * this.height * nearSettings.parallax
      const nearStars = this.layers.near.stars

      this.fxCtx.save()
      this.fxCtx.globalCompositeOperation = 'lighter'
      this.fxCtx.strokeStyle = cl.color
      this.fxCtx.lineWidth = 0.5

      for (let i = 0; i < nearStars.length; i += 1) {
        const starA = nearStars[i]
        const ax = starA.x * this.width + offsetX
        const ay = starA.y * this.height + offsetY

        for (let j = i + 1; j < nearStars.length; j += 1) {
          const starB = nearStars[j]
          const bx = starB.x * this.width + offsetX
          const by = starB.y * this.height + offsetY

          const dx = ax - bx
          const dy = ay - by
          const dist = Math.sqrt(dx * dx + dy * dy)

          if (dist < maxDist) {
            const lineAlpha = 1 - dist / maxDist
            this.fxCtx.globalAlpha = cl.opacity * lineAlpha
            this.fxCtx.beginPath()
            this.fxCtx.moveTo(ax, ay)
            this.fxCtx.lineTo(bx, by)
            this.fxCtx.stroke()
          }
        }
      }

      this.fxCtx.restore()
    }
  }

  private tick = (now: number) => {
    const delta = Math.min(0.05, (now - this.lastTime) / 1000)
    this.lastTime = now

    if (this.needsStars && this.width && this.height) {
      this.rebuildStars()
      this.needsStars = false
    }
    if (this.needsUserStars) {
      this.userStarCache = this.userStarDefs.map(us => this.buildUserStar(us))
      this.needsUserStars = false
    }
    if (this.needsNebula && this.width && this.height) {
      this.nebulaTexture = null
      this.ensureNebula()
      this.needsNebula = false
    }

    this.inputCurrent.x = lerp(this.inputCurrent.x, this.inputTarget.x, 0.05)
    this.inputCurrent.y = lerp(this.inputCurrent.y, this.inputTarget.y, 0.05)

    if (this.width && this.height) {
      this.renderStars(now)
      this.renderEffects(delta, now)
    }

    this.fpsFrameCount += 1
    const fpsElapsed = now - this.fpsLastTime
    if (fpsElapsed >= 900) {
      const fps = Math.round((this.fpsFrameCount * 1000) / fpsElapsed)
      this.onFps?.(fps)
      this.fpsFrameCount = 0
      this.fpsLastTime = now
    }

    this.rafId = window.requestAnimationFrame(this.tick)
  }
}
