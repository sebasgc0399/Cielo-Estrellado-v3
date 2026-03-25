import { getAllThemes, getThemeById, getThemeDefinition } from './themes'

const EXPECTED_THEME_COLOR_KEYS = [
  'starColorRange',
  'userStarColor',
  'userStarHighlightColor',
  'nebulaBaseStartColor',
  'nebulaBaseEndColor',
  'nebulaAccentColor',
  'nebulaOverlayColor',
  'shootingStarHeadColor',
  'shootingStarTailColor',
  'glowColor',
  'pointerGlowCenterColor',
  'pointerGlowMidColor',
  'userStarGlowColor',
]

describe('themes', () => {
  it('getAllThemes() returns 14 themes', () => {
    expect(getAllThemes()).toHaveLength(14)
  })

  it('getThemeById(null) returns null', () => {
    expect(getThemeById(null)).toBeNull()
  })

  it('getThemeById("classic") returns null (engine uses DEFAULT_THEME)', () => {
    expect(getThemeById('classic')).toBeNull()
  })

  it('getThemeById("aurora-borealis") returns ThemeParams with colors', () => {
    const theme = getThemeById('aurora-borealis')
    expect(theme).not.toBeNull()
    expect(theme!.colors).toBeDefined()
  })

  it('getThemeById("no-existe") returns null', () => {
    expect(getThemeById('no-existe')).toBeNull()
  })

  it('getThemeDefinition("classic") returns ThemeDefinition with name, description, colors', () => {
    const def = getThemeDefinition('classic')
    expect(def).not.toBeNull()
    expect(def!.name).toBeTruthy()
    expect(def!.description).toBeTruthy()
    expect(def!.colors).toBeDefined()
  })

  it('all themes have the 13 ThemeColors properties', () => {
    for (const theme of getAllThemes()) {
      const keys = Object.keys(theme.colors)
      expect(keys).toEqual(expect.arrayContaining(EXPECTED_THEME_COLOR_KEYS))
      expect(keys).toHaveLength(13)
    }
  })

  it('theme IDs match shopCatalog themeIds', () => {
    const themeIds = getAllThemes().map((t) => t.id).filter((id) => id !== 'classic')
    const shopThemeIds = [
      'aurora-borealis',
      'sunset-horizon',
      'purple-cosmos',
      'rose-garden',
      'ocean-depths',
      'golden-night',
      'frost-crystal',
      'meteor-shower',
      'fireflies',
      'constellations',
      'enchanted-garden',
      'diamond-crystal',
      'celestial-hearts',
    ]
    expect(themeIds.sort()).toEqual(shopThemeIds.sort())
  })
})
