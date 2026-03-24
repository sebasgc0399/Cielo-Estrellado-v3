import { render, screen, fireEvent, act } from '@testing-library/react'
import { StardustOnboarding } from './StardustOnboarding'

vi.mock('@/components/ui/blur-fade', () => ({
  BlurFade: ({ children }: any) => <>{children}</>,
}))

vi.mock('lucide-react', () => ({
  X: (props: any) => <svg {...props} data-testid="x-icon" />,
}))

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('StardustOnboarding', () => {
  it('llama onDismiss después de 8 segundos', () => {
    const onDismiss = vi.fn()
    render(<StardustOnboarding onDismiss={onDismiss} />)

    expect(onDismiss).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(8000) })

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('llama onDismiss al click en X', () => {
    const onDismiss = vi.fn()
    render(<StardustOnboarding onDismiss={onDismiss} />)

    fireEvent.click(screen.getByLabelText('Cerrar'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
