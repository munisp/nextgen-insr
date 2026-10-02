// PostgreSQL persistence layer for the Agent Gamification service.
//
// 2026-10-02 (C2-a10, persistence audit item A10): agent profiles
// (XP, levels, ranks, badges, streaks, sales counters) were previously
// held only in process memory (cmd/main.go: `agents map[string]*AgentProfile`
// + seedAgents() at boot), so every restart wiped all earned XP, badges and
// streaks and reset profiles to seed data. Postgres is now the
// AUTHORITATIVE store; the in-memory map is only a read-through cache.
// Fail-closed policy: if DATABASE_URL is unset or PG is unavailable at boot
// the process exits (log.Fatal in main); if a mutation cannot be persisted
// the handler returns 503 and never reports success.
//
// Pattern follows server/fido2-service/store.go (DDL at boot, fail-closed,
// database/sql + lib/pq). The sibling gamification-service schema
// (user_points/badges/challenges, pgx-based) is user-points centric and does
// not model agent XP/level/streak profiles, so a dedicated table is used.

package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"
)

// storeDDL creates the authoritative profile table. Idempotent; run at boot.
const storeDDL = `
CREATE TABLE IF NOT EXISTS agent_gamification_profiles (
    agent_id    TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    level       INT NOT NULL DEFAULT 0,
    xp          INT NOT NULL DEFAULT 0,
    rank        TEXT NOT NULL DEFAULT 'Rookie',
    region      TEXT NOT NULL DEFAULT '',
    badges      TEXT[] NOT NULL DEFAULT '{}',
    streak_days INT NOT NULL DEFAULT 0,
    total_sales INT NOT NULL DEFAULT 0,
    month_sales INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_gamification_profiles_region_idx
    ON agent_gamification_profiles(region);
CREATE INDEX IF NOT EXISTS agent_gamification_profiles_xp_idx
    ON agent_gamification_profiles(xp DESC);
`

// profileStore is the Postgres-backed store for agent gamification profiles.
// All methods fail closed: errors are returned to the caller, never swallowed.
type profileStore struct {
	db *sql.DB
}

// openProfileStore connects to PG (fail-closed on error), runs the DDL and
// verifies writability before returning.
func openProfileStore(ctx context.Context, dsn string) (*profileStore, error) {
	if dsn == "" {
		return nil, errors.New("DATABASE_URL is required (fail-closed: no in-memory fallback)")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(3)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if _, err := db.ExecContext(ctx, storeDDL); err != nil {
		db.Close()
		return nil, fmt.Errorf("agent gamification DDL: %w", err)
	}
	return &profileStore{db: db}, nil
}

func (s *profileStore) Close() {
	if s != nil && s.db != nil {
		s.db.Close()
	}
}

// upsertProfile persists the complete profile row (write-through). Used by
// both seeding and mutations so XP, badges and streaks are always durable.
func (s *profileStore) upsertProfile(ctx context.Context, p *AgentProfile) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO agent_gamification_profiles
			(agent_id, name, level, xp, rank, region, badges, streak_days, total_sales, month_sales, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
		 ON CONFLICT (agent_id) DO UPDATE SET
			name = EXCLUDED.name,
			level = EXCLUDED.level,
			xp = EXCLUDED.xp,
			rank = EXCLUDED.rank,
			region = EXCLUDED.region,
			badges = EXCLUDED.badges,
			streak_days = EXCLUDED.streak_days,
			total_sales = EXCLUDED.total_sales,
			month_sales = EXCLUDED.month_sales,
			updated_at = now()`,
		p.AgentID, p.Name, p.Level, p.XP, p.Rank, p.Region,
		pq.Array(p.Badges), p.Streak, p.TotalSales, p.MonthSales)
	if err != nil {
		return fmt.Errorf("upsert profile %q: %w", p.AgentID, err)
	}
	return nil
}

// loadProfiles loads every profile row from PG (used to warm the cache at
// boot). Fails closed on any error.
func (s *profileStore) loadProfiles(ctx context.Context) (map[string]*AgentProfile, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT agent_id, name, level, xp, rank, region, badges, streak_days, total_sales, month_sales
		 FROM agent_gamification_profiles`)
	if err != nil {
		return nil, fmt.Errorf("load profiles: %w", err)
	}
	defer rows.Close()
	out := make(map[string]*AgentProfile)
	for rows.Next() {
		p := &AgentProfile{}
		var badges []string
		if err := rows.Scan(&p.AgentID, &p.Name, &p.Level, &p.XP, &p.Rank, &p.Region,
			pq.Array(&badges), &p.Streak, &p.TotalSales, &p.MonthSales); err != nil {
			return nil, fmt.Errorf("scan profile: %w", err)
		}
		p.Badges = badges
		out[p.AgentID] = p
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate profiles: %w", err)
	}
	return out, nil
}

// awardXP persists an XP award transactionally and returns the updated
// profile as written to PG. The caller must only update its cache and respond
// success after this returns nil (write-through, fail-closed).
// Returns (nil, nil) when the agent does not exist.
func (s *profileStore) awardXP(ctx context.Context, agentID string, xp int) (*AgentProfile, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin award tx: %w", err)
	}
	defer tx.Rollback()

	p := &AgentProfile{}
	var badges []string
	err = tx.QueryRowContext(ctx,
		`SELECT agent_id, name, level, xp, rank, region, badges, streak_days, total_sales, month_sales
		 FROM agent_gamification_profiles WHERE agent_id = $1 FOR UPDATE`, agentID).
		Scan(&p.AgentID, &p.Name, &p.Level, &p.XP, &p.Rank, &p.Region,
			pq.Array(&badges), &p.Streak, &p.TotalSales, &p.MonthSales)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lock profile %q: %w", agentID, err)
	}
	p.Badges = badges

	p.XP += xp
	p.Level = p.XP / xpPerLevel
	p.Rank = rankForLevel(p.Level)

	if _, err := tx.ExecContext(ctx,
		`UPDATE agent_gamification_profiles
		 SET xp = $2, level = $3, rank = $4, updated_at = now()
		 WHERE agent_id = $1`, p.AgentID, p.XP, p.Level, p.Rank); err != nil {
		return nil, fmt.Errorf("persist award for %q: %w", agentID, err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit award for %q: %w", agentID, err)
	}
	return p, nil
}
