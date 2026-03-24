import { renderHook, waitFor, act } from '@testing-library/react'
import type { EconomyData } from './useUserEconomy'

const mockApi = vi.fn()
const mockUseAuth = vi.fn()

vi.mock('@/lib/api/client', () => ({
  api: (...args: unknown[]) => mockApi(...args),
}))

vi.mock('@/lib/auth/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

// Import AFTER mocks
const { useUserEconomy } = await import('./useUserEconomy')

const MOCK_ECONOMY: EconomyData = {
  stardust: 100,
  loginStreak: 3,
  previousStreak: 0,
  lastDailyRewardDate: '2026-01-15',
  weeklyBonusWeek: '2026-W03',
  inventory: [],
  rewards: { daily: 10, weekly: 0, streak: 0, streakDays: 3 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseAuth.mockReturnValue({ user: { uid: 'test-uid' }, loading: false })
  mockApi.mockResolvedValue(MOCK_ECONOMY)
})

describe('useUserEconomy', () => {
  it('fetcha economia con usuario autenticado', async () => {
    const { result } = renderHook(() => useUserEconomy())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApi).toHaveBeenCalledWith('/api/user/economy')
    expect(result.current.economy).toEqual(MOCK_ECONOMY)
    expect(result.current.error).toBeNull()
  })

  it('no fetcha sin usuario', async () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false })

    const { result } = renderHook(() => useUserEconomy())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApi).not.toHaveBeenCalled()
    expect(result.current.economy).toBeNull()
  })

  it('refetch re-ejecuta el fetch', async () => {
    const { result } = renderHook(() => useUserEconomy())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(mockApi).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.refetch()
    })

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledTimes(2)
    })
  })

  it('addStardust actualiza optimistamente', async () => {
    const { result } = renderHook(() => useUserEconomy())

    await waitFor(() => {
      expect(result.current.economy).not.toBeNull()
    })

    act(() => {
      result.current.addStardust(50)
    })

    expect(result.current.economy!.stardust).toBe(150)
  })

  it('error se expone en el hook', async () => {
    mockApi.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useUserEconomy())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error!.message).toBe('Network error')
    expect(result.current.economy).toBeNull()
  })
})
