// Normalized persisted domain records for runtime and migration work.

export type IsoDateString = string

export type SkyPrivacy = 'private'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type MemberStatus = 'active' | 'revoked' | 'pending'
export type UserStatus = 'active' | 'pending' | 'disabled'
export type InviteRole = 'editor' | 'viewer'
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'
export type SkyDensity = 'low' | 'medium' | 'high'

export interface SkyPersonalization {
  density: SkyDensity
  nebulaEnabled: boolean
  twinkleEnabled: boolean
  shootingStarsEnabled: boolean
}

export interface UserRecord {
  displayName: string | null
  email: string
  photoURL: string | null
  providers: string[]
  emailVerifiedAt: IsoDateString | null
  createdAt: IsoDateString
  lastLoginAt: IsoDateString | null
  status: UserStatus
  sessionVersion: number
  stardust: number
  maxSkies: number
  maxMemberships: number
  lastDailyRewardDate: string | null
  loginStreak: number
  previousStreak: number
  createdStarsToday: number
  lastStarCreationDate: string | null
  weeklyBonusWeek: string | null
  acceptedInvitesToday: number
  lastInviteAcceptDate: string | null
}

export interface SkyRecord {
  title: string
  description: string | null
  ownerUserId: string | null
  privacy: SkyPrivacy
  coverImagePath: string | null
  personalization: SkyPersonalization
  themeId: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
}

export interface StarRecord {
  title: string | null
  message: string | null
  imagePath: string | null
  xNormalized: number | null
  yNormalized: number | null
  year: number | null
  authorUserId: string | null
  updatedByUserId: string | null
  createdAt: IsoDateString
  updatedAt: IsoDateString
  deletedAt: IsoDateString | null
  deletedByUserId: string | null
}

export interface MemberRecord {
  userId: string
  role: MemberRole
  status: MemberStatus
  invitedByUserId: string | null
  joinedAt: IsoDateString
}

export interface InviteRecord {
  skyId: string
  role: InviteRole
  tokenHash: string
  createdByUserId: string
  expiresAt: IsoDateString
  status: InviteStatus
  acceptedByUserId: string | null
  acceptedAt: IsoDateString | null
}

export interface InventoryItem {
  itemId: string
  category: 'theme' | 'sky-slot'
  purchasedAt: IsoDateString
  source: 'shop' | 'gift' | 'promo'
}

export interface TransactionRecord {
  type: 'earn' | 'spend'
  amount: number
  reason: string
  itemId: string | null
  balanceAfter: number
  createdAt: IsoDateString
}

export const DEFAULT_SKY_PERSONALIZATION: SkyPersonalization = {
  density: 'medium',
  nebulaEnabled: true,
  twinkleEnabled: true,
  shootingStarsEnabled: true,
}
