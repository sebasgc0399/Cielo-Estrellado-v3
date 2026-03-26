import type { StardustPackage } from './contracts.js'

export const STARDUST_PACKAGES: StardustPackage[] = [
  { packageId: 'pack-500', name: 'Puñado de Polvo', stardustAmount: 500, priceInCents: 500000 },
  { packageId: 'pack-1500', name: 'Bolsa de Polvo', stardustAmount: 1375, priceInCents: 1200000 },
  { packageId: 'pack-3500', name: 'Frasco de Polvo', stardustAmount: 3000, priceInCents: 2500000 },
  { packageId: 'pack-8000', name: 'Cofre Constelación', stardustAmount: 7000, priceInCents: 5000000 },
  { packageId: 'pack-20000', name: 'Bóveda Galáctica', stardustAmount: 18000, priceInCents: 9900000 },
]

export function getStardustPackage(packageId: string): StardustPackage | undefined {
  return STARDUST_PACKAGES.find(p => p.packageId === packageId)
}
