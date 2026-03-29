import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { logError } from '../logError.js'

export async function acceptTerms(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const termsVersion = req.body?.termsVersion as string | undefined

    if (!termsVersion) {
      res.status(400).json({ error: 'termsVersion requerido' })
      return
    }

    const now = new Date().toISOString()
    await db.collection('users').doc(decoded.uid).update({
      acceptedTermsAt: now,
      acceptedTermsVersion: termsVersion,
    })

    res.status(200).json({ status: 'ok' })
  } catch (error) {
    logError('Accept terms failed', error)
    res.status(500).json({ error: 'Error interno al aceptar terminos' })
  }
}
