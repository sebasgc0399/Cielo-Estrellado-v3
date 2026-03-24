import {
  DAILY_LOGIN_REWARD,
  STAR_CREATION_REWARD,
  FIRST_STAR_BONUS,
  STREAK_7_BONUS,
  STREAK_30_BONUS,
  INVITE_ACCEPTED_REWARD,
  WEEKLY_BONUS,
  WELCOME_BONUS,
  MAX_STARS_REWARD_PER_DAY,
  MAX_INVITE_REWARDS_PER_DAY,
} from './economyRules'

const ALL_CONSTANTS = {
  DAILY_LOGIN_REWARD,
  STAR_CREATION_REWARD,
  FIRST_STAR_BONUS,
  STREAK_7_BONUS,
  STREAK_30_BONUS,
  INVITE_ACCEPTED_REWARD,
  WEEKLY_BONUS,
  WELCOME_BONUS,
  MAX_STARS_REWARD_PER_DAY,
  MAX_INVITE_REWARDS_PER_DAY,
}

describe('economyRules', () => {
  it.each(Object.entries(ALL_CONSTANTS))(
    '%s is a positive number',
    (_name, value) => {
      expect(typeof value).toBe('number')
      expect(value).toBeGreaterThan(0)
    },
  )

  it('WELCOME_BONUS equals 100', () => {
    expect(WELCOME_BONUS).toBe(100)
  })

  it('MAX_STARS_REWARD_PER_DAY equals 10', () => {
    expect(MAX_STARS_REWARD_PER_DAY).toBe(10)
  })

  it('MAX_INVITE_REWARDS_PER_DAY equals 5', () => {
    expect(MAX_INVITE_REWARDS_PER_DAY).toBe(5)
  })
})
