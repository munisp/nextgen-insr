package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"
)

// Agent Gamification & Performance Platform
// Port: 8106
// Features: XP system, level progression, leaderboards, challenges, rewards
// Integrations: Kafka, Redis, PostgreSQL, OpenSearch, Temporal

type AgentProfile struct {
	AgentID    string   `json:"agent_id"`
	Name       string   `json:"name"`
	Level      int      `json:"level"`
	XP         int      `json:"xp"`
	Rank       string   `json:"rank"` // Rookie, Associate, Pro, Elite, Legend
	Region     string   `json:"region"`
	Badges     []string `json:"badges"`
	Streak     int      `json:"streak_days"`
	TotalSales int      `json:"total_sales"`
	MonthSales int      `json:"month_sales"`
}

type Challenge struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Type        string `json:"type"` // daily, weekly, monthly
	Target      int    `json:"target"`
	Reward      int    `json:"reward_xp"`
	StartDate   string `json:"start_date"`
	EndDate     string `json:"end_date"`
}

type LeaderboardEntry struct {
	Rank    int    `json:"rank"`
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
	Score   int    `json:"score"`
	Level   int    `json:"level"`
	Region  string `json:"region"`
}

var (
	// 2026-10-02 (C2-a10): `agents` is now only a read-through cache; the
	// authoritative store is Postgres (store.go). Mutations write to PG
	// first and update this cache only after the write commits.
	agents     = make(map[string]*AgentProfile)
	agentsMu   sync.RWMutex
	store      *profileStore
	xpPerLevel = 1000
	ranks      = []string{"Rookie", "Associate", "Pro", "Elite", "Legend"}
)

func rankForLevel(level int) string {
	idx := level / 5
	if idx >= len(ranks) {
		idx = len(ranks) - 1
	}
	return ranks[idx]
}

func main() {
	port := envOr("PORT", "8106")

	// 2026-10-02 (C2-a10): fail-closed boot — the service must not start
	// without a writable Postgres, otherwise XP/badges/streaks earned during
	// this process lifetime would be silently lost on restart.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var err error
	store, err = openProfileStore(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("agent-gamification: cannot start without Postgres: %v", err)
	}
	defer store.Close()
	if err := bootstrapProfiles(ctx, store); err != nil {
		log.Fatalf("agent-gamification: cannot load profiles: %v", err)
	}

	mux := http.NewServeMux()
	registerRoutes(mux)

	log.Printf("Agent Gamification starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

// registerRoutes wires all HTTP handlers (extracted from main so tests can
// exercise the real handlers; 2026-10-02, C2-a10).
func registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":   "healthy",
			"service":  "agent-gamification",
			"features": []string{"xp", "levels", "leaderboards", "challenges", "badges", "streaks"},
		})
	})

	mux.HandleFunc("/api/v1/gamification/profile", func(w http.ResponseWriter, r *http.Request) {
		agentID := r.URL.Query().Get("agent_id")
		agentsMu.RLock()
		profile, ok := agents[agentID]
		agentsMu.RUnlock()
		if !ok {
			http.Error(w, `{"error":"agent not found"}`, 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(profile)
	})

	mux.HandleFunc("/api/v1/gamification/xp/award", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AgentID string `json:"agent_id"`
			XP      int    `json:"xp"`
			Reason  string `json:"reason"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		// 2026-10-02 (C2-a10): write-through — the award is durable in PG
		// before the success response; if PG is down we fail closed (503)
		// and the in-memory cache is left untouched.
		profile, err := store.awardXP(r.Context(), req.AgentID, req.XP)
		if err != nil {
			log.Printf("xp/award: persist failed for %q: %v", req.AgentID, err)
			http.Error(w, `{"error":"persistence unavailable"}`, 503)
			return
		}
		if profile == nil {
			http.Error(w, `{"error":"agent not found"}`, 404)
			return
		}
		agentsMu.Lock()
		agents[profile.AgentID] = profile
		agentsMu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":    true,
			"new_xp":     profile.XP,
			"new_level":  profile.Level,
			"new_rank":   profile.Rank,
			"leveled_up": profile.XP%xpPerLevel < req.XP,
		})
	})

	mux.HandleFunc("/api/v1/gamification/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		region := r.URL.Query().Get("region")
		agentsMu.RLock()
		var entries []LeaderboardEntry
		for _, a := range agents {
			if region != "" && a.Region != region {
				continue
			}
			entries = append(entries, LeaderboardEntry{
				AgentID: a.AgentID, Name: a.Name, Score: a.XP, Level: a.Level, Region: a.Region,
			})
		}
		agentsMu.RUnlock()
		sort.Slice(entries, func(i, j int) bool { return entries[i].Score > entries[j].Score })
		for i := range entries {
			entries[i].Rank = i + 1
		}
		if len(entries) > 50 {
			entries = entries[:50]
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"leaderboard": entries, "total": len(entries)})
	})

	mux.HandleFunc("/api/v1/gamification/challenges", func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		challenges := []Challenge{
			{ID: "ch-1", Title: "Speed Seller", Description: "Close 5 policies today", Type: "daily", Target: 5, Reward: 500, StartDate: now.Format("2006-01-02"), EndDate: now.Format("2006-01-02")},
			{ID: "ch-2", Title: "Renewal Champion", Description: "Renew 10 policies this week", Type: "weekly", Target: 10, Reward: 2000, StartDate: now.Format("2006-01-02"), EndDate: now.AddDate(0, 0, 7).Format("2006-01-02")},
			{ID: "ch-3", Title: "Territory King", Description: "Onboard 20 new customers this month", Type: "monthly", Target: 20, Reward: 5000, StartDate: now.Format("2006-01-02"), EndDate: now.AddDate(0, 1, 0).Format("2006-01-02")},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{"challenges": challenges})
	})
}

// bootstrapProfiles warms the in-memory cache from PG. 2026-10-02 (C2-a10):
// seedAgents() only runs when the table is empty — before persistence this
// ran unconditionally at every boot and would have reset earned progress.
func bootstrapProfiles(ctx context.Context, s *profileStore) error {
	loaded, err := s.loadProfiles(ctx)
	if err != nil {
		return err
	}
	if len(loaded) == 0 {
		seeds := seedAgents()
		for _, p := range seeds {
			if err := s.upsertProfile(ctx, p); err != nil {
				return err
			}
			loaded[p.AgentID] = p
		}
		log.Printf("agent-gamification: seeded %d agent profiles into empty table", len(seeds))
	}
	agentsMu.Lock()
	agents = loaded
	agentsMu.Unlock()
	return nil
}

func seedAgents() map[string]*AgentProfile {
	seeded := make(map[string]*AgentProfile)
	regions := []string{"Lagos", "Abuja", "Kano", "Port Harcourt", "Ibadan"}
	names := []string{"Chidi Okonkwo", "Amina Bello", "Emeka Nwankwo", "Fatima Yusuf", "Olumide Adeyemi"}
	for i, name := range names {
		id := "AGT-" + string(rune('A'+i)) + "001"
		seeded[id] = &AgentProfile{
			AgentID: id, Name: name, Level: (i + 1) * 3, XP: (i+1)*3*xpPerLevel + 500,
			Rank: rankForLevel((i + 1) * 3), Region: regions[i], Badges: []string{"onboarded", "first_sale"},
			Streak: (i + 1) * 5, TotalSales: (i + 1) * 50, MonthSales: (i + 1) * 8,
		}
	}
	return seeded
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
