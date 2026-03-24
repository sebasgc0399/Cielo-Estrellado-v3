import { render, screen } from '@testing-library/react'
import { StreakIndicator } from './StreakIndicator'

describe('StreakIndicator', () => {
  it('0 dots completados con streak 0', () => {
    render(<StreakIndicator currentStreak={0} previousStreak={0} />)
    expect(screen.queryAllByText('✦')).toHaveLength(0)
  })

  it('3 dots completados con streak 3', () => {
    render(<StreakIndicator currentStreak={3} previousStreak={0} />)
    expect(screen.getAllByText('✦')).toHaveLength(3)
  })

  it('7 dots completados con streak 7', () => {
    render(<StreakIndicator currentStreak={7} previousStreak={0} />)
    expect(screen.getAllByText('✦')).toHaveLength(7)
  })

  it('muestra "🔥 Nd" cuando streak >= 7', () => {
    const { container } = render(<StreakIndicator currentStreak={10} previousStreak={0} />)
    expect(container.textContent).toContain('🔥')
    expect(container.textContent).toContain('10')
  })
})
