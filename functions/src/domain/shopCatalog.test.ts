import { SHOP_CATALOG, getShopItem, getShopItemsByCategory } from './shopCatalog'

describe('shopCatalog', () => {
  it('has 8 items (7 themes + 1 sky-slot)', () => {
    expect(SHOP_CATALOG).toHaveLength(8)
  })

  it('getShopItem("sky-slot") returns item with price 500', () => {
    const item = getShopItem('sky-slot')
    expect(item).toBeDefined()
    expect(item!.price).toBe(500)
  })

  it('getShopItem("theme-aurora-borealis") returns item with category "theme"', () => {
    const item = getShopItem('theme-aurora-borealis')
    expect(item).toBeDefined()
    expect(item!.category).toBe('theme')
  })

  it('getShopItem("no-existe") returns undefined', () => {
    expect(getShopItem('no-existe')).toBeUndefined()
  })

  it('getShopItemsByCategory("theme") returns 7 items', () => {
    expect(getShopItemsByCategory('theme')).toHaveLength(7)
  })

  it('getShopItemsByCategory("sky-slot") returns 1 item', () => {
    expect(getShopItemsByCategory('sky-slot')).toHaveLength(1)
  })

  it('all items have required fields: itemId, name, category, price', () => {
    for (const item of SHOP_CATALOG) {
      expect(item.itemId).toBeTruthy()
      expect(item.name).toBeTruthy()
      expect(item.category).toBeTruthy()
      expect(item.price).toBeGreaterThan(0)
    }
  })

  it('all themes have themeId', () => {
    const themes = getShopItemsByCategory('theme')
    for (const theme of themes) {
      expect(theme.themeId).toBeTruthy()
    }
  })

  it('theme prices are 600 or 800 per SPEC_v2', () => {
    const themes = getShopItemsByCategory('theme')
    for (const theme of themes) {
      expect([600, 800]).toContain(theme.price)
    }
  })
})
