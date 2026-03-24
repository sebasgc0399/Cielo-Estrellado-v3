import { render, screen, fireEvent } from '@testing-library/react'
import { StardustBalance } from './StardustBalance'

vi.mock('@/components/ui/number-ticker', () => ({
  NumberTicker: ({ value }: { value: number }) => <span>{value}</span>,
}))

describe('StardustBalance component', () => {
  it('muestra balance con NumberTicker cuando < 10K', () => {
    render(<StardustBalance balance={500} />)
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('muestra formato compacto cuando >= 10K y compact=true', () => {
    render(<StardustBalance balance={50000} compact />)
    expect(screen.getByText('50K')).toBeInTheDocument()
  })

  it('llama onClick al hacer click', () => {
    const onClick = vi.fn()
    render(<StardustBalance balance={100} onClick={onClick} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
