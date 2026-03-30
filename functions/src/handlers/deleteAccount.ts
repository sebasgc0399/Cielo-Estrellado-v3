import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { auth, db } from '../lib/firebaseAdmin.js'
import { deleteSkyData, executeBatchOps } from './skies.js'
import { logError } from '../logError.js'

async function deleteSubcollection(parentPath: string, subcollection: string): Promise<void> {
  const snap = await db.collection(`${parentPath}/${subcollection}`).get()
  if (snap.empty) return
  const ops = snap.docs.map((doc) => ({ type: 'delete' as const, ref: doc.ref }))
  await executeBatchOps(ops)
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const uid = decoded.uid

    const userRef = db.collection('users').doc(uid)
    const userSnap = await userRef.get()
    if (!userSnap.exists) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    // 1. Delete all skies owned by user
    const ownedSkies = await db.collectionGroup('members')
      .where('userId', '==', uid)
      .where('role', '==', 'owner')
      .where('status', '==', 'active')
      .get()

    for (const memberDoc of ownedSkies.docs) {
      const skyId = memberDoc.ref.parent.parent!.id
      await deleteSkyData(skyId)
    }

    // 2. Revoke memberships in other skies
    const otherMemberships = await db.collectionGroup('members')
      .where('userId', '==', uid)
      .where('role', 'in', ['editor', 'viewer'])
      .where('status', '==', 'active')
      .get()

    if (!otherMemberships.empty) {
      const revokeOps = otherMemberships.docs.map((doc) => ({
        type: 'update' as const,
        ref: doc.ref,
        data: { status: 'revoked' },
      }))
      await executeBatchOps(revokeOps)
    }

    // 3. Revoke pending invites created by user
    const pendingInvites = await db.collection('invites')
      .where('createdByUserId', '==', uid)
      .where('status', '==', 'pending')
      .get()

    if (!pendingInvites.empty) {
      const revokeOps = pendingInvites.docs.map((doc) => ({
        type: 'update' as const,
        ref: doc.ref,
        data: { status: 'revoked' },
      }))
      await executeBatchOps(revokeOps)
    }

    // 4. Delete user subcollections
    await deleteSubcollection(`users/${uid}`, 'transactions')
    await deleteSubcollection(`users/${uid}`, 'inventory')

    // 5. Delete user document
    await userRef.delete()

    // 6. Delete Firebase Auth (best-effort — data already gone, so respond ok regardless)
    try {
      await auth.deleteUser(uid)
    } catch (authError) {
      logError('Failed to delete Firebase Auth user (data already deleted)', authError)
    }

    res.status(200).json({ ok: true })
  } catch (error) {
    logError('deleteAccount failed', error)
    res.status(500).json({ error: 'Error interno al eliminar la cuenta' })
  }
}
