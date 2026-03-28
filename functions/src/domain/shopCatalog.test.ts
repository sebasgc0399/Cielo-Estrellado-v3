import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SHOP_CATALOG, getShopItem, getShopItemsByCategory } from './shopCatalog'

describe('shopCatalog', () => {
  it('has 14 items (13 themes + 1 sky-slot)', () => {
    expect(SHOP_CATALOG).toHaveLength(14)
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

  it('getShopItemsByCategory("theme") returns 13 items', () => {
    expect(getShopItemsByCategory('theme')).toHaveLength(13)
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

  it('theme prices are 600, 800, 1200, or 1500', () => {
    const themes = getShopItemsByCategory('theme')
    for (const theme of themes) {
      expect([600, 800, 1200, 1500]).toContain(theme.price)
    }
  })
})

describe('frontend/backend catalog sync', () => {
  it('shopCatalog.ts es identico en frontend y functions', () => {
    const backendPath = resolve(process.cwd(), 'src/domain/shopCatalog.ts')
    const frontendPath = resolve(process.cwd(), '../frontend/src/domain/shopCatalog.ts')
    const backend = readFileSync(backendPath, 'utf-8')
    const frontend = readFileSync(frontendPath, 'utf-8')
    expect(backend).toBe(frontend)
  })

  it('economyRules.ts es identico en frontend y functions', () => {
    const backendPath = resolve(process.cwd(), 'src/domain/economyRules.ts')
    const frontendPath = resolve(process.cwd(), '../frontend/src/domain/economy.ts')
    const backend = readFileSync(backendPath, 'utf-8')
    const frontend = readFileSync(frontendPath, 'utf-8')
    expect(backend).toBe(frontend)
  })
})
