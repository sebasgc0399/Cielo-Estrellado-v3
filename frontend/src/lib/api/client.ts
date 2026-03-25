import { auth } from '@/lib/firebase/client'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T = unknown>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await auth.currentUser?.getIdToken()

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json'
  }

  const response = await fetch(url, {
    ...options,
    headers,
  })

  if (!response.ok) {
    if (response.status === 401) {
      try {
        const { auth } = await import('@/lib/firebase/client')
        if (auth.currentUser) {
          await auth.currentUser.getIdToken(true)
          const newToken = await auth.currentUser.getIdToken()
          const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` }
          const retryResponse = await fetch(url, { ...options, headers: retryHeaders })
          if (retryResponse.ok) {
            if (retryResponse.status === 204) return undefined as T
            return retryResponse.json() as Promise<T>
          }
        }
      } catch {
        // Refresh failed
      }
      window.location.href = '/login'
      throw new ApiError(401, 'Sesión expirada')
    }

    const text = await response.text().catch(() => response.statusText)
    throw new ApiError(response.status, text)
  }

  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}
