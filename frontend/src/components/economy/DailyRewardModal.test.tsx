import { render, screen, fireEvent } from '@testing-library/react'
import { DailyRewardModal } from './DailyRewardModal'

vi.mock('motion/react', () => {
  const P = ({ children }: any) => <>{children}</>
  return { motion: { div: P }, AnimatePresence: P }
})

vi.mock('@/components/ui/blur-fade', () => ({
  BlurFade: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/components/ui/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}))

vi.mock('@/components/ui/shimmer-button', () => ({
  ShimmerButton: ({ children, onClick, className }: any) => (
    <button onClick={onClick} className={className}>{children}</button>
  ),
}))

describe('DailyRewardModal', () => {
  it('muestra total correcto (daily + weekly + streak)', () => {
    render(
      <DailyRewardModal
        rewards={{ daily: 10, weekly: 20, streak: 50, streakDays: 7 }}
        previousStreak={0}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('muestra mensaje de streak roto si previousStreak > 3 y streakDays === 1', () => {
    render(
      <DailyRewardModal
        rewards={{ daily: 10, weekly: 0, streak: 0, streakDays: 1 }}
        previousStreak={5}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/racha de 5/)).toBeInTheDocument()
  })

  it('llama onClose al hacer click en Genial', () => {
    const onClose = vi.fn()
    render(
      <DailyRewardModal
        rewards={{ daily: 10, weekly: 0, streak: 0, streakDays: 1 }}
        previousStreak={0}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByText('Genial'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
