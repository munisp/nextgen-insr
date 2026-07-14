package main

import (
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
	AgentID     string `json:"agent_id"`
	Name        string `json:"name"`
	Level       int    `json:"level"`
	XP          int    `json:"xp"`
	Rank        string `json:"rank"` // Rookie, Associate, Pro, Elite, Legend
	Region      string `json:"region"`
	Badges      []string `json:"badges"`
	Streak      int    `json:"streak_days"`
	TotalSales  int    `json:"total_sales"`
	MonthSales  int    `json:"month_sales"`
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
	Rank     int    `json:"rank"`
	AgentID  string `json:"agent_id"`
	Name     string `json:"name"`
	Score    int    `json:"score"`
	Level    int    `json:"level"`
	Region   string `json:"region"`
}

var (
	agents     = make(map[string]*AgentProfile)
	agentsMu   sync.RWMutex
	xpPerLevel = 1000
	ranks      = []string{"Rookie", "Associate", "Pro", "Elite", "Legend"}
)

func rankForLevel(level int) string {
	idx := level / 5
	if idx >= len(ranks) { idx = len(ranks) - 1 }
	return ranks[idx]
}

func main() {
	port := envOr("PORT", "8106")
	seedAgents()

	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "healthy",
			"service": "agent-gamification",
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
		json.NewEncoder(w).Encode(profile)
	})

	mux.HandleFunc("/api/v1/gamification/xp/award", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			AgentID string `json:"agent_id"`
			XP      int    `json:"xp"`
			Reason  string `json:"reason"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		agentsMu.Lock()
		profile, ok := agents[req.AgentID]
		if ok {
			profile.XP += req.XP
			profile.Level = profile.XP / xpPerLevel
			profile.Rank = rankForLevel(profile.Level)
		}
		agentsMu.Unlock()
		if !ok {
			http.Error(w, `{"error":"agent not found"}`, 404)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"new_xp":    profile.XP,
			"new_level": profile.Level,
			"new_rank":  profile.Rank,
			"leveled_up": profile.XP % xpPerLevel < req.XP,
		})
	})

	mux.HandleFunc("/api/v1/gamification/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		region := r.URL.Query().Get("region")
		agentsMu.RLock()
		var entries []LeaderboardEntry
		for _, a := range agents {
			if region != "" && a.Region != region { continue }
			entries = append(entries, LeaderboardEntry{
				AgentID: a.AgentID, Name: a.Name, Score: a.XP, Level: a.Level, Region: a.Region,
			})
		}
		agentsMu.RUnlock()
		sort.Slice(entries, func(i, j int) bool { return entries[i].Score > entries[j].Score })
		for i := range entries { entries[i].Rank = i + 1 }
		if len(entries) > 50 { entries = entries[:50] }
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"leaderboard": entries, "total": len(entries)})
	})

	mux.HandleFunc("/api/v1/gamification/challenges", func(w http.ResponseWriter, r *http.Request) {
		now := time.Now()
		challenges := []Challenge{
			{ID: "ch-1", Title: "Speed Seller", Description: "Close 5 policies today", Type: "daily", Target: 5, Reward: 500, StartDate: now.Format("2006-01-02"), EndDate: now.Format("2006-01-02")},
			{ID: "ch-2", Title: "Renewal Champion", Description: "Renew 10 policies this week", Type: "weekly", Target: 10, Reward: 2000, StartDate: now.Format("2006-01-02"), EndDate: now.AddDate(0, 0, 7).Format("2006-01-02")},
			{ID: "ch-3", Title: "Territory King", Description: "Onboard 20 new customers this month", Type: "monthly", Target: 20, Reward: 5000, StartDate: now.Format("2006-01-02"), EndDate: now.AddDate(0, 1, 0).Format("2006-01-02")},
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"challenges": challenges})
	})

	log.Printf("Agent Gamification starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}

func seedAgents() {
	regions := []string{"Lagos", "Abuja", "Kano", "Port Harcourt", "Ibadan"}
	names := []string{"Chidi Okonkwo", "Amina Bello", "Emeka Nwankwo", "Fatima Yusuf", "Olumide Adeyemi"}
	for i, name := range names {
		id := "AGT-" + string(rune('A'+i)) + "001"
		agents[id] = &AgentProfile{
			AgentID: id, Name: name, Level: (i+1)*3, XP: (i+1)*3*xpPerLevel + 500,
			Rank: rankForLevel((i+1)*3), Region: regions[i], Badges: []string{"onboarded", "first_sale"},
			Streak: (i+1)*5, TotalSales: (i+1)*50, MonthSales: (i+1)*8,
		}
	}
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" { return v }
	return def
}
