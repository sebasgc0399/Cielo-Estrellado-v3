import type { StardustPackage } from './contracts.js'

export const STARDUST_PACKAGES: StardustPackage[] = [
  { packageId: 'pack-500', name: 'Puñado de Polvo', stardustAmount: 500, priceInCents: 500000, bonusPercent: 0 },
  { packageId: 'pack-1500', name: 'Bolsa de Polvo', stardustAmount: 1500, priceInCents: 1200000, bonusPercent: 20 },
  { packageId: 'pack-3500', name: 'Frasco de Polvo', stardustAmount: 3500, priceInCents: 2500000, bonusPercent: 40 },
  { packageId: 'pack-8000', name: 'Cofre Constelación', stardustAmount: 8000, priceInCents: 5000000, bonusPercent: 60 },
  { packageId: 'pack-20000', name: 'Bóveda Galáctica', stardustAmount: 20000, priceInCents: 9900000, bonusPercent: 100 },
]

export function getStardustPackage(packageId: string): StardustPackage | undefined {
  return STARDUST_PACKAGES.find(p => p.packageId === packageId)
}
