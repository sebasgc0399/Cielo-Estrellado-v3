import type { ThemeParams, ThemeColors } from '@/engine/SkyEngine'

interface ThemeDefinition {
  id: string
  name: string
  description: string
  colors: ThemeColors
}

const THEMES: Record<string, ThemeDefinition> = {
  'classic': {
    id: 'classic',
    name: 'Clásico',
    description: 'Paleta azul-blanca actual, siempre disponible',
    colors: {
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
    },
  },
  'aurora-borealis': {
    id: 'aurora-borealis',
    name: 'Aurora Boreal',
    description: 'Estrellas verde-cyan, nebula verde-púrpura, shooting stars cyan',
    colors: {
      starColorRange: { rMin: 100, rMax: 160, gMin: 220, gMax: 255, bMin: 180, bMax: 230 },
      userStarColor: 'rgb(180, 255, 220)',
      userStarHighlightColor: 'rgb(200, 255, 235)',
      nebulaBaseStartColor: 'rgba(5, 20, 15, 0.9)',
      nebulaBaseEndColor: 'rgba(3, 10, 20, 0.9)',
      nebulaAccentColor: 'rgba(50, 200, 150, 0.25)',
      nebulaOverlayColor: 'rgba(100, 60, 180, 0.18)',
      shootingStarHeadColor: 'rgba(200, 255, 230, 0.9)',
      shootingStarTailColor: 'rgba(100, 220, 180, 0.35)',
      glowColor: 'rgba(100, 220, 180, 0.45)',
      pointerGlowCenterColor: 'rgba(100, 230, 180, 0.25)',
      pointerGlowMidColor: 'rgba(80, 180, 150, 0.12)',
      userStarGlowColor: 'rgba(180, 255, 220, 0.6)',
    },
  },
  'sunset-horizon': {
    id: 'sunset-horizon',
    name: 'Horizonte Atardecer',
    description: 'Estrellas naranja-ámbar, nebula rosa-cálida, shooting stars doradas',
    colors: {
      starColorRange: { rMin: 230, rMax: 255, gMin: 150, gMax: 200, bMin: 80, bMax: 140 },
      userStarColor: 'rgb(255, 220, 180)',
      userStarHighlightColor: 'rgb(255, 235, 200)',
      nebulaBaseStartColor: 'rgba(25, 8, 15, 0.9)',
      nebulaBaseEndColor: 'rgba(15, 5, 10, 0.9)',
      nebulaAccentColor: 'rgba(220, 100, 80, 0.25)',
      nebulaOverlayColor: 'rgba(200, 80, 120, 0.18)',
      shootingStarHeadColor: 'rgba(255, 230, 200, 0.9)',
      shootingStarTailColor: 'rgba(255, 170, 100, 0.35)',
      glowColor: 'rgba(255, 170, 120, 0.45)',
      pointerGlowCenterColor: 'rgba(255, 180, 130, 0.25)',
      pointerGlowMidColor: 'rgba(230, 140, 100, 0.12)',
      userStarGlowColor: 'rgba(255, 220, 180, 0.6)',
    },
  },
  'purple-cosmos': {
    id: 'purple-cosmos',
    name: 'Cosmos Púrpura',
    description: 'Estrellas púrpura-magenta, nebula violeta profunda, shooting stars lavanda',
    colors: {
      starColorRange: { rMin: 180, rMax: 230, gMin: 100, gMax: 160, bMin: 220, bMax: 255 },
      userStarColor: 'rgb(230, 200, 255)',
      userStarHighlightColor: 'rgb(240, 215, 255)',
      nebulaBaseStartColor: 'rgba(15, 5, 25, 0.9)',
      nebulaBaseEndColor: 'rgba(8, 3, 15, 0.9)',
      nebulaAccentColor: 'rgba(150, 60, 220, 0.25)',
      nebulaOverlayColor: 'rgba(180, 50, 200, 0.18)',
      shootingStarHeadColor: 'rgba(230, 210, 255, 0.9)',
      shootingStarTailColor: 'rgba(180, 130, 255, 0.35)',
      glowColor: 'rgba(180, 130, 255, 0.45)',
      pointerGlowCenterColor: 'rgba(190, 140, 255, 0.25)',
      pointerGlowMidColor: 'rgba(150, 100, 230, 0.12)',
      userStarGlowColor: 'rgba(230, 200, 255, 0.6)',
    },
  },
  'rose-garden': {
    id: 'rose-garden',
    name: 'Jardín de Rosas',
    description: 'Estrellas rosa-rosadas, nebula suave rosada, shooting stars rose-gold',
    colors: {
      starColorRange: { rMin: 230, rMax: 255, gMin: 160, gMax: 200, bMin: 180, bMax: 220 },
      userStarColor: 'rgb(255, 210, 230)',
      userStarHighlightColor: 'rgb(255, 225, 240)',
      nebulaBaseStartColor: 'rgba(20, 8, 15, 0.9)',
      nebulaBaseEndColor: 'rgba(12, 4, 10, 0.9)',
      nebulaAccentColor: 'rgba(220, 120, 160, 0.25)',
      nebulaOverlayColor: 'rgba(200, 100, 150, 0.18)',
      shootingStarHeadColor: 'rgba(255, 220, 235, 0.9)',
      shootingStarTailColor: 'rgba(240, 160, 190, 0.35)',
      glowColor: 'rgba(240, 160, 200, 0.45)',
      pointerGlowCenterColor: 'rgba(240, 170, 200, 0.25)',
      pointerGlowMidColor: 'rgba(220, 140, 180, 0.12)',
      userStarGlowColor: 'rgba(255, 210, 230, 0.6)',
    },
  },
  'ocean-depths': {
    id: 'ocean-depths',
    name: 'Profundidades del Océano',
    description: 'Estrellas teal-cyan, nebula azul profunda, shooting stars aqua',
    colors: {
      starColorRange: { rMin: 80, rMax: 140, gMin: 200, gMax: 240, bMin: 220, bMax: 255 },
      userStarColor: 'rgb(180, 240, 255)',
      userStarHighlightColor: 'rgb(200, 248, 255)',
      nebulaBaseStartColor: 'rgba(3, 12, 25, 0.9)',
      nebulaBaseEndColor: 'rgba(2, 6, 18, 0.9)',
      nebulaAccentColor: 'rgba(40, 150, 220, 0.25)',
      nebulaOverlayColor: 'rgba(30, 100, 180, 0.18)',
      shootingStarHeadColor: 'rgba(200, 245, 255, 0.9)',
      shootingStarTailColor: 'rgba(100, 200, 240, 0.35)',
      glowColor: 'rgba(80, 190, 240, 0.45)',
      pointerGlowCenterColor: 'rgba(100, 200, 245, 0.25)',
      pointerGlowMidColor: 'rgba(70, 160, 220, 0.12)',
      userStarGlowColor: 'rgba(180, 240, 255, 0.6)',
    },
  },
  'golden-night': {
    id: 'golden-night',
    name: 'Noche Dorada',
    description: 'Estrellas oro-ámbar, nebula dorada cálida, shooting stars gold',
    colors: {
      starColorRange: { rMin: 230, rMax: 255, gMin: 190, gMax: 230, bMin: 80, bMax: 130 },
      userStarColor: 'rgb(255, 235, 180)',
      userStarHighlightColor: 'rgb(255, 245, 200)',
      nebulaBaseStartColor: 'rgba(20, 15, 5, 0.9)',
      nebulaBaseEndColor: 'rgba(12, 8, 3, 0.9)',
      nebulaAccentColor: 'rgba(200, 170, 60, 0.25)',
      nebulaOverlayColor: 'rgba(180, 140, 50, 0.18)',
      shootingStarHeadColor: 'rgba(255, 245, 200, 0.9)',
      shootingStarTailColor: 'rgba(230, 200, 100, 0.35)',
      glowColor: 'rgba(230, 200, 100, 0.45)',
      pointerGlowCenterColor: 'rgba(240, 210, 120, 0.25)',
      pointerGlowMidColor: 'rgba(200, 170, 90, 0.12)',
      userStarGlowColor: 'rgba(255, 235, 180, 0.6)',
    },
  },
  'frost-crystal': {
    id: 'frost-crystal',
    name: 'Cristal de Hielo',
    description: 'Estrellas blanco-azuladas, nebula pálida azul, shooting stars blancas',
    colors: {
      starColorRange: { rMin: 210, rMax: 240, gMin: 225, gMax: 250, bMin: 240, bMax: 255 },
      userStarColor: 'rgb(235, 245, 255)',
      userStarHighlightColor: 'rgb(245, 250, 255)',
      nebulaBaseStartColor: 'rgba(8, 12, 20, 0.9)',
      nebulaBaseEndColor: 'rgba(5, 8, 15, 0.9)',
      nebulaAccentColor: 'rgba(140, 180, 230, 0.25)',
      nebulaOverlayColor: 'rgba(160, 170, 210, 0.18)',
      shootingStarHeadColor: 'rgba(240, 248, 255, 0.9)',
      shootingStarTailColor: 'rgba(180, 210, 245, 0.35)',
      glowColor: 'rgba(180, 210, 245, 0.45)',
      pointerGlowCenterColor: 'rgba(190, 215, 245, 0.25)',
      pointerGlowMidColor: 'rgba(160, 190, 230, 0.12)',
      userStarGlowColor: 'rgba(235, 245, 255, 0.6)',
    },
  },
}

export function getThemeById(themeId: string | null): ThemeParams | null {
  if (!themeId || themeId === 'classic') return null
  const theme = THEMES[themeId]
  if (!theme) return null
  return { colors: theme.colors }
}

export function getAllThemes(): ThemeDefinition[] {
  return Object.values(THEMES)
}

export function getThemeDefinition(themeId: string): ThemeDefinition | null {
  return THEMES[themeId] ?? null
}

export type { ThemeDefinition }
