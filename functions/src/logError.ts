export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const code = error != null && typeof (error as Record<string, unknown>).code === 'string'
    ? (error as Record<string, unknown>).code as string : undefined
  console.error(`${context}:`, code ? `[${code}] ${message}` : message)
}
