import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { auth, db } from '../lib/firebaseAdmin.js'
import type { UserRecord, TransactionRecord } from '../domain/contracts.js'
import { WELCOME_BONUS } from '../domain/economyRules.js'

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

      let migrated = false

      await db.runTransaction(async (transaction) => {
        const freshSnap = await transaction.get(userRef)
        const freshData = freshSnap.data()!

        if (freshData.stardust === undefined) {
          const ownerSnap = await db
            .collectionGroup('members')
            .where('userId', '==', decoded.uid)
            .where('role', '==', 'owner')
            .where('status', '==', 'active')
            .get()

          transaction.update(userRef, {
            stardust: WELCOME_BONUS,
            maxSkies: Math.max(2, ownerSnap.size),
            maxMemberships: 20,
            lastDailyRewardDate: null,
            loginStreak: 0,
            previousStreak: 0,
            createdStarsToday: 0,
            lastStarCreationDate: null,
            weeklyBonusWeek: null,
            acceptedInvitesToday: 0,
            lastInviteAcceptDate: null,
            status: 'active',
            sessionVersion: 1,
          })
          migrated = true
        }
      })

      if (migrated) {
        await userRef.collection('transactions').add(welcomeTx)
      }
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
        sessionVersion: 1,
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
      }

      await userRef.set(newUser)
      await userRef.collection('transactions').add(welcomeTx)
    }

    res.status(200).json({ status: 'ok' })
  } catch (error) {
    console.error('User sync failed:', error)
    res.status(500).json({ error: 'Error interno al sincronizar usuario' })
  }
}
