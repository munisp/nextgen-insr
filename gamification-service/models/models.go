package models

import "time"

type PointSource string

const (
	SourcePolicyPurchase PointSource = "policy_purchase"
	SourceClaimFreeYear  PointSource = "claim_free_year"
	SourceReferral       PointSource = "referral"
	SourceDocUpload      PointSource = "doc_upload"
	SourceEarlyPayment   PointSource = "early_payment"
	SourceChallenge      PointSource = "challenge_completion"
	SourceBadge          PointSource = "badge_earned"
)

type TierLevel string

const (
	TierBronze     TierLevel = "bronze"
	TierSilver     TierLevel = "silver"
	TierGold       TierLevel = "gold"
	TierPlatinum   TierLevel = "platinum"
	TierDiamond    TierLevel = "diamond"
)

type ActionAward struct {
	Action   string  `json:"action"`
	Points   int     `json:"points"`
	Limit    int     `json:"daily_limit"`
	Enabled  bool    `json:"enabled"`
}

type UserPoints struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	TotalPoints     int        `json:"total_points"`
	RedeemableValue float64    `json:"redeemable_value_naira"`
	Tier            TierLevel  `json:"tier"`
	PointsToNext    int        `json:"points_to_next"`
	NextTier        TierLevel  `json:"next_tier,omitempty"`
	LastAwardedAt   *time.Time `json:"last_awarded_at,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

type PointTransaction struct {
	ID        string      `json:"id"`
	UserID    string      `json:"user_id"`
	Source    PointSource `json:"source"`
	Action    string      `json:"action"`
	Points    int         `json:"points"`
	Balance   int         `json:"balance_after"`
	RefID     string      `json:"reference_id,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time   `json:"created_at"`
}

type RedeemType string

const (
	RedeemDiscount RedeemType = "discount"
	RedeemCash     RedeemType = "cashback"
)

type PointRedemption struct {
	ID             string      `json:"id"`
	UserID         string      `json:"user_id"`
	PointsUsed     int         `json:"points_used"`
	ValueNaira     float64     `json:"value_naira"`
	Type           RedeemType  `json:"type"`
	Status         string      `json:"status"` // pending, applied, cancelled
	Reference      string      `json:"reference,omitempty"`
	ExpiresAt      *time.Time  `json:"expires_at,omitempty"`
	CreatedAt      time.Time   `json:"created_at"`
	AppliedAt      *time.Time  `json:"applied_at,omitempty"`
}

type BadgeType string

const (
	BadgeFirstPolicy       BadgeType = "first_policy"
	BadgeClaimFreeChampion BadgeType = "claim_free_champion"
	BadgeSuperReferrer     BadgeType = "super_referrer"
	BadgeEarlyPayer        BadgeType = "early_payer"
	BadgeLoyalCustomer     BadgeType = "loyal_customer"
	BadgeReferralMilestone BadgeType = "referral_milestone"
	BadgeChallengeComplete BadgeType = "challenge_complete"
	BadgeGoldMember        BadgeType = "gold_member"
	BadgeDiamondMember     BadgeType = "diamond_member"
)

type Badge struct {
	ID          string    `json:"id"`
	BadgeID     string    `json:"badge_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Icon        string    `json:"icon"`
	Tier        TierLevel `json:"tier"`
	PointsReq   int       `json:"points_required"`
	ActionsReq  int       `json:"actions_required,omitempty"`
	Period      string    `json:"period,omitempty"` // 1y, 2y, lifetime
	CreatedAt   time.Time `json:"created_at"`
}

type UserBadge struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	BadgeID   string    `json:"badge_id"`
	BadgeName string    `json:"badge_name"`
	Icon      string    `json:"icon"`
	EarnedAt  time.Time `json:"earned_at"`
}

type LeaderboardPeriod string

const (
	PeriodWeekly   LeaderboardPeriod = "weekly"
	PeriodMonthly  LeaderboardPeriod = "monthly"
	PeriodAllTime  LeaderboardPeriod = "alltime"
)

type LeaderboardEntry struct {
	Rank     int     `json:"rank"`
	UserID   string  `json:"user_id"`
	UserName string  `json:"user_name"`
	Points   int     `json:"points"`
	Tier     TierLevel `json:"tier"`
	Region   string  `json:"region,omitempty"`
}

type ChallengeStatus string

const (
	ChallengeActive   ChallengeStatus = "active"
	ChallengeCompleted ChallengeStatus = "completed"
	ChallengeExpired  ChallengeStatus = "expired"
	ChallengeCancelled ChallengeStatus = "cancelled"
)

type Challenge struct {
	ID           string        `json:"id"`
	ChallengeID  string        `json:"challenge_id"`
	Title        string        `json:"title"`
	Description  string        `json:"description"`
	Rules        string        `json:"rules"`
	PointsReward int           `json:"points_reward"`
	StartDate    time.Time     `json:"start_date"`
	EndDate      time.Time     `json:"end_date"`
	MinAgeMonths int           `json:"min_age_months"`
	MaxParticipants int        `json:"max_participants"`
	IsActive     bool          `json:"is_active"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time     `json:"created_at"`
}

type UserChallengeProgress struct {
	ID            string        `json:"id"`
	UserID        string        `json:"user_id"`
	ChallengeID   string        `json:"challenge_id"`
	Progress      int           `json:"progress"`
	TotalRequired int           `json:"total_required"`
	Status        ChallengeStatus `json:"status"`
	JoinedAt      time.Time     `json:"joined_at"`
	CompletedAt   *time.Time    `json:"completed_at,omitempty"`
}

type ReferralStatus string

const (
	ReferralPending ReferralStatus = "pending"
	ReferralActive  ReferralStatus = "active"
	ReferralFailed  ReferralStatus = "failed"
)

type Referral struct {
	ID             string        `json:"id"`
	ReferrerID     string        `json:"referrer_id"`
	ReferredID     string        `json:"referred_id"`
	ReferralCode   string        `json:"referral_code"`
	Status         ReferralStatus `json:"status"`
	RewardAwarded  bool          `json:"reward_awarded"`
	AwardedPoints  int           `json:"awarded_points"`
	AwardedAt      *time.Time    `json:"awarded_at,omitempty"`
	ReferredAt     time.Time     `json:"referred_at"`
}

type RewardType string

const (
	RewardDiscount RewardType = "discount"
	RewardCashback RewardType = "cashback"
	RewardFreeMonth RewardType = "free_month"
)

type Reward struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Description  string     `json:"description"`
	PointsCost   int        `json:"points_cost"`
	ValueNaira   float64    `json:"value_naira"`
	Type         RewardType `json:"type"`
	IsActive     bool       `json:"is_active"`
	MaxRedemptions int      `json:"max_redemptions"`
	RedeemedCount  int      `json:"redeemed_count"`
	ExpirationDays int      `json:"expiration_days"`
	CreatedAt    time.Time  `json:"created_at"`
}

type RedemptionHistory struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	RewardID     string     `json:"reward_id"`
	RewardName   string     `json:"reward_name"`
	PointsSpent  int        `json:"points_spent"`
	ValueNaira   float64    `json:"value_naira"`
	Status       string     `json:"status"`
	Reference    string     `json:"reference,omitempty"`
	RedeemedAt   time.Time  `json:"redeemed_at"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	AppliedAt    *time.Time `json:"applied_at,omitempty"`
}

type TierDefinition struct {
	Tier        TierLevel `json:"tier"`
	MinPoints   int       `json:"min_points"`
	MaxPoints   int       `json:"max_points,omitempty"`
	DiscountPct float64   `json:"discount_percent"`
	Icon        string    `json:"icon"`
	Description string    `json:"description"`
}

type GamificationMetrics struct {
	TotalUsers    int64 `json:"total_users"`
	ActiveUsers   int64 `json:"active_users"`
	TotalPointsIssued int64 `json:"total_points_issued"`
	TotalPointsRedeemed int64 `json:"total_points_redeemed"`
	ActiveChallenges int `json:"active_challenges"`
	TotalChallengesCompleted int `json:"challenges_completed"`
	AvgPointsPerUser float64 `json:"avg_points_per_user"`
	TopTierCount   map[string]int64 `json:"top_tier_count"`
	ReferralsTotal int64 `json:"referrals_total"`
	RedemptionsToday int64 `json:"redemptions_today"`
}
