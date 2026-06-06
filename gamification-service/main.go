package main

import (
	"fmt"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
)

// Gamification Service — engagement through points, badges, and leaderboards
// Business Rules:
// - Points: Policy purchase (100), claim-free year (500), referral (200), document upload (50)
// - Badges: "First Policy", "Claim-Free Champion", "Super Referrer", "Early Payer"
// - Leaderboards: Weekly/Monthly/All-time, segmented by region
// - Rewards: Points redeemable for premium discounts (1000 pts = ₦500 off)
// - Anti-gaming: Max 5 referral points/day, no self-referral, 30-day qualification

var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgresql://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("WARN: database connection failed: %v (running in degraded mode)", err)
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v (running in degraded mode)", err)
		db = nil
		return
	}
	log.Printf("Connected to PostgreSQL for gamification_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS gamification_service (
		id SERIAL PRIMARY KEY,
		data JSONB NOT NULL DEFAULT '{}',
		status VARCHAR(50) DEFAULT 'active',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW(),
		tenant_id INTEGER DEFAULT 1
	)`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	initDB()
	if db != nil {
		defer db.Close()
	}
	r := chi.NewRouter()
	r.Use(corsMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "gamification-service"})
	})
	r.Get("/api/v1/points/{userId}", getUserPoints)
	r.Post("/api/v1/points/award", awardPoints)
	r.Get("/api/v1/leaderboard", getLeaderboard)
	r.Get("/api/v1/badges/{userId}", getUserBadges)

	port := os.Getenv("PORT")
	if port == "" { port = "8125" }
	log.Printf("Gamification Service starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: corsMiddleware(r), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	go func() { if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed { log.Fatalf("Server failed: %v", err) } }()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil { log.Fatalf("Forced shutdown: %v", err) }
	log.Println("Server stopped")
}

func getUserPoints(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": chi.URLParam(r, "userId"), "total_points": 2350,
		"redeemable_value_naira": 1175, "level": "Gold",
		"next_level": "Platinum", "points_to_next": 650,
	})
}

func awardPoints(w http.ResponseWriter, r *http.Request) {
	var body struct {
		UserID string `json:"user_id"`
		Action string `json:"action"`
		Amount int    `json:"amount"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": body.UserID, "action": body.Action, "points_awarded": body.Amount,
		"new_total": 2350 + body.Amount, "badge_earned": nil,
	})
}

func getLeaderboard(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"period": "monthly", "entries": []map[string]interface{}{
			{"rank": 1, "user": "Adebayo O.", "points": 4500, "region": "Lagos"},
			{"rank": 2, "user": "Chioma N.", "points": 3800, "region": "Enugu"},
			{"rank": 3, "user": "Ibrahim M.", "points": 3200, "region": "Kano"},
		},
	})
}

func getUserBadges(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"user_id": chi.URLParam(r, "userId"),
		"badges": []map[string]interface{}{
			{"name": "First Policy", "earned_at": time.Now().AddDate(-1, 0, 0).Format(time.RFC3339), "icon": "shield"},
			{"name": "Claim-Free Champion", "earned_at": time.Now().AddDate(0, -6, 0).Format(time.RFC3339), "icon": "star"},
			{"name": "Super Referrer", "earned_at": time.Now().AddDate(0, -1, 0).Format(time.RFC3339), "icon": "users"},
		},
	})
}
