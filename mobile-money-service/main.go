package main

import (
	"database/sql"
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"context"
	"fmt"
	"math"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"

	_ "github.com/lib/pq"
)

// Mobile Money Service — integration with Nigerian mobile money operators
// Operators: OPay, PalmPay, Paga, Moniepoint, Kuda
// Business Rules:
// - Premium collection via mobile money deduction (auto-debit with consent)
// - Claim payout to mobile wallets (instant, max ₦5M per transaction)
// - KYC tier determines transaction limits
// - Mojaloop integration for interoperability
// - Settlement: T+0 for wallet-to-wallet, T+1 for wallet-to-bank

var kafkaRestURL string

func initKafka() {
	kafkaRestURL = os.Getenv("KAFKA_REST_URL")
	if kafkaRestURL == "" {
		kafkaRestURL = "http://localhost:8082"
	}
	log.Printf("Kafka REST proxy configured at %s", kafkaRestURL)
}

func publishEvent(topic string, key string, payload interface{}) {
	if kafkaRestURL == "" {
		return
	}
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("WARN: kafka marshal error: %v", err)
		return
	}
	msg := map[string]interface{}{
		"records": []map[string]interface{}{
			{"key": key, "value": string(data)},
		},
	}
	body, _ := json.Marshal(msg)
	resp, err := http.Post(kafkaRestURL+"/topics/"+topic, "application/vnd.kafka.json.v2+json", bytes.NewReader(body))
	if err != nil {
		log.Printf("WARN: kafka publish error: %v", err)
		return
	}
	defer resp.Body.Close()
}

// --- Production Middleware ---

type statusResponseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (w *statusResponseWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Tracing middleware - adds X-Request-ID to all requests
func prodTracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := r.Header.Get("X-Request-Id")
		if reqID == "" {
			reqID = fmt.Sprintf("req-%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-Id", reqID)
		start := time.Now()
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		log.Printf(`{"level":"debug","msg":"request","method":"%s","path":"%s","status":%d,"duration":"%s","request_id":"%s"}`, r.Method, r.URL.Path, wrapped.statusCode, time.Since(start), reqID)
	})
}

// CORS middleware - handles preflight and sets headers
func prodCorsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id")
		w.Header().Set("Access-Control-Max-Age", "86400")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Rate limiting - token bucket per IP, 100 req/min
var (
	prodRateLimitMu      sync.Mutex
	prodRateLimitBuckets = make(map[string]*prodTokenBucket)
)

type prodTokenBucket struct {
	tokens     float64
	lastRefill time.Time
}

func prodRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = fwd
		}
		prodRateLimitMu.Lock()
		bucket, ok := prodRateLimitBuckets[ip]
		if !ok {
			bucket = &prodTokenBucket{tokens: 100, lastRefill: time.Now()}
			prodRateLimitBuckets[ip] = bucket
		}
		elapsed := time.Since(bucket.lastRefill).Seconds()
		bucket.tokens = math.Min(100, bucket.tokens+elapsed*(100.0/60.0))
		bucket.lastRefill = time.Now()
		if bucket.tokens < 1 {
			prodRateLimitMu.Unlock()
			w.Header().Set("Retry-After", "60")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{"error": "rate limit exceeded", "retry_after": 60})
			return
		}
		bucket.tokens--
		prodRateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// Prometheus-compatible metrics
var (
	prodMetricsReqCount   int64
	prodMetricsErrCount   int64
	prodMetricsStartTime  = time.Now()
)

func prodMetricsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&prodMetricsReqCount, 1)
		wrapped := &statusResponseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)
		if wrapped.statusCode >= 400 {
			atomic.AddInt64(&prodMetricsErrCount, 1)
		}
	})
}

func prodMetricsHandler(w http.ResponseWriter, r *http.Request) {
	uptime := time.Since(prodMetricsStartTime).Seconds()
	reqCount := atomic.LoadInt64(&prodMetricsReqCount)
	errCount := atomic.LoadInt64(&prodMetricsErrCount)
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

// Panic recovery middleware - catches panics and returns 500
func prodRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(map[string]interface{}{"error": "internal server error", "recovered": true})
				log.Printf(`{"level":"error","msg":"panic recovered","error":"%v","path":"%s","method":"%s"}`, err, r.URL.Path, r.Method)
			}
		}()
		next.ServeHTTP(w, r)
	})
}


var db *sql.DB

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	db, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("WARN: database connection failed: %v", err)
		return
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	if err = db.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v", err)
		return
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"mobile-money-service","driver":"postgresql"}`)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS mobile_money_txns (id TEXT PRIMARY KEY, customer_id TEXT, provider TEXT NOT NULL, phone_number TEXT, amount NUMERIC(15,2), currency TEXT DEFAULT 'NGN', direction TEXT, reference TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMPTZ DEFAULT NOW())`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}


func handleReady(w http.ResponseWriter, r *http.Request) {
	if db == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database not initialized"})
		return
	}
	if err := db.Ping(); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "database unreachable"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

func main() {
	initKafka()
	initDB()
	r := chi.NewRouter()
	r.Use(middleware.Logger, middleware.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "disconnected"
		if db != nil {
			if err := db.Ping(); err == nil {
				dbStatus = "connected"
			}
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "mobile-money-service", "database": dbStatus})
	})
	r.Get("/ready", handleReady)
	r.Get("/live", handleLive)
	r.Post("/api/v1/collect", collectPremium)
	r.Post("/api/v1/disburse", disburseToClaim)
	r.Get("/api/v1/operators", listOperators)
	r.Get("/api/v1/balance/{walletId}", walletBalance)
	r.Get("/metrics", prodMetricsHandler)

	port := os.Getenv("PORT")
	if port == "" { port = "8127" }
	log.Printf("Mobile Money Service starting on :%s", port)
	handler := prodRecoveryMiddleware(prodMetricsMiddleware(prodTracingMiddleware(prodCorsMiddleware(prodRateLimitMiddleware(r)))))
	srv := &http.Server{
		Addr:         ":"+port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Printf(`{"level":"info","msg":"shutting down gracefully","service":"mobile-money-service"}`)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("Server forced to shutdown: %v", err)
	}
	log.Printf(`{"level":"info","msg":"server stopped","service":"mobile-money-service"}`)
}

func collectPremium(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WalletID string  `json:"wallet_id"`
		Amount   float64 `json:"amount"`
		Operator string  `json:"operator"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"transaction_id": "MMT-" + time.Now().Format("20060102150405"),
		"amount": body.Amount, "operator": body.Operator, "status": "successful",
		"settlement": "T+0", "reference": body.WalletID,
	})
}

func disburseToClaim(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"payout_id": "MMP-" + time.Now().Format("20060102150405"),
		"status": "completed", "channel": "mobile_wallet", "settlement": "instant",
	})
}

func listOperators(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"operators": []map[string]interface{}{
			{"name": "OPay", "code": "OPAY", "active": true, "max_transaction": 5000000},
			{"name": "PalmPay", "code": "PALMPAY", "active": true, "max_transaction": 5000000},
			{"name": "Paga", "code": "PAGA", "active": true, "max_transaction": 3000000},
			{"name": "Moniepoint", "code": "MONIE", "active": true, "max_transaction": 5000000},
			{"name": "Kuda", "code": "KUDA", "active": true, "max_transaction": 5000000},
		},
	})
}

func walletBalance(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(map[string]interface{}{
		"wallet_id": chi.URLParam(r, "walletId"), "balance": 450000,
		"currency": "NGN", "last_transaction": time.Now().Add(-2 * time.Hour).Format(time.RFC3339),
	})
}
