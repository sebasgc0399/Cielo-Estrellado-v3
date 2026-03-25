import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import type { DocumentReference, QueryDocumentSnapshot, Transaction } from '@google-cloud/firestore'
import type { TransactionRecord, InventoryItem } from '../domain/contracts.js'
import {
  DAILY_LOGIN_REWARD,
  STREAK_7_BONUS,
  STREAK_30_BONUS,
  WEEKLY_BONUS,
} from '../domain/economyRules.js'
import { DEFAULT_USER_ECONOMY } from '../domain/defaults.js'

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function getYesterday(todayUTC: string): string {
  const d = new Date(todayUTC + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function getEconomy(req: Request, res: Response): Promise<void> {
  try {
    res.set('Cache-Control', 'private, no-store')
    const decoded = await authenticateRequest(req)
    const userRef = db.collection('users').doc(decoded.uid)
    const now = new Date()
    const todayUTC = now.toISOString().slice(0, 10)
    const currentWeek = getISOWeek(now)
    const nowISO = now.toISOString()

    let rewardsDaily = 0
    let rewardsWeekly = 0
    let rewardsStreak = 0
    let streakDays = 0

    const result = await db.runTransaction(async (transaction: Transaction) => {
      // Reset en cada intento — previene valores stale en retry por contención
      rewardsDaily = 0
      rewardsWeekly = 0
      rewardsStreak = 0
      streakDays = 0

      const userSnap = await transaction.get(userRef)

      if (!userSnap.exists) {
        return null
      }

      const rawData = userSnap.data()!

      const stardust = typeof rawData.stardust === 'number' ? rawData.stardust : DEFAULT_USER_ECONOMY.stardust
      const loginStreak = typeof rawData.loginStreak === 'number' ? rawData.loginStreak : DEFAULT_USER_ECONOMY.loginStreak
      const previousStreak = typeof rawData.previousStreak === 'number' ? rawData.previousStreak : DEFAULT_USER_ECONOMY.previousStreak
      const lastDailyRewardDate = typeof rawData.lastDailyRewardDate === 'string' ? rawData.lastDailyRewardDate : DEFAULT_USER_ECONOMY.lastDailyRewardDate
      const weeklyBonusWeek = typeof rawData.weeklyBonusWeek === 'string' ? rawData.weeklyBonusWeek : DEFAULT_USER_ECONOMY.weeklyBonusWeek

      if (lastDailyRewardDate === todayUTC) {
        return {
          stardust,
          loginStreak,
          previousStreak,
          lastDailyRewardDate,
          weeklyBonusWeek,
          previousStardust: stardust,
        }
      }

      // Daily login reward
      rewardsDaily = DAILY_LOGIN_REWARD

      // Streak calculation
      let newStreak: number
      let newPreviousStreak = previousStreak
      const yesterday = getYesterday(todayUTC)

      if (lastDailyRewardDate === yesterday) {
        newStreak = loginStreak + 1
      } else {
        newPreviousStreak = loginStreak
        newStreak = 1
      }
      streakDays = newStreak

      // Streak bonuses
      if (newStreak === 7) {
        rewardsStreak = STREAK_7_BONUS
      } else if (newStreak === 30) {
        rewardsStreak = STREAK_30_BONUS
      }

      // Weekly bonus
      let newWeeklyBonusWeek = weeklyBonusWeek
      if (weeklyBonusWeek !== currentWeek) {
        rewardsWeekly = WEEKLY_BONUS
        newWeeklyBonusWeek = currentWeek
      }

      const totalRewards = rewardsDaily + rewardsWeekly + rewardsStreak
      const newStardust = stardust + totalRewards

      const updatePayload: Record<string, unknown> = {
        stardust: newStardust,
        lastDailyRewardDate: todayUTC,
        loginStreak: newStreak,
        previousStreak: newPreviousStreak,
        weeklyBonusWeek: newWeeklyBonusWeek,
      }

      const lastStarDate = typeof rawData.lastStarCreationDate === 'string' ? rawData.lastStarCreationDate : null
      const lastInviteDate = typeof rawData.lastInviteAcceptDate === 'string' ? rawData.lastInviteAcceptDate : null

      if (lastStarDate !== todayUTC) {
        updatePayload.createdStarsToday = 0
        updatePayload.lastStarCreationDate = null
      }

      if (lastInviteDate !== todayUTC) {
        updatePayload.acceptedInvitesToday = 0
        updatePayload.lastInviteAcceptDate = null
      }

      transaction.update(userRef, updatePayload)

      return {
        stardust: newStardust,
        loginStreak: newStreak,
        previousStreak: newPreviousStreak,
        lastDailyRewardDate: todayUTC,
        weeklyBonusWeek: newWeeklyBonusWeek,
        previousStardust: stardust,
      }
    })

    if (result === null) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    // Create transaction docs for rewards (outside transaction, append-only)
    const txPromises: Promise<DocumentReference>[] = []

    if (rewardsDaily > 0) {
      const tx: TransactionRecord = {
        type: 'earn',
        amount: rewardsDaily,
        reason: 'daily_login',
        itemId: null,
        balanceAfter: result.previousStardust + rewardsDaily,
        createdAt: nowISO,
      }
      txPromises.push(userRef.collection('transactions').add(tx))
    }

    if (rewardsWeekly > 0) {
      const tx: TransactionRecord = {
        type: 'earn',
        amount: rewardsWeekly,
        reason: 'weekly_bonus',
        itemId: null,
        balanceAfter: result.previousStardust + rewardsDaily + rewardsWeekly,
        createdAt: nowISO,
      }
      txPromises.push(userRef.collection('transactions').add(tx))
    }

    if (rewardsStreak > 0) {
      const tx: TransactionRecord = {
        type: 'earn',
        amount: rewardsStreak,
        reason: streakDays === 7 ? 'streak_7' : 'streak_30',
        itemId: null,
        balanceAfter: result.previousStardust + rewardsDaily + rewardsWeekly + rewardsStreak,
        createdAt: nowISO,
      }
      txPromises.push(userRef.collection('transactions').add(tx))
    }

    // Write audit logs (non-critical — balance is already updated)
    try {
      await Promise.all(txPromises)
    } catch (logError) {
      console.error('Failed to create audit log (balance already updated):', logError instanceof Error ? logError.message : logError)
    }

    // Read inventory
    const inventorySnap = await userRef.collection('inventory').get()

    const inventory: InventoryItem[] = inventorySnap.docs.map(
      (doc: QueryDocumentSnapshot) => doc.data() as InventoryItem,
    )

    res.status(200).json({
      stardust: result.stardust,
      loginStreak: result.loginStreak,
      previousStreak: result.previousStreak,
      lastDailyRewardDate: result.lastDailyRewardDate,
      weeklyBonusWeek: result.weeklyBonusWeek,
      inventory,
      rewards: {
        daily: rewardsDaily,
        weekly: rewardsWeekly,
        streak: rewardsStreak,
        streakDays,
      },
    })
  } catch (error) {
    console.error('getEconomy failed:', error)
    res.status(500).json({ error: 'Error interno al obtener economía' })
  }
}

export async function getTransactions(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const userRef = db.collection('users').doc(decoded.uid)

    const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 20
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 20 : rawLimit), 50)
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null

    let query = userRef
      .collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(limit)

    if (cursor) {
      const cursorDoc = await userRef.collection('transactions').doc(cursor).get()
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc)
      }
    }

    const snap = await query.get()

    const transactions = snap.docs.map((doc: QueryDocumentSnapshot) => {
      const data = doc.data()
      return {
        id: doc.id,
        type: data.type as TransactionRecord['type'],
        amount: data.amount as number,
        reason: data.reason as string,
        itemId: (data.itemId as string) ?? null,
        balanceAfter: data.balanceAfter as number,
        createdAt: data.createdAt as string,
      }
    })

    const nextCursor = transactions.length === limit
      ? transactions[transactions.length - 1].id
      : null

    res.status(200).json({ transactions, nextCursor })
  } catch (error) {
    console.error('getTransactions failed:', error)
    res.status(500).json({ error: 'Error interno al obtener transacciones' })
  }
}
