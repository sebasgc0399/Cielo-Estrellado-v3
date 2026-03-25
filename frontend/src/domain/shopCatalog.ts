export interface ShopItem {
  itemId: string
  name: string
  description: string
  category: 'theme' | 'sky-slot'
  price: number
  themeId?: string
}

export const SHOP_CATALOG: ShopItem[] = [
  { itemId: 'theme-aurora-borealis', name: 'Aurora Boreal', description: 'Verde-cyan con nebulosa verde-púrpura', category: 'theme', price: 800, themeId: 'aurora-borealis' },
  { itemId: 'theme-sunset-horizon', name: 'Horizonte Atardecer', description: 'Naranja-ámbar con nebulosa rosa cálida', category: 'theme', price: 800, themeId: 'sunset-horizon' },
  { itemId: 'theme-purple-cosmos', name: 'Cosmos Púrpura', description: 'Púrpura-magenta con nebulosa violeta profunda', category: 'theme', price: 800, themeId: 'purple-cosmos' },
  { itemId: 'theme-rose-garden', name: 'Jardín de Rosas', description: 'Rosa suave con nebulosa rosada', category: 'theme', price: 600, themeId: 'rose-garden' },
  { itemId: 'theme-ocean-depths', name: 'Profundidades del Océano', description: 'Teal-cyan con nebulosa azul profunda', category: 'theme', price: 800, themeId: 'ocean-depths' },
  { itemId: 'theme-golden-night', name: 'Noche Dorada', description: 'Oro-ámbar con nebulosa dorada cálida', category: 'theme', price: 800, themeId: 'golden-night' },
  { itemId: 'theme-frost-crystal', name: 'Cristal de Hielo', description: 'Blanco-azulado con nebulosa pálida', category: 'theme', price: 600, themeId: 'frost-crystal' },
  { itemId: 'theme-meteor-shower', name: 'Lluvia de Meteoros', description: 'Meteoros frecuentes con trails ardientes', category: 'theme', price: 1200, themeId: 'meteor-shower' },
  { itemId: 'theme-fireflies', name: 'Luciérnagas', description: 'Partículas doradas flotando entre las estrellas', category: 'theme', price: 1200, themeId: 'fireflies' },
  { itemId: 'theme-constellations', name: 'Constelaciones', description: 'Líneas conectan las estrellas más cercanas', category: 'theme', price: 1500, themeId: 'constellations' },
  { itemId: 'theme-enchanted-garden', name: 'Jardín Encantado', description: 'Estrellas en forma de flor con paleta floral', category: 'theme', price: 1500, themeId: 'enchanted-garden' },
  { itemId: 'theme-diamond-crystal', name: 'Cristal de Diamante', description: 'Estrellas cristalinas en un cielo helado', category: 'theme', price: 1500, themeId: 'diamond-crystal' },
  { itemId: 'theme-celestial-hearts', name: 'Corazones Celestiales', description: 'Estrellas en forma de corazón bajo un cielo romántico', category: 'theme', price: 1500, themeId: 'celestial-hearts' },
  { itemId: 'sky-slot', name: 'Espacio para cielo', description: 'Desbloquea un espacio adicional para crear cielos', category: 'sky-slot', price: 500 },
]

export function getShopItem(itemId: string): ShopItem | undefined {
  return SHOP_CATALOG.find(item => item.itemId === itemId)
}

export function getShopItemsByCategory(category: ShopItem['category']): ShopItem[] {
  return SHOP_CATALOG.filter(item => item.category === category)
}
