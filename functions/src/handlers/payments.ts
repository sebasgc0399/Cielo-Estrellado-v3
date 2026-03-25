import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'
import { authenticateRequest } from '../middleware/auth.js'
import { db } from '../lib/firebaseAdmin.js'
import { createHash, randomBytes } from 'node:crypto'
import type { PaymentRecord, TransactionRecord } from '../domain/contracts.js'
import { getStardustPackage } from '../domain/stardustPackages.js'

class PaymentError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

export async function createPayment(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const uid = decoded.uid

    const body = req.body as Record<string, unknown>
    const packageId = typeof body.packageId === 'string' ? body.packageId.trim() : ''
    if (!packageId) {
      res.status(400).json({ error: 'packageId es requerido' })
      return
    }

    const pkg = getStardustPackage(packageId)
    if (!pkg) {
      res.status(400).json({ error: 'Paquete no existe' })
      return
    }

    const integritySecret = process.env.WOMPI_INTEGRITY_SECRET
    if (!integritySecret) {
      console.error('WOMPI_INTEGRITY_SECRET not configured')
      res.status(500).json({ error: 'Error de configuración de pagos' })
      return
    }

    const publicKey = process.env.WOMPI_PUBLIC_KEY
    if (!publicKey) {
      console.error('WOMPI_PUBLIC_KEY not configured')
      res.status(500).json({ error: 'Error de configuración de pagos' })
      return
    }

    const reference = `ce-${uid.slice(0, 8)}-${Date.now()}-${randomBytes(4).toString('hex')}`

    const integritySignature = createHash('sha256')
      .update(`${reference}${pkg.priceInCents}COP${integritySecret}`)
      .digest('hex')

    const nowISO = new Date().toISOString()

    const paymentDoc: PaymentRecord = {
      userId: uid,
      packageId: pkg.packageId,
      amountInCents: pkg.priceInCents,
      currency: 'COP',
      stardustAmount: pkg.stardustAmount,
      wompiTransactionId: null,
      wompiReference: reference,
      status: 'pending',
      paymentMethod: null,
      createdAt: nowISO,
      resolvedAt: null,
    }

    const docRef = await db.collection('payments').add(paymentDoc)

    res.status(200).json({
      paymentId: docRef.id,
      reference,
      amountInCents: pkg.priceInCents,
      currency: 'COP',
      integritySignature,
      publicKey,
    })
  } catch (error) {
    if (error instanceof PaymentError) {
      res.status(400).json({ error: error.message, code: error.code })
      return
    }
    console.error('createPayment failed:', error)
    res.status(500).json({ error: 'Error interno al crear pago' })
  }
}

export async function wompiWebhook(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as Record<string, unknown>
    const signature = body.signature as Record<string, unknown> | undefined
    const timestamp = body.timestamp as number | undefined
    const event = body.event as string | undefined

    if (!signature || !timestamp || !event) {
      res.status(200).json({ message: 'Invalid payload, ignored' })
      return
    }

    const properties = signature.properties as string[] | undefined
    const checksum = signature.checksum as string | undefined

    if (!properties || !checksum) {
      res.status(200).json({ message: 'Missing signature fields, ignored' })
      return
    }

    const eventsSecret = process.env.WOMPI_EVENTS_SECRET
    if (!eventsSecret) {
      console.error('WOMPI_EVENTS_SECRET not configured')
      res.status(200).json({ message: 'Configuration error' })
      return
    }

    // Validate webhook signature: navigate body by property paths, concat + hash
    const values = properties.map((prop: string) => {
      const parts = prop.split('.')
      let current: unknown = body
      for (const part of parts) {
        if (current !== null && typeof current === 'object') {
          current = (current as Record<string, unknown>)[part]
        } else {
          return ''
        }
      }
      return String(current ?? '')
    })

    const concatenated = values.join('') + String(timestamp) + eventsSecret
    const computedHash = createHash('sha256').update(concatenated).digest('hex')

    if (computedHash !== checksum) {
      console.warn('Webhook signature mismatch')
      res.status(200).json({ message: 'Invalid signature' })
      return
    }

    // Extract transaction data
    const data = body.data as Record<string, unknown> | undefined
    const transaction = data?.transaction as Record<string, unknown> | undefined

    if (!transaction) {
      res.status(200).json({ message: 'No transaction data' })
      return
    }

    const wompiReference = String(transaction.reference ?? '')
    const wompiStatus = String(transaction.status ?? '')
    const wompiTransactionId = String(transaction.id ?? '')
    const wompiPaymentMethod = typeof transaction.payment_method_type === 'string'
      ? transaction.payment_method_type
      : null

    if (!wompiReference) {
      res.status(200).json({ message: 'No reference' })
      return
    }

    // Find PaymentRecord by reference
    const paymentsSnap = await db.collection('payments')
      .where('wompiReference', '==', wompiReference)
      .limit(1)
      .get()

    if (paymentsSnap.empty) {
      console.warn(`No payment found for reference: ${wompiReference}`)
      res.status(200).json({ message: 'Payment not found' })
      return
    }

    const paymentDocRef = paymentsSnap.docs[0].ref
    const paymentData = paymentsSnap.docs[0].data() as PaymentRecord

    // Defense in depth: verificar que el monto del webhook coincide con el del payment
    const wompiAmount = typeof transaction.amount_in_cents === 'number'
      ? transaction.amount_in_cents
      : Number(transaction.amount_in_cents ?? 0)

    if (wompiAmount !== paymentData.amountInCents) {
      console.error('Webhook amount mismatch:', {
        expected: paymentData.amountInCents,
        received: wompiAmount,
        reference: wompiReference,
      })
      res.status(200).json({ message: 'Amount mismatch' })
      return
    }

    // Idempotency: already processed
    if (paymentData.status !== 'pending') {
      res.status(200).json({ message: 'Already processed' })
      return
    }

    const nowISO = new Date().toISOString()

    if (wompiStatus === 'APPROVED') {
      // Atomic: credit stardust + update payment status
      const userRef = db.collection('users').doc(paymentData.userId)

      const newBalance = await db.runTransaction(async (firestoreTransaction) => {
        const userSnap = await firestoreTransaction.get(userRef)
        if (!userSnap.exists) {
          throw new PaymentError('user_not_found', 'Usuario no encontrado')
        }

        const userData = userSnap.data()!
        const currentStardust = typeof userData.stardust === 'number' ? userData.stardust : 0
        const balance = currentStardust + paymentData.stardustAmount

        firestoreTransaction.update(userRef, { stardust: balance })
        firestoreTransaction.update(paymentDocRef, {
          status: 'approved',
          wompiTransactionId,
          paymentMethod: wompiPaymentMethod,
          resolvedAt: nowISO,
        })

        return balance
      })

      // Audit log (append-only, outside transaction)
      const txRecord: TransactionRecord = {
        type: 'earn',
        amount: paymentData.stardustAmount,
        reason: 'purchase',
        itemId: paymentData.packageId,
        balanceAfter: newBalance,
        createdAt: nowISO,
      }
      await db.collection('users').doc(paymentData.userId).collection('transactions').add(txRecord)
    } else {
      // DECLINED, ERROR, VOIDED
      const mappedStatus = wompiStatus === 'DECLINED' ? 'declined'
        : wompiStatus === 'VOIDED' ? 'voided'
        : 'error'

      await paymentDocRef.update({
        status: mappedStatus,
        wompiTransactionId,
        paymentMethod: wompiPaymentMethod,
        resolvedAt: nowISO,
      })
    }

    res.status(200).json({ message: 'OK' })
  } catch (error) {
    // Always return 200 to Wompi to prevent retries on our errors
    console.error('wompiWebhook error:', error)
    res.status(200).json({ message: 'Internal error, logged' })
  }
}

export async function getPaymentStatus(req: Request, res: Response): Promise<void> {
  try {
    const decoded = await authenticateRequest(req)
    const reference = req.routeParams.reference

    if (!reference) {
      res.status(400).json({ error: 'reference es requerido' })
      return
    }

    const paymentsSnap = await db.collection('payments')
      .where('wompiReference', '==', reference)
      .where('userId', '==', decoded.uid)
      .limit(1)
      .get()

    if (paymentsSnap.empty) {
      res.status(404).json({ error: 'Pago no encontrado' })
      return
    }

    const payment = paymentsSnap.docs[0].data() as PaymentRecord

    res.status(200).json({
      status: payment.status,
      stardustAmount: payment.stardustAmount,
    })
  } catch (error) {
    console.error('getPaymentStatus failed:', error)
    res.status(500).json({ error: 'Error interno al consultar estado de pago' })
  }
}
