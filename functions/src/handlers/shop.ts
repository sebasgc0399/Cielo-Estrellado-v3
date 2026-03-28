import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import type { QueryDocumentSnapshot, Transaction } from '@google-cloud/firestore'
import type { TransactionRecord, InventoryItem } from '../domain/contracts.js'
import { getShopItem, SHOP_CATALOG } from '../domain/shopCatalog.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'
import { logError } from '../logError.js'

class ShopError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function purchase(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const uid = decoded.uid

    const body = req.body as Record<string, unknown>
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : ''
    if (!itemId) {
      res.status(400).json({ error: 'itemId es requerido' })
      return
    }

    const item = getShopItem(itemId)
    if (!item) {
      res.status(400).json({ error: 'Item no existe en el catálogo' })
      return
    }

    const userRef = db.collection('users').doc(uid)
    const nowISO = new Date().toISOString()

    const result = await db.runTransaction(async (transaction: Transaction) => {
      const userSnap = await transaction.get(userRef)
      if (!userSnap.exists) {
        throw new ShopError('user_not_found', 'Usuario no encontrado')
      }

      const rawData = userSnap.data()!
      const stardust = typeof rawData.stardust === 'number' ? rawData.stardust : DEFAULT_USER_ECONOMY.stardust

      if (stardust < item.price) {
        throw new ShopError('insufficient_balance', 'Balance insuficiente')
      }

      const inventorySnap = await transaction.get(userRef.collection('inventory'))
      const ownedItemIds = new Set(
        inventorySnap.docs.map((doc: QueryDocumentSnapshot) => (doc.data() as InventoryItem).itemId),
      )

      if (item.category === 'theme' && ownedItemIds.has(item.itemId)) {
        throw new ShopError('already_owned', 'Ya posees este item')
      }

      const newBalance = stardust - item.price

      const updateData: Record<string, unknown> = { stardust: newBalance }
      if (item.category === 'sky-slot') {
        const currentMaxSkies = typeof rawData.maxSkies === 'number' ? rawData.maxSkies : DEFAULT_USER_ECONOMY.maxSkies
        updateData.maxSkies = currentMaxSkies + 1
      }
      transaction.update(userRef, updateData)

      const inventoryDoc: InventoryItem = {
        itemId: item.itemId,
        category: item.category,
        purchasedAt: nowISO,
        source: 'shop',
      }
      const newDocRef = userRef.collection('inventory').doc()
      transaction.create(newDocRef, inventoryDoc)

      // Audit log DENTRO de la transaccion
      const txDocRef = userRef.collection('transactions').doc()
      transaction.set(txDocRef, {
        type: 'spend',
        amount: item.price,
        reason: 'shop_purchase',
        itemId: item.itemId,
        balanceAfter: newBalance,
        createdAt: nowISO,
      } satisfies TransactionRecord)

      return { newBalance, itemId: item.itemId }
    })

    res.status(200).json({ newBalance: result.newBalance, itemId: result.itemId })
  } catch (error) {
    if (error instanceof ShopError) {
      const status = error.code === 'user_not_found' ? 404 : 400
      res.status(status).json({ error: error.message, code: error.code })
      return
    }
    logError('purchase failed', error)
    res.status(500).json({ error: 'Error interno al procesar compra' })
  }
}

export async function getCatalog(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const uid = decoded.uid
    const userRef = db.collection('users').doc(uid)

    const inventorySnap = await userRef.collection('inventory').get()
    const ownedItemIds = new Set(
      inventorySnap.docs.map((doc: QueryDocumentSnapshot) => (doc.data() as InventoryItem).itemId),
    )

    const catalog = SHOP_CATALOG.map(item => ({
      ...item,
      owned: ownedItemIds.has(item.itemId),
    }))

    res.status(200).json({ catalog })
  } catch (error) {
    logError('getCatalog failed', error)
    res.status(500).json({ error: 'Error interno al obtener catálogo' })
  }
}
