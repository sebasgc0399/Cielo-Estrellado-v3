export function getInitials(name: string | null | undefined, fallback?: string | null): string {
  const value = name || fallback
  if (!value) return '?'
  return value
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
