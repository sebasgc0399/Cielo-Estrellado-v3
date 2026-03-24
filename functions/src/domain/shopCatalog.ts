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
  { itemId: 'sky-slot', name: 'Espacio para cielo', description: 'Desbloquea un espacio adicional para crear cielos', category: 'sky-slot', price: 500 },
]

export function getShopItem(itemId: string): ShopItem | undefined {
  return SHOP_CATALOG.find(item => item.itemId === itemId)
}

export function getShopItemsByCategory(category: ShopItem['category']): ShopItem[] {
  return SHOP_CATALOG.filter(item => item.category === category)
}
