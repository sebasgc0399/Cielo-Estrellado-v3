import { renderHook, act } from '@testing-library/react'

const mockDriver = vi.fn()
const mockDrive = vi.fn()
const mockDestroy = vi.fn()

let capturedOnDestroyed: (() => void) | undefined

vi.mock('driver.js', () => ({
  driver: (...args: unknown[]) => {
    mockDriver(...args)
    const config = args[0] as Record<string, unknown>
    capturedOnDestroyed = config.onDestroyed as (() => void) | undefined
    return { drive: mockDrive, destroy: mockDestroy }
  },
}))

vi.mock('driver.js/dist/driver.css', () => ({}))

// Import AFTER mocks
const { useTour } = await import('./useTour')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  capturedOnDestroyed = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTour', () => {
  const defaultSteps = [
    { popover: { title: 'Step 1', description: 'Desc 1' } },
    { element: '#test', popover: { title: 'Step 2', description: 'Desc 2' } },
  ]

  it('no inicia si localStorage marca completado', async () => {
    localStorage.setItem('cielo-estrellado:tour-completed:test-tour', 'true')

    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockDriver).not.toHaveBeenCalled()
    expect(mockDrive).not.toHaveBeenCalled()
  })

  it('inicia si no esta completado y enabled=true', async () => {
    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockDriver).toHaveBeenCalledTimes(1)
    expect(mockDrive).toHaveBeenCalledTimes(1)

    const config = mockDriver.mock.calls[0][0]
    expect(config.steps).toEqual(defaultSteps)
    expect(config.popoverClass).toBe('cielo-tour-popover')
    expect(config.nextBtnText).toBe('Siguiente')
  })

  it('no inicia si enabled=false', async () => {
    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
      enabled: false,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockDriver).not.toHaveBeenCalled()
  })

  it('no inicia si steps esta vacio', async () => {
    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: [],
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockDriver).not.toHaveBeenCalled()
  })

  it('limpia driver en unmount', async () => {
    const { unmount } = renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(mockDrive).toHaveBeenCalledTimes(1)

    unmount()

    expect(mockDestroy).toHaveBeenCalledTimes(1)
  })

  it('marca completado en onDestroyed', async () => {
    const onComplete = vi.fn()

    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
      onComplete,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(capturedOnDestroyed).toBeDefined()

    act(() => { capturedOnDestroyed!() })

    expect(localStorage.getItem('cielo-estrellado:tour-completed:test-tour')).toBe('true')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('respeta delay custom', async () => {
    renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
      delay: 1000,
    }))

    await act(async () => { vi.advanceTimersByTime(500) })
    expect(mockDriver).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(600) })
    expect(mockDriver).toHaveBeenCalledTimes(1)
  })

  it('isActive refleja el estado del tour', async () => {
    const { result } = renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
    }))

    expect(result.current.isActive).toBe(false)

    await act(async () => { vi.advanceTimersByTime(600) })

    expect(result.current.isActive).toBe(true)

    act(() => { capturedOnDestroyed!() })

    expect(result.current.isActive).toBe(false)
  })

  it('restart limpia localStorage y reinicia', async () => {
    localStorage.setItem('cielo-estrellado:tour-completed:test-tour', 'true')

    const { result } = renderHook(() => useTour({
      tourId: 'test-tour',
      steps: defaultSteps,
    }))

    await act(async () => { vi.advanceTimersByTime(600) })
    expect(mockDriver).not.toHaveBeenCalled()

    await act(async () => { result.current.restart() })

    expect(localStorage.getItem('cielo-estrellado:tour-completed:test-tour')).toBeNull()
    expect(mockDriver).toHaveBeenCalledTimes(1)
  })
})
