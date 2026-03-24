import { formatRelativeDate } from './TransactionHistory'

const NOW = new Date('2026-01-15T12:00:00Z')

const SPANISH_WEEKDAYS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('formatRelativeDate', () => {
  it('5 minutes ago returns "Hace 5m"', () => {
    const date = new Date(NOW.getTime() - 5 * 60_000)
    expect(formatRelativeDate(date.toISOString())).toBe('Hace 5m')
  })

  it('0 minutes ago returns "Hace 1m" (minimum 1)', () => {
    expect(formatRelativeDate(NOW.toISOString())).toBe('Hace 1m')
  })

  it('3 hours ago returns "Hace 3h"', () => {
    const date = new Date(NOW.getTime() - 3 * 3_600_000)
    expect(formatRelativeDate(date.toISOString())).toBe('Hace 3h')
  })

  it('yesterday returns "Ayer"', () => {
    const yesterday = new Date('2026-01-14T12:00:00Z')
    expect(formatRelativeDate(yesterday.toISOString())).toBe('Ayer')
  })

  it('3 days ago returns Spanish weekday name', () => {
    const date = new Date('2026-01-12T12:00:00Z')
    const result = formatRelativeDate(date.toISOString())
    expect(SPANISH_WEEKDAYS).toContain(result)
  })

  it('14 days ago returns "DD mmm" format', () => {
    const date = new Date('2026-01-01T12:00:00Z')
    const result = formatRelativeDate(date.toISOString())
    expect(result).toMatch(/^\d{1,2}\s\w{3}/)
  })
})
