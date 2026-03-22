import { db } from './firebaseAdmin.js'
import type { SkyRecord, MemberRecord } from '../domain/contracts.js'

type AccessResult =
  | { ok: true; sky: SkyRecord; member: MemberRecord }
  | { ok: false; reason: 'not_found' | 'error' }

export async function getSkyWithAccess(skyId: string, uid: string): Promise<AccessResult> {
  try {
    const skyRef = db.collection('skies').doc(skyId)
    const [skySnap, memberSnap] = await Promise.all([
      skyRef.get(),
      skyRef.collection('members').doc(uid).get(),
    ])

    if (!skySnap.exists || !memberSnap.exists) {
      return { ok: false, reason: 'not_found' }
    }

    const member = memberSnap.data() as MemberRecord
    if (member.status !== 'active') {
      return { ok: false, reason: 'not_found' }
    }

    return {
      ok: true,
      sky: skySnap.data() as SkyRecord,
      member,
    }
  } catch (err) {
    console.error('getSkyWithAccess error:', err)
    return { ok: false, reason: 'error' }
  }
}
