import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { auth, db } from '../lib/firebaseAdmin.js'
import type { UserRecord, TransactionRecord } from '../domain/contracts.js'
import { WELCOME_BONUS } from '../domain/economyRules.js'
import { logError } from '../logError.js'

export async function userSync(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const firebaseUser = await auth.getUser(decoded.uid)
    const now = new Date().toISOString()

    const userRef = db.collection('users').doc(decoded.uid)
    const userSnap = await userRef.get()

    const welcomeTx: TransactionRecord = {
      type: 'earn',
      amount: WELCOME_BONUS,
      reason: 'welcome',
      itemId: null,
      balanceAfter: WELCOME_BONUS,
      createdAt: now,
    }

    if (userSnap.exists) {
      const rawData = userSnap.data()!
      const existing = rawData as UserRecord

      const emailVerifiedAt =
        existing.emailVerifiedAt !== null
          ? existing.emailVerifiedAt
          : firebaseUser.emailVerified
            ? now
            : null

      await userRef.update({
        email: firebaseUser.email || existing.email,
        displayName: firebaseUser.displayName || null,
        photoURL: firebaseUser.photoURL || null,
        providers: firebaseUser.providerData.map((p: { providerId: string }) => p.providerId),
        emailVerifiedAt,
        lastLoginAt: now,
      })
    } else {
      const newUser: UserRecord = {
        displayName: firebaseUser.displayName || null,
        email: firebaseUser.email || '',
        photoURL: firebaseUser.photoURL || null,
        providers: firebaseUser.providerData.map((p: { providerId: string }) => p.providerId),
        emailVerifiedAt: firebaseUser.emailVerified ? now : null,
        createdAt: now,
        lastLoginAt: now,
        status: 'active',
        stardust: WELCOME_BONUS,
        maxSkies: 2,
        maxMemberships: 20,
        lastDailyRewardDate: null,
        loginStreak: 0,
        previousStreak: 0,
        createdStarsToday: 0,
        lastStarCreationDate: null,
        weeklyBonusWeek: null,
        acceptedInvitesToday: 0,
        lastInviteAcceptDate: null,
        videoProcessedToday: 0,
        lastVideoProcessDate: null,
      }

      await db.runTransaction(async (t) => {
        const snap = await t.get(userRef)
        if (snap.exists) return // otro request concurrente ya creo el usuario
        t.set(userRef, newUser)
        t.create(userRef.collection('transactions').doc(), welcomeTx)
      })
    }

    res.status(200).json({ status: 'ok' })
  } catch (error) {
    logError('User sync failed', error)
    res.status(500).json({ error: 'Error interno al sincronizar usuario' })
  }
}
