import type { Request } from 'firebase-functions/v2/https'
import type { Response } from 'express'

export type RouteHandler = (req: Request, res: Response) => Promise<void>

interface Route {
  method: string
  pattern: string
  handler: RouteHandler
}

declare module 'firebase-functions/v2/https' {
  interface Request {
    routeParams: Record<string, string>
  }
}

function matchRoute(
  segments: string[],
  patternSegments: string[],
): Record<string, string> | null {
  if (segments.length !== patternSegments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i].startsWith(':')) {
      params[patternSegments[i].slice(1)] = segments[i]
    } else if (patternSegments[i] !== segments[i]) {
      return null
    }
  }
  return params
}

export function createRouter(routes: Route[]): RouteHandler {
  const compiled = routes.map((r) => ({
    ...r,
    patternSegments: r.pattern.split('/').filter(Boolean),
  }))

  return async (req, res) => {
    let path = req.path
    if (path.startsWith('/api/')) path = path.slice(4)
    else if (path === '/api') path = '/'

    const segments = path.split('/').filter(Boolean)

    for (const route of compiled) {
      if (req.method !== route.method) continue
      const params = matchRoute(segments, route.patternSegments)
      if (params) {
        req.routeParams = params
        await route.handler(req, res)
        return
      }
    }

    res.status(404).json({ error: 'Not found' })
  }
}
