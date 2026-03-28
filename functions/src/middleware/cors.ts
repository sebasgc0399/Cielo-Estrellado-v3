import { type Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS'
const ALLOWED_HEADERS = 'Content-Type, Authorization'

function getAllowedOrigin(requestOrigin: string | undefined): string | null {
  if (!requestOrigin) return null
  if (process.env.NODE_ENV !== 'production' && requestOrigin === 'http://localhost:5173') {
    return requestOrigin
  }
  const appUrl = process.env.APP_URL
  if (appUrl && requestOrigin === appUrl) return requestOrigin
  return null
}

export function handleCors(req: Request, res: Response): boolean {
  const origin = getAllowedOrigin(req.headers.origin)
  if (origin) {
    res.set('Access-Control-Allow-Origin', origin)
    res.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
    res.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    res.set('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return true
  }
  return false
}
