// Normalized persisted domain records for runtime and migration work.

export type IsoDateString = string

export type SkyPrivacy = 'private'
export type MemberRole = 'owner' | 'editor' | 'viewer'
export type MemberStatus = 'active' | 'revoked'
export type UserStatus = 'active' | 'pending' | 'disabled'
export type InviteRole = 'editor' | 'viewer'
export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'
export type SkyDensity = 'low' | 'medium' | 'high'
export type MediaType = 'image' | 'video'
export type MediaStatus = 'processing' | 'ready' | 'error'

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
  videoProcessedToday: number
  lastVideoProcessDate: string | null
  acceptedTermsAt: IsoDateString | null
  acceptedTermsVersion: string
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
  title: string
  message: string | null
  mediaType: MediaType | null
  mediaStatus: MediaStatus | null
  mediaPath: string | null
  thumbnailPath: string | null
  mediaDuration: number | null
  xNormalized: number | null
  yNormalized: number | null
  year: number | null
  authorUserId: string
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
  expiresAt: FirebaseFirestore.Timestamp
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
  details?: Array<{ amount: number; reason: string }>
}

export type PaymentStatus = 'pending' | 'approved' | 'declined' | 'error' | 'voided'

export interface PaymentRecord {
  userId: string
  packageId: string
  amountInCents: number
  currency: 'COP'
  stardustAmount: number
  wompiTransactionId: string | null
  wompiReference: string
  status: PaymentStatus
  paymentMethod: string | null
  createdAt: IsoDateString
  resolvedAt: IsoDateString | null
}

export interface StardustPackage {
  packageId: string
  name: string
  stardustAmount: number
  priceInCents: number
}

export const DEFAULT_SKY_PERSONALIZATION: SkyPersonalization = {
  density: 'medium',
  nebulaEnabled: true,
  twinkleEnabled: true,
  shootingStarsEnabled: true,
}
