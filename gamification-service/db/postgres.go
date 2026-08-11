package db

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/insureportal/gamification_service/config"
	"github.com/insureportal/gamification_service/models"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Postgres struct {
	Pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, cfg *config.PostgresConfig) (*Postgres, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("parse postgres config: %w", err)
	}
	poolCfg.MaxConns = int32(cfg.MaxOpenConns)
	poolCfg.MinConns = 3
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) Close() {
	if p != nil && p.Pool != nil {
		p.Pool.Close()
	}
}

func (p *Postgres) RunMigrations(ctx context.Context) error {
	migrations := []string{
		`CREATE TABLE IF NOT EXISTS user_points (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) UNIQUE NOT NULL,
			total_points INT NOT NULL DEFAULT 0,
			redeemable_value_naira DECIMAL(10,2) NOT NULL DEFAULT 0,
			tier VARCHAR(32) NOT NULL DEFAULT 'bronze',
			pts_to_next INT NOT NULL DEFAULT 0,
			next_tier VARCHAR(32),
			last_awarded_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			updated_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_user_points_tier ON user_points(tier)`,

		`CREATE TABLE IF NOT EXISTS point_transactions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) NOT NULL,
			source VARCHAR(64) NOT NULL,
			action VARCHAR(128) NOT NULL,
			points INT NOT NULL,
			balance_after INT NOT NULL,
			reference_id VARCHAR(128),
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ptxn_user ON point_transactions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_ptxn_source ON point_transactions(source)`,
		`CREATE INDEX IF NOT EXISTS idx_ptxn_created ON point_transactions(created_at)`,

		`CREATE TABLE IF NOT EXISTS point_redemptions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) NOT NULL,
			points_used INT NOT NULL,
			value_naira DECIMAL(10,2) NOT NULL,
			type VARCHAR(32) NOT NULL DEFAULT 'discount',
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			reference VARCHAR(128),
			expires_at TIMESTAMPTZ,
			created_at TIMESTAMPTZ DEFAULT NOW(),
			applied_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_redem_user ON point_redemptions(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_redem_status ON point_redemptions(status)`,

		`CREATE TABLE IF NOT EXISTS badges (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			badge_id VARCHAR(64) UNIQUE NOT NULL,
			name VARCHAR(128) NOT NULL,
			description TEXT,
			icon VARCHAR(64) NOT NULL DEFAULT 'star',
			tier VARCHAR(32) NOT NULL DEFAULT 'bronze',
			points_required INT NOT NULL DEFAULT 0,
			actions_required INT,
			period VARCHAR(16) DEFAULT 'lifetime',
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_badges_tier ON badges(tier)`,

		`CREATE TABLE IF NOT EXISTS user_badges (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) NOT NULL,
			badge_id VARCHAR(64) NOT NULL REFERENCES badges(badge_id),
			badge_name VARCHAR(128),
			icon VARCHAR(64),
			earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ub_user ON user_badges(user_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ub_user_badge ON user_badges(user_id, badge_id)`,

		`CREATE TABLE IF NOT EXISTS challenges (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			challenge_id VARCHAR(64) UNIQUE NOT NULL,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			rules TEXT,
			points_reward INT NOT NULL DEFAULT 0,
			start_date TIMESTAMPTZ NOT NULL,
			end_date TIMESTAMPTZ NOT NULL,
			min_age_months INT NOT NULL DEFAULT 0,
			max_participants INT NOT NULL DEFAULT 0,
			is_active BOOLEAN NOT NULL DEFAULT true,
			metadata JSONB DEFAULT '{}'::jsonb,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(is_active, start_date, end_date)`,

		`CREATE TABLE IF NOT EXISTS user_challenge (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) NOT NULL,
			challenge_id VARCHAR(64) NOT NULL,
			progress INT NOT NULL DEFAULT 0,
			total_required INT NOT NULL DEFAULT 0,
			status VARCHAR(32) NOT NULL DEFAULT 'active',
			joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			completed_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_uc_user ON user_challenge(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_uc_challenge ON user_challenge(challenge_id)`,

		`CREATE TABLE IF NOT EXISTS referrals (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			referrer_id VARCHAR(64) NOT NULL,
			referred_id VARCHAR(64) NOT NULL,
			referral_code VARCHAR(64) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			reward_awarded BOOLEAN NOT NULL DEFAULT false,
			awarded_points INT NOT NULL DEFAULT 0,
			awarded_at TIMESTAMPTZ,
			referred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_ref_referrer ON referrals(referrer_id)`,
		`CREATE INDEX IF NOT EXISTS idx_ref_referred ON referrals(referred_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ref_pair ON referrals(referrer_id, referred_id)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_ref_code ON referrals(referral_code)`,

		`CREATE TABLE IF NOT EXISTS rewards (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			name VARCHAR(255) NOT NULL,
			description TEXT,
			points_cost INT NOT NULL,
			value_naira DECIMAL(10,2) NOT NULL,
			type VARCHAR(32) NOT NULL DEFAULT 'discount',
			is_active BOOLEAN NOT NULL DEFAULT true,
			max_redemptions INT NOT NULL DEFAULT 0,
			redeemed_count INT NOT NULL DEFAULT 0,
			expiration_days INT NOT NULL DEFAULT 90,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_rewards_active ON rewards(is_active)`,

		`CREATE TABLE IF NOT EXISTS redemption_history (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			user_id VARCHAR(64) NOT NULL,
			reward_id VARCHAR(64),
			reward_name VARCHAR(255),
			points_spent INT NOT NULL,
			value_naira DECIMAL(10,2) NOT NULL,
			status VARCHAR(32) NOT NULL DEFAULT 'pending',
			reference VARCHAR(128),
			redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			expires_at TIMESTAMPTZ,
			applied_at TIMESTAMPTZ
		)`,
		`CREATE INDEX IF NOT EXISTS idx_redhist_user ON redemption_history(user_id)`,
		`CREATE INDEX IF NOT EXISTS idx_redhist_date ON redemption_history(redeemed_at)`,

		`CREATE TABLE IF NOT EXISTS tier_definitions (
			id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			tier VARCHAR(32) UNIQUE NOT NULL,
			min_points INT NOT NULL,
			max_points INT,
			discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
			icon VARCHAR(64) NOT NULL,
			description TEXT,
			created_at TIMESTAMPTZ DEFAULT NOW()
		)`,
	}

	for _, migration := range migrations {
		if _, err := p.Pool.Exec(ctx, migration); err != nil {
			return fmt.Errorf("execute migration: %w", err)
		}
	}
	return nil
}

func toJSON(v interface{}) ([]byte, error) { return json.Marshal(v) }
func fromJSON(data string, v interface{}) error {
	if data == "" || data == "null" {
		return nil
	}
	return json.Unmarshal([]byte(data), v)
}

// ===== User Points CRUD =====

// UpsertUserPoints creates or updates a user's total point balance.
func (p *Postgres) UpsertUserPoints(ctx context.Context, up *models.UserPoints) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO user_points
			(user_id, total_points, redeemable_value_naira, tier, pts_to_next, next_tier, last_awarded_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (user_id) DO UPDATE SET
			total_points = EXCLUDED.total_points,
			redeemable_value_naira = EXCLUDED.redeemable_value_naira,
			tier = EXCLUDED.tier,
			pts_to_next = EXCLUDED.pts_to_next,
			next_tier = EXCLUDED.next_tier,
			last_awarded_at = EXCLUDED.last_awarded_at,
			updated_at = NOW()
	`, up.UserID, up.TotalPoints, up.RedeemableValue, string(up.Tier),
		up.PointsToNext, string(up.NextTier), up.LastAwardedAt)
	return err
}

// GetUserPoints retrieves a user's point balance and tier.
func (p *Postgres) GetUserPoints(ctx context.Context, userID string) (*models.UserPoints, error) {
	up := &models.UserPoints{}
	var lastAwarded *time.Time
	err := p.Pool.QueryRow(ctx, `
		SELECT id, user_id, total_points, redeemable_value_naira, tier,
			pts_to_next, next_tier, last_awarded_at, created_at, updated_at
		FROM user_points WHERE user_id = $1
	`, userID).Scan(
		&up.ID, &up.UserID, &up.TotalPoints, &up.RedeemableValue,
		(*string)(&up.Tier), &up.PointsToNext, (*string)(&up.NextTier),
		&lastAwarded, &up.CreatedAt, &up.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	up.LastAwardedAt = lastAwarded
	return up, nil
}

// AwardPoints records a point transaction and updates the user's total.
func (p *Postgres) AwardPoints(ctx context.Context, userID string, points int, source models.PointSource, action string, refID string, metadata map[string]any) (*models.PointTransaction, error) {
	txID := generateTxID()
	ptx := &models.PointTransaction{
		ID:        txID,
		UserID:    userID,
		Source:    source,
		Action:    action,
		Points:    points,
		RefID:     refID,
		Metadata:  metadata,
		CreatedAt: time.Now().UTC(),
	}

	var currentPoints int
	err := p.Pool.QueryRow(ctx, "SELECT total_points FROM user_points WHERE user_id = $1", userID).Scan(&currentPoints)
	if err != nil {
		currentPoints = 0
	}
	ptx.Balance = currentPoints + points

	// Record transaction
	metadataJSON, _ := toJSON(metadata)
	if _, err := p.Pool.Exec(ctx, `
		INSERT INTO point_transactions
			(id, user_id, source, action, points, balance_after, reference_id, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, ptx.ID, ptx.UserID, string(ptx.Source), ptx.Action, ptx.Points,
		ptx.Balance, ptx.RefID, metadataJSON); err != nil {
		return nil, err
	}

	// Update user total
	_, err = p.Pool.Exec(ctx, `
		INSERT INTO user_points (user_id, total_points, last_awarded_at)
		VALUES ($1,$2,NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			total_points = user_points.total_points + EXCLUDED.total_points,
			last_awarded_at = NOW(),
			updated_at = NOW()
	`, userID, points)
	if err != nil {
		return nil, err
	}

	// Update redeemable value (1000 pts = 500 naira)
	newValue := float64(ptx.Balance) * 0.5
	p.Pool.Exec(ctx, `UPDATE user_points SET redeemable_value_naira=$1 WHERE user_id=$2`, newValue, userID)

	return ptx, nil
}

// GetPointHistory retrieves point transactions for a user.
func (p *Postgres) GetPointHistory(ctx context.Context, userID string, limit, offset int) ([]*models.PointTransaction, int64, error) {
	countQuery := "SELECT COUNT(*) FROM point_transactions WHERE user_id = $1"
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, user_id, source, action, points, balance_after,
			reference_id, metadata, created_at
		FROM point_transactions WHERE user_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3
	`, userID)

	rows, err := p.Pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	txns, err := scanPointTransactions(rows)
	if err != nil {
		return nil, 0, err
	}
	return txns, total, nil
}

// scanPointTransactions scans point transaction rows.
func scanPointTransactions(rows pgx.Rows) ([]*models.PointTransaction, error) {
	var txns []*models.PointTransaction
	for rows.Next() {
		t := &models.PointTransaction{}
		var meta []byte
		if err := rows.Scan(&t.ID, &t.UserID, (*string)(&t.Source), &t.Action, &t.Points,
			&t.Balance, &t.RefID, &meta, &t.CreatedAt); err != nil {
			return nil, err
		}
		if len(meta) > 0 {
			_ = json.Unmarshal(meta, &t.Metadata)
		}
		txns = append(txns, t)
	}
	return txns, rows.Err()
}

// GetUserRedemptions retrieves redemptions for a user.
func (p *Postgres) GetUserRedemptions(ctx context.Context, userID string, limit, offset int) ([]*models.PointRedemption, int64, error) {
	countQuery := "SELECT COUNT(*) FROM point_redemptions WHERE user_id = $1"
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, user_id, points_used, value_naira, type, status,
			reference, expires_at, created_at, applied_at
		FROM point_redemptions WHERE user_id = $1
		ORDER BY created_at DESC LIMIT $2 OFFSET $3
	`, userID)

	rows, err := p.Pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var redemptions []*models.PointRedemption
	for rows.Next() {
		r := &models.PointRedemption{}
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.PointsUsed, &r.ValueNaira,
			(*string)(&r.Type), &r.Status, &r.Reference,
			&r.ExpiresAt, &r.CreatedAt, &r.AppliedAt,
		); err != nil {
			return nil, 0, err
		}
		redemptions = append(redemptions, r)
	}
	return redemptions, total, rows.Err()
}

// RecordRedemption records a points redemption.
func (p *Postgres) RecordRedemption(ctx context.Context, red *models.PointRedemption) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO point_redemptions
			(id, user_id, points_used, value_naira, type, status, reference, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
	`, red.ID, red.UserID, red.PointsUsed, red.ValueNaira, string(red.Type),
		red.Status, red.Reference, red.ExpiresAt)
	return err
}

// ===== Badges CRUD =====

// InsertBadge creates a badge definition.
func (p *Postgres) InsertBadge(ctx context.Context, badge *models.Badge) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO badges
			(id, badge_id, name, description, icon, tier, points_required,
			 actions_required, period)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		ON CONFLICT (badge_id) DO UPDATE SET
			name=EXCLUDED.name, description=EXCLUDED.description,
			icon=EXCLUDED.icon, tier=EXCLUDED.tier,
			points_required=EXCLUDED.points_required,
			actions_required=EXCLUDED.actions_required,
			period=EXCLUDED.period
	`, badge.ID, badge.BadgeID, badge.Name, badge.Description, badge.Icon,
		string(badge.Tier), badge.PointsReq, badge.ActionsReq, badge.Period)
	return err
}

// GetBadges returns all badge definitions.
func (p *Postgres) GetBadges(ctx context.Context) ([]*models.Badge, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, badge_id, name, description, icon, tier, points_required,
			actions_required, period, created_at FROM badges ORDER BY created_at
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var badges []*models.Badge
	for rows.Next() {
		b := &models.Badge{}
		if err := rows.Scan(
			&b.ID, &b.BadgeID, &b.Name, &b.Description, &b.Icon,
			(*string)(&b.Tier), &b.PointsReq, &b.ActionsReq, &b.Period, &b.CreatedAt,
		); err != nil {
			return nil, err
		}
		badges = append(badges, b)
	}
	return badges, rows.Err()
}

// GetUserBadges retrieves badges earned by a user.
func (p *Postgres) GetUserBadges(ctx context.Context, userID string) ([]*models.UserBadge, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, user_id, badge_id, badge_name, icon, earned_at
		FROM user_badges WHERE user_id = $1 ORDER BY earned_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var badges []*models.UserBadge
	for rows.Next() {
		b := &models.UserBadge{}
		if err := rows.Scan(&b.ID, &b.UserID, &b.BadgeID, &b.BadgeName, &b.Icon, &b.EarnedAt); err != nil {
			return nil, err
		}
		badges = append(badges, b)
	}
	return badges, rows.Err()
}

// AwardBadge awards a badge to a user.
func (p *Postgres) AwardBadge(ctx context.Context, userID, badgeID, badgeName, icon string) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO user_badges (user_id, badge_id, badge_name, icon, earned_at)
		VALUES ($1,$2,$3,$4,NOW())
		ON CONFLICT (user_id, badge_id) DO NOTHING
	`, userID, badgeID, badgeName, icon)
	return err
}

// CheckAndAwardBadges checks all badge criteria and awards applicable ones.
func (p *Postgres) CheckAndAwardBadges(ctx context.Context, userID string, points models.UserPoints) ([]*models.UserBadge, error) {
	badges, err := p.GetBadges(ctx)
	if err != nil {
		return nil, err
	}

	var awarded []*models.UserBadge
	for _, badge := range badges {
		if badge.PointsReq <= points.TotalPoints {
			if err := p.AwardBadge(ctx, userID, badge.BadgeID, badge.Name, badge.Icon); err == nil {
				awarded = append(awarded, &models.UserBadge{
					ID: generateTxID(), UserID: userID, BadgeID: badge.BadgeID,
					BadgeName: badge.Name, Icon: badge.Icon, EarnedAt: time.Now().UTC(),
				})
			}
		}
	}
	return awarded, nil
}

// ===== Leaderboard =====

// GetLeaderboard returns entries for a given period.
func (p *Postgres) GetLeaderboard(ctx context.Context, period string, limit int) ([]*models.LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var query string
	switch strings.ToLower(period) {
	case "weekly":
		query = fmt.Sprintf(`
			SELECT up.user_id, up.total_points, up.tier,
				COALESCE(jsonb_build_object('name', up.metadata->>'name'), 'User')
			FROM user_points up
			ORDER BY up.total_points DESC
			LIMIT $1
		`, limit)
	case "monthly":
		query = fmt.Sprintf(`
			SELECT up.user_id, up.total_points, up.tier,
				COALESCE(jsonb_build_object('name', up.metadata->>'name'), 'User')
			FROM user_points up
			WHERE up.updated_at >= NOW() - INTERVAL '30 days'
			ORDER BY up.total_points DESC
			LIMIT $1
		`, limit)
	default: // alltime
		query = fmt.Sprintf(`
			SELECT up.user_id, up.total_points, up.tier,
				COALESCE(jsonb_build_object('name', up.metadata->>'name'), 'User')
			FROM user_points up
			ORDER BY up.total_points DESC
			LIMIT $1
		`, limit)
	}

	rows, err := p.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []*models.LeaderboardEntry
	rank := 1
	for rows.Next() {
		e := &models.LeaderboardEntry{Rank: rank}
		if err := rows.Scan(&e.UserID, &e.Points, (*string)(&e.Tier), &e.UserName); err != nil {
			rank++
			continue
		}
		entries = append(entries, e)
		rank++
	}
	return entries, rows.Err()
}

// ===== Challenges =====

// InsertChallenge creates a new challenge.
func (p *Postgres) InsertChallenge(ctx context.Context, ch *models.Challenge) error {
	metadataJSON, _ := toJSON(ch.Metadata)
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO challenges
			(id, challenge_id, title, description, rules, points_reward,
			 start_date, end_date, min_age_months, max_participants, is_active, metadata)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
	`, ch.ID, ch.ChallengeID, ch.Title, ch.Description, ch.Rules, ch.PointsReward,
		ch.StartDate, ch.EndDate, ch.MinAgeMonths, ch.MaxParticipants, ch.IsActive, metadataJSON)
	return err
}

// GetActiveChallenges returns active challenges.
func (p *Postgres) GetActiveChallenges(ctx context.Context) ([]*models.Challenge, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, challenge_id, title, description, rules, points_reward,
			start_date, end_date, min_age_months, max_participants, is_active,
			metadata, created_at FROM challenges
		WHERE is_active = true AND start_date <= NOW() AND end_date > NOW()
		ORDER BY start_date
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var challenges []*models.Challenge
	for rows.Next() {
		c := &models.Challenge{}
		var metadataJSON string
		if err := rows.Scan(
			&c.ID, &c.ChallengeID, &c.Title, &c.Description, &c.Rules,
			&c.PointsReward, &c.StartDate, &c.EndDate, &c.MinAgeMonths,
			&c.MaxParticipants, &c.IsActive, &metadataJSON, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		fromJSON(metadataJSON, &c.Metadata)
		challenges = append(challenges, c)
	}
	return challenges, rows.Err()
}

// GetUserChallengeProgress retrieves a user's progress in a challenge.
func (p *Postgres) GetUserChallengeProgress(ctx context.Context, userID string) ([]*models.UserChallengeProgress, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, user_id, challenge_id, progress, total_required,
			status, joined_at, completed_at
		FROM user_challenge WHERE user_id = $1 ORDER BY joined_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var progresses []*models.UserChallengeProgress
	for rows.Next() {
		p := &models.UserChallengeProgress{}
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.ChallengeID, &p.Progress, &p.TotalRequired,
			&p.Status, &p.JoinedAt, &p.CompletedAt,
		); err != nil {
			return nil, err
		}
		progresses = append(progresses, p)
	}
	return progresses, rows.Err()
}

// JoinChallenge records a user joining a challenge.
func (p *Postgres) JoinChallenge(ctx context.Context, userID, challengeID string) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO user_challenge (user_id, challenge_id, status, joined_at)
		VALUES ($1,$2,'active',NOW())
		ON CONFLICT DO NOTHING
	`, userID, challengeID)
	return err
}

// ===== Referrals =====

// CreateReferral records a referral.
func (p *Postgres) CreateReferral(ctx context.Context, ref *models.Referral) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO referrals
			(id, referrer_id, referred_id, referral_code, status, referred_at)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (referrer_id, referred_id) DO NOTHING
	`, ref.ID, ref.ReferrerID, ref.ReferredID, ref.ReferralCode, string(ref.Status), ref.ReferredAt)
	return err
}

// GetReferralStats retrieves referral stats for a user.
func (p *Postgres) GetReferralStats(ctx context.Context, userID string) (map[string]any, error) {
	var total, active, failed int64
	var awarded int64

	err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COUNT(CASE WHEN status = 'active' THEN 1 END),
			COUNT(CASE WHEN status = 'failed' THEN 1 END),
			COUNT(CASE WHEN reward_awarded = true THEN 1 END)
		FROM referrals WHERE referrer_id = $1
	`, userID).Scan(&total, &active, &failed, &awarded)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"referrer_id":      userID,
		"total_referrals":  total,
		"active_referrals": active,
		"failed_referrals": failed,
		"awarded_count":    awarded,
	}, nil
}

// RecordReferralReward awards points for a successful referral.
func (p *Postgres) RecordReferralReward(ctx context.Context, referrerID string, points int) error {
	_, err := p.Pool.Exec(ctx, `
		UPDATE referrals SET reward_awarded = true, awarded_points = $1, awarded_at = NOW()
		WHERE referrer_id = $2 AND reward_awarded = false AND status = 'active'
		LIMIT 1
	`, points, referrerID)
	if err != nil {
		return err
	}

	// Award points to referrer
	var currentPoints int
	err = p.Pool.QueryRow(ctx, "SELECT total_points FROM user_points WHERE user_id = $1", referrerID).Scan(&currentPoints)
	if err != nil {
		currentPoints = 0
	}
	_, err = p.Pool.Exec(ctx, `
		INSERT INTO user_points (user_id, total_points, last_awarded_at)
		VALUES ($1,$2,NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			total_points = user_points.total_points + EXCLUDED.total_points,
			last_awarded_at = NOW(), updated_at = NOW()
	`, referrerID, points)
	return err
}

// CheckReferralDailyLimit checks if a referrer has exceeded daily limits.
func (p *Postgres) CheckReferralDailyLimit(ctx context.Context, referrerID string, limit int) (bool, error) {
	var count int
	err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM referrals
		WHERE referrer_id = $1 AND referred_at >= CURRENT_DATE
	`, referrerID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count >= limit, nil
}

// ===== Rewards =====

// InsertReward creates a reward catalog entry.
func (p *Postgres) InsertReward(ctx context.Context, reward *models.Reward) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO rewards
			(id, name, description, points_cost, value_naira, type,
			 is_active, max_redemptions, redeemed_count, expiration_days)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, reward.ID, reward.Name, reward.Description, reward.PointsCost,
		reward.ValueNaira, string(reward.Type), reward.IsActive,
		reward.MaxRedemptions, reward.RedeemedCount, reward.ExpirationDays)
	return err
}

// GetRewards returns all active rewards.
func (p *Postgres) GetRewards(ctx context.Context) ([]*models.Reward, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, name, description, points_cost, value_naira, type,
			is_active, max_redemptions, redeemed_count, expiration_days, created_at
		FROM rewards WHERE is_active = true ORDER BY points_cost
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rewards []*models.Reward
	for rows.Next() {
		r := &models.Reward{}
		if err := rows.Scan(
			&r.ID, &r.Name, &r.Description, &r.PointsCost, &r.ValueNaira,
			(*string)(&r.Type), &r.IsActive, &r.MaxRedemptions, &r.RedeemedCount,
			&r.ExpirationDays, &r.CreatedAt,
		); err != nil {
			return nil, err
		}
		rewards = append(rewards, r)
	}
	return rewards, rows.Err()
}

// RecordRedemptionHistory records a redemption.
func (p *Postgres) RecordRedemptionHistory(ctx context.Context, rh *models.RedemptionHistory) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO redemption_history
			(id, user_id, reward_id, reward_name, points_spent, value_naira,
			 status, reference, redeemed_at, expires_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
	`, rh.ID, rh.UserID, rh.RewardID, rh.RewardName, rh.PointsSpent,
		rh.ValueNaira, rh.Status, rh.Reference, rh.RedeemedAt, rh.ExpiresAt)
	return err
}

// GetUserRedemptionHistory retrieves redemption history for a user.
func (p *Postgres) GetUserRedemptionHistory(ctx context.Context, userID string, limit, offset int) ([]*models.RedemptionHistory, int64, error) {
	countQuery := "SELECT COUNT(*) FROM redemption_history WHERE user_id = $1"
	var total int64
	if err := p.Pool.QueryRow(ctx, countQuery, userID).Scan(&total); err != nil {
		return nil, 0, err
	}

	query := fmt.Sprintf(`
		SELECT id, user_id, reward_id, reward_name, points_spent, value_naira,
			status, reference, redeemed_at, expires_at, applied_at
		FROM redemption_history WHERE user_id = $1
		ORDER BY redeemed_at DESC LIMIT $2 OFFSET $3
	`, userID)

	rows, err := p.Pool.Query(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var history []*models.RedemptionHistory
	for rows.Next() {
		r := &models.RedemptionHistory{}
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.RewardID, &r.RewardName, &r.PointsSpent,
			&r.ValueNaira, &r.Status, &r.Reference, &r.RedeemedAt,
			&r.ExpiresAt, &r.AppliedAt,
		); err != nil {
			return nil, 0, err
		}
		history = append(history, r)
	}
	return history, total, rows.Err()
}

// ===== Tier Definitions =====

// InsertTierDefinition creates a tier definition.
func (p *Postgres) InsertTierDefinition(ctx context.Context, tier *models.TierDefinition) error {
	_, err := p.Pool.Exec(ctx, `
		INSERT INTO tier_definitions
			(id, tier, min_points, max_points, discount_percent, icon, description)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		ON CONFLICT (tier) DO UPDATE SET
			min_points=EXCLUDED.min_points, max_points=EXCLUDED.max_points,
			discount_percent=EXCLUDED.discount_percent,
			icon=EXCLUDED.icon, description=EXCLUDED.description
	`, tier.ID, string(tier.Tier), tier.MinPoints, tier.MaxPoints,
		tier.DiscountPct, tier.Icon, tier.Description)
	return err
}

// GetTierDefinitions returns all tier definitions sorted by min_points.
func (p *Postgres) GetTierDefinitions(ctx context.Context) ([]*models.TierDefinition, error) {
	rows, err := p.Pool.Query(ctx, `
		SELECT id, tier, min_points, max_points, discount_percent, icon, description, created_at
		FROM tier_definitions ORDER BY min_points
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tiers []*models.TierDefinition
	for rows.Next() {
		t := &models.TierDefinition{}
		if err := rows.Scan(
			&t.ID, (*string)(&t.Tier), &t.MinPoints, &t.MaxPoints,
			&t.DiscountPct, &t.Icon, &t.Description, &t.CreatedAt,
		); err != nil {
			return nil, err
		}
		tiers = append(tiers, t)
	}
	return tiers, rows.Err()
}

// ===== Metrics =====

// GetGamificationMetrics computes aggregated gamification analytics.
func (p *Postgres) GetGamificationMetrics(ctx context.Context) (*models.GamificationMetrics, error) {
	metrics := &models.GamificationMetrics{}

	// Total users with points
	if err := p.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM user_points").Scan(&metrics.TotalUsers); err != nil {
		return nil, err
	}

	// Total points issued
	if err := p.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(points), 0) FROM point_transactions").Scan(&metrics.TotalPointsIssued); err != nil {
		return nil, err
	}

	// Active users (awarded points in last 30 days)
	if err := p.Pool.QueryRow(ctx, "SELECT COUNT(DISTINCT user_id) FROM point_transactions WHERE created_at >= NOW() - INTERVAL '30 days'").Scan(&metrics.ActiveUsers); err != nil {
		return nil, err
	}

	// Points redeemed
	if err := p.Pool.QueryRow(ctx, "SELECT COALESCE(SUM(points_used), 0) FROM point_redemptions").Scan(&metrics.TotalPointsRedeemed); err != nil {
		return nil, err
	}

	// Active challenges
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM challenges
		WHERE is_active = true AND start_date <= NOW() AND end_date > NOW()
	`).Scan(&metrics.ActiveChallenges); err != nil {
		return nil, err
	}

	// Challenges completed
	if err := p.Pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_challenge WHERE status = 'completed'
	`).Scan(&metrics.TotalChallengesCompleted); err != nil {
		return nil, err
	}

	// Average points
	if metrics.TotalUsers > 0 {
		var avg int
		if err := p.Pool.QueryRow(ctx, "SELECT COALESCE(AVG(total_points), 0)::INT FROM user_points").Scan(&avg); err == nil {
			metrics.AvgPointsPerUser = float64(avg)
		}
	}

	// Tier counts
	rows, err := p.Pool.Query(ctx, "SELECT tier, COUNT(*) FROM user_points GROUP BY tier")
	if err == nil {
		defer rows.Close()
		metrics.TopTierCount = make(map[string]int64)
		for rows.Next() {
			var tier string
			var count int64
			rows.Scan(&tier, &count)
			metrics.TopTierCount[tier] = count
		}
	}

	// Referrals
	if err := p.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM referrals WHERE reward_awarded = true").Scan(&metrics.ReferralsTotal); err != nil {
		return nil, err
	}

	// Redemptions today
	if err := p.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM redemption_history WHERE redeemed_at >= CURRENT_DATE").Scan(&metrics.RedemptionsToday); err != nil {
		return nil, err
	}

	return metrics, nil
}

func generateTxID() string {
	b := make([]byte, 6)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(36))
		b[i] = "0123456789abcdefghijklmnopqrstuvwxyz"[n.Int64()]
	}
	return strings.ReplaceAll(fmt.Sprintf("tx-%s", string(b)), " ", "")
}
