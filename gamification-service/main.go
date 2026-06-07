package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"
	"fmt"

	_ "github.com/lib/pq"
)

// Gamification Service — engagement through points, badges, and leaderboards
// Business Rules:
// - Points: Policy purchase (100), claim-free year (500), referral (200), document upload (50)
// - Badges: "First Policy", "Claim-Free Champion", "Super Referrer", "Early Payer"
// - Leaderboards: Weekly/Monthly/All-time, segmented by region
// - Rewards: Points redeemable for premium discounts (1000 pts = ₦500 off)
// - Anti-gaming: Max 5 referral points/day, no self-referral, 30-day qualification


// validateQueryParam validates and sanitizes a query parameter.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %q exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateRequiredParam validates a required query parameter.
func validateRequiredParam(r *http.Request, key string, maxLen int) (string, error) {
	val, err := validateQueryParam(r, key, maxLen)
	if err != nil {
		return "", err
	}
	if val == "" {
		return "", fmt.Errorf("parameter %q is required", key)
	}
	return val, nil
}

// validateIntParam validates and converts an integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %q must be a valid integer", key)
	}
	return n, nil
}


var db *sql.DB

func initDB() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		jsonLog("warn", "database connection failed", "error", err.Error())
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)
	if err := db.Ping(); err != nil {
		jsonLog("warn", "database ping failed", "error", err.Error())
	} else {
		jsonLog("info", "database connected", "service", "gamification-service", "driver", "postgresql")
	}
}

// execInTransaction wraps a function in a database transaction.
func execInTransaction(fn func(tx *sql.Tx) error) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}



// otelMiddleware adds trace context propagation to requests.
func otelMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := r.Header.Get("X-Trace-ID")
		if traceID == "" {
			traceID = r.Header.Get("X-Request-Id")
		}
		spanID := fmt.Sprintf("span-%d", time.Now().UnixNano())
		w.Header().Set("X-Trace-ID", traceID)
		w.Header().Set("X-Span-ID", spanID)
		start := time.Now()
		next.ServeHTTP(w, r)
		duration := time.Since(start)
		if duration > 500*time.Millisecond {
			jsonLog("warn", "slow request", "path", r.URL.Path, "duration_ms", fmt.Sprintf("%.0f", float64(duration.Milliseconds())), "trace_id", traceID)
		}
	})
}



func jsonLog(level, msg string, kvs ...string) {
	entry := fmt.Sprintf(`{"level":"%s","msg":"%s"`, level, msg)
	for i := 0; i+1 < len(kvs); i += 2 {
		entry += fmt.Sprintf(`,"%s":"%s"`, kvs[i], kvs[i+1])
	}
	entry += `,"ts":"` + time.Now().Format(time.RFC3339) + `"}`
	log.Println(entry)
}

func main() {
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "gamification-service"})
	})
	r.Get("/api/v1/points/{userId}", getUserPoints)
	r.Post("/api/v1/points/award", awardPoints)
	r.Get("/api/v1/leaderboard", getLeaderboard)
	r.Get("/api/v1/badges/{userId}", getUserBadges)

	port := os.Getenv("PORT")
	if port == "" { port = "8125" }
	log.Printf("Gamification Service starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
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
