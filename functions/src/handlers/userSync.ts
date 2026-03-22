import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { auth, db } from '../lib/firebaseAdmin.js'
import type { UserRecord } from '../domain/contracts.js'

export async function userSync(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const firebaseUser = await auth.getUser(decoded.uid)
    const now = new Date().toISOString()

    const userRef = db.collection('users').doc(decoded.uid)
    const userSnap = await userRef.get()

    if (userSnap.exists) {
      const existing = userSnap.data() as UserRecord

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
        providers: firebaseUser.providerData.map((p) => p.providerId),
        emailVerifiedAt,
        lastLoginAt: now,
      })
    } else {
      const newUser: UserRecord = {
        displayName: firebaseUser.displayName || null,
        email: firebaseUser.email || '',
        photoURL: firebaseUser.photoURL || null,
        providers: firebaseUser.providerData.map((p) => p.providerId),
        emailVerifiedAt: firebaseUser.emailVerified ? now : null,
        createdAt: now,
        lastLoginAt: now,
        status: 'active',
        sessionVersion: 1,
      }

      await userRef.set(newUser)
    }

    res.status(200).json({ status: 'ok' })
  } catch (error) {
    console.error('User sync failed:', error)
    res.status(500).json({ error: 'Error interno al sincronizar usuario' })
  }
}
