import { formatCompact } from './StardustBalance'

describe('formatCompact', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1_000, '1,000'],
    [9_999, '9,999'],
    [10_000, '10K'],
    [12_500, '12.5K'],
    [100_000, '100K'],
    [999_999, '999K'],
    [1_000_000, '1M'],
    [1_500_000, '1.5M'],
    [99_999_999, '100M'],
  ] as const)('formatCompact(%d) returns "%s"', (input, expected) => {
    expect(formatCompact(input)).toBe(expected)
  })
})
