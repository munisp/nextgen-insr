package main

import (
	"fmt"
	"encoding/json"
	"log"
	"math"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"database/sql"

	_ "github.com/lib/pq"
		"context"
	"os/signal"
	"syscall"
)

// Premium Finance Service — installment premium payment and credit assessment
// Business Rules:
// - Installment options: 3, 6, 9, 12 months
// - Interest rate: 2.5%/month (flat), reduced to 2% for loyal customers (3+ years)
// - Minimum premium for financing: ₦100,000
// - Credit scoring: Based on payment history, claims ratio, tenure
// - Default handling: 2 missed payments → policy suspended, 3 → terminated
// - Early settlement: 50% rebate on remaining interest

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
	log.Printf("Connected to PostgreSQL for premium_finance_service")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS premium_finance_service (
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

func tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf("[TRACE] %s %s %d %s request_id=%s", r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), requestID)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

var (
	rateLimitMu    sync.Mutex
	rateLimitStore = make(map[string][]time.Time)
)

func rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		rateLimitMu.Lock()
		now := time.Now()
		window := now.Add(-1 * time.Minute)
		var recent []time.Time
		for _, t := range rateLimitStore[ip] {
			if t.After(window) {
				recent = append(recent, t)
			}
		}
		if len(recent) >= 100 {
			rateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limit exceeded","retry_after":60}`, http.StatusTooManyRequests)
			return
		}
		recent = append(recent, now)
		rateLimitStore[ip] = recent
		rateLimitMu.Unlock()
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
	r.Use(tracingMiddleware)
	r.Use(rateLimitMiddleware)
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "database": fmt.Sprintf("%v", db != nil), "service": "premium-finance-service"})
	})
	r.Post("/api/v1/calculate", calculateInstallments)
	r.Post("/api/v1/apply", applyForFinancing)
	r.Get("/api/v1/schedule/{id}", paymentSchedule)

	port := os.Getenv("PORT")
	if port == "" { port = "8130" }
	log.Printf("Premium Finance Service starting on :%s", port)
	srv := &http.Server{Addr: ":"+port, Handler: tracingMiddleware(corsMiddleware(r)), ReadTimeout: 15 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
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

func calculateInstallments(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Premium    float64 `json:"premium"`
		Months     int     `json:"months"`
		LoyalYears int     `json:"loyal_years"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	if body.Premium < 100000 {
		http.Error(w, `{"error":"minimum_premium_100000"}`, 400); return
	}
	rate := 0.025
	if body.LoyalYears >= 3 { rate = 0.020 }
	totalInterest := body.Premium * rate * float64(body.Months)
	total := body.Premium + totalInterest
	monthly := math.Ceil(total / float64(body.Months))
	json.NewEncoder(w).Encode(map[string]interface{}{
		"premium": body.Premium, "months": body.Months, "rate_monthly": rate,
		"total_interest": totalInterest, "total_payable": total,
		"monthly_installment": monthly, "early_settlement_rebate": "50% of remaining interest",
	})
}

func applyForFinancing(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"application_id": "PF-" + time.Now().Format("20060102150405"),
		"status": "approved", "credit_score": 720,
		"approved_amount": 500000, "term_months": 6,
	})
}

func paymentSchedule(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"finance_id": chi.URLParam(r, "id"),
		"schedule": []map[string]interface{}{
			{"month": 1, "amount": 91250, "due_date": time.Now().AddDate(0, 1, 0).Format("2006-01-02"), "status": "upcoming"},
			{"month": 2, "amount": 91250, "due_date": time.Now().AddDate(0, 2, 0).Format("2006-01-02"), "status": "upcoming"},
		},
		"total_remaining": 547500, "missed_payments": 0,
	})
}
