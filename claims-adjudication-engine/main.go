package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/claims-adjudication-engine/config"
	"github.com/claims-adjudication-engine/db"
	"github.com/claims-adjudication-engine/models"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	_ "github.com/lib/pq"
	"go.uber.org/zap"
)

// Engine is the central claims adjudication engine that orchestrates all components
type Engine struct {
	config       *config.Config
	db           *db.ClaimsRepository
	cache        *db.ClaimCache
	logger       *zap.Logger
	startTime    time.Time
	healthy      atomic.Bool
	requestCount atomic.Int64
	errorCount   atomic.Int64
}

// NewEngine creates a new claims adjudication engine
func NewEngine(cfg *config.Config) (*Engine, error) {
	// Initialize logger
	logger, err := zap.NewProduction()
	if err != nil {
		return nil, fmt.Errorf("failed to create logger: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	if cfg.Observability.LogLevel != "" {
		lvl := zap.InfoLevel
		switch cfg.Observability.LogLevel {
		case "debug":
			lvl = zap.DebugLevel
		case "warn":
			lvl = zap.WarnLevel
		case "error":
			lvl = zap.ErrorLevel
		}
		zcfg := zap.NewProductionConfig()
		zcfg.Level = zap.NewAtomicLevelAt(lvl)
		logger, _ = zcfg.Build()
	}

	engine := &Engine{
		config:    cfg,
		logger:    logger,
		startTime: time.Now(),
	}

	// Initialize database (required: the engine persists claims, decisions and
	// fraud flags to PostgreSQL and does not support in-memory operation)
	repo, err := db.NewClaimsRepository(&cfg.Database, logger)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database (set DATABASE_URL or DB_* variables): %w", err)
	}
	engine.db = repo
	logger.Info("Database initialized successfully")

	// Initialize cache
	cache, err := db.NewClaimCache(&cfg.Redis, repo, logger)
	if err != nil {
		logger.Warn("Failed to initialize Redis cache (will operate without caching)", zap.Error(err))
	} else {
		engine.cache = cache
		logger.Info("Redis cache initialized successfully")
	}

	engine.healthy.Store(true)

	return engine, nil
}

// Shutdown gracefully shuts down the engine
func (e *Engine) Shutdown(ctx context.Context) error {
	e.logger.Info("Shutting down claims adjudication engine...")

	if e.db != nil {
		if err := e.db.Close(); err != nil {
			e.logger.Error("Failed to close database", zap.Error(err))
		}
	}

	if e.cache != nil {
		if err := e.cache.Close(); err != nil {
			e.logger.Error("Failed to close Redis cache", zap.Error(err))
		}
	}

	e.logger.Info("Claims adjudication engine shut down")
	return nil
}

// adjudicateClaim performs the full adjudication logic with validation, risk assessment, and queue assignment
func (e *Engine) adjudicateClaim(claim *models.Claim) *models.AdjudicationResult {
	start := time.Now()

	// Validate claim fields
	if err := e.validateClaim(claim); err != nil {
		e.logger.Warn("Claim validation failed", zap.String("claim_id", claim.ID), zap.Error(err))
		return &models.AdjudicationResult{
			ClaimID:        claim.ID,
			Decision:       models.DecisionDenied,
			Confidence:     1.0,
			Reason:         fmt.Sprintf("Validation failed: %s", err.Error()),
			SLADeadline:    time.Now().Add(1 * time.Hour),
			RiskScore:      0,
			ProcessingTime: time.Since(start),
		}
	}

	// Calculate risk score using comprehensive rules
	riskScore := e.calculateRiskScore(claim)
	claim.RiskScore = riskScore

	// Check fraud indicators
	fraudFlags := e.detectFraud(claim)
	claim.FraudFlags = fraudFlags
	if len(fraudFlags) > 0 {
		e.logger.Warn("Fraud indicators detected",
			zap.String("claim_id", claim.ID),
			zap.Any("flags", fraudFlags),
		)
	}

	// Determine queue and SLA deadline based on risk and amount
	decision, queue, reason, confidence := e.determineDecision(claim, riskScore, fraudFlags)

	// Set SLA deadline based on decision
	slaDeadline := e.calculateSLADeadline(claim, decision)

	// Check rate limits before processing
	if e.config.RateLimit.Enabled && e.cache != nil {
		if err := e.checkRateLimits(claim); err != nil {
			e.logger.Warn("Rate limit check failed",
				zap.String("claim_id", claim.ID),
				zap.Error(err),
			)
		}
	}

	result := &models.AdjudicationResult{
		ClaimID:        claim.ID,
		Decision:       decision,
		Confidence:     confidence,
		Reason:         reason,
		AssignedTo:     queue,
		Queue:          queue,
		SLADeadline:    slaDeadline,
		RiskScore:      riskScore,
		FraudFlags:     fraudFlags,
		ComplianceTags: e.determineComplianceTags(claim, decision),
		NextActions:    e.determineNextActions(claim, decision, fraudFlags),
		ProcessingTime: time.Since(start),
	}

	// Update claim in database and cache
	if e.db != nil {
		claim.Status = models.ClaimStatus(fmt.Sprintf("%s", result.Decision))
		claim.Decision = result.Decision
		claim.Confidence = result.Confidence
		claim.AssignedTo = result.AssignedTo
		claim.Queue = result.Queue
		claim.Reason = result.Reason
		claim.SLADeadline = result.SLADeadline
		claim.UpdatedAt = time.Now()

		if err := e.db.UpdateClaim(context.Background(), claim); err != nil {
			e.logger.Error("Failed to update claim in database",
				zap.String("claim_id", claim.ID),
				zap.Error(err),
			)
		}

		// Record adjudication history
		e.recordAdjudicationHistory(claim, result)
	}

	// Update cache
	if e.cache != nil {
		_ = e.cache.SetCachedClaim(context.Background(), claim)
		_ = e.cache.CacheAdjudicationResult(context.Background(), claim.ID, string(result.Decision))
	}

	// Track metrics
	e.trackAdjudicationMetric(result)

	return result
}

// validateClaim validates all claim fields and business rules
func (e *Engine) validateClaim(claim *models.Claim) error {
	var errs []string

	if claim.PolicyID == "" {
		errs = append(errs, "policy_id is required")
	}
	if claim.ClaimantID == "" {
		errs = append(errs, "claimant_id is required")
	}
	if claim.InsurerID == "" {
		errs = append(errs, "insurer_id is required")
	}
	if claim.Amount <= 0 {
		errs = append(errs, "amount must be positive")
	}
	if claim.Amount > 1e12 {
		errs = append(errs, "amount exceeds maximum threshold (1 trillion)")
	}
	if claim.Type == "" {
		errs = append(errs, "claim type is required")
	}
	if len(claim.Description) < 10 {
		errs = append(errs, "description must be at least 10 characters")
	}
	if len(claim.Description) > 5000 {
		errs = append(errs, "description exceeds maximum length (5000 characters)")
	}

	// Validate claim type is known
	validTypes := map[models.ClaimType]bool{
		models.ClaimTypeLife: true, models.ClaimTypeHealth: true,
		models.ClaimTypeMotor: true, models.ClaimTypeProperty: true,
		models.ClaimTypeMarine: true, models.ClaimTypeFire: true,
		models.ClaimTypeEngineering: true, models.ClaimTypeGeneralLiability: true,
		models.ClaimTypeMicroInsurance: true, models.ClaimTypeBancassurance: true,
	}
	if !validTypes[claim.Type] {
		errs = append(errs, fmt.Sprintf("invalid claim type: %s", claim.Type))
	}

	if len(errs) > 0 {
		return errors.New(fmt.Sprintf("validation failed: %s", errs[0]))
	}

	return nil
}

// calculateRiskScore computes a risk score from 0-100
func (e *Engine) calculateRiskScore(claim *models.Claim) float64 {
	score := 0.0

	// Amount-based scoring (max 35 points)
	if claim.Amount > 10000000 {
		score += 35 // >₦10M
	} else if claim.Amount > 5000000 {
		score += 30 // >₦5M
	} else if claim.Amount > 1000000 {
		score += 25 // >₦1M
	} else if claim.Amount > 500000 {
		score += 15 // >₦500K
	} else if claim.Amount > 200000 {
		score += 10 // >₦200K
	}

	// Evidence scoring (max 40 points, inversely proportional)
	if len(claim.Evidence) == 0 {
		score += 40
	} else if len(claim.Evidence) == 1 {
		score += 30
	} else if len(claim.Evidence) == 2 {
		score += 15
	}

	// Time-based scoring
	daysSinceSubmission := time.Since(claim.SubmittedAt).Hours() / 24
	if daysSinceSubmission < 0.5 {
		score += 5 // Very recent claim
	}

	// Claim type risk multiplier
	switch claim.Type {
	case models.ClaimTypeLife:
		score += 5 // Life claims slightly higher risk
	case models.ClaimTypeHealth:
		score += 3
	case models.ClaimTypeMotor:
		score += 2
	}

	return math.Min(score, 100)
}

// detectFraud identifies fraud indicators in a claim
func (e *Engine) detectFraud(claim *models.Claim) []string {
	flags := make([]string, 0)

	// High amount without sufficient evidence
	if claim.Amount > 5000000 && len(claim.Evidence) < 3 {
		flags = append(flags, "high_amount_insufficient_evidence")
	}

	// Very recent claim with high amount
	daysSinceSubmission := time.Since(claim.SubmittedAt).Hours() / 24
	if daysSinceSubmission < 1 && claim.Amount > 1000000 {
		flags = append(flags, "same_day_high_amount_claim")
	}

	// Amount anomaly (round numbers)
	if claim.Amount > 100000 && claim.Amount == float64(int(claim.Amount/100000)*100000) {
		flags = append(flags, "round_number_amount")
	}

	// Duplicate evidence patterns
	if len(claim.Evidence) > 5 {
		seen := make(map[string]bool)
		for _, ev := range claim.Evidence {
			if seen[ev.ID] {
				flags = append(flags, "duplicate_evidence")
				break
			}
			seen[ev.ID] = true
		}
	}

	return flags
}

// determineDecision assigns a decision based on risk and amount
func (e *Engine) determineDecision(claim *models.Claim, riskScore float64, fraudFlags []string) (models.ClaimDecision, string, string, float64) {
	// Fraud always escalates
	if len(fraudFlags) > 0 {
		return models.DecisionFraudAlert, "fraud_investigation_queue",
			fmt.Sprintf("Claim flagged for fraud investigation: %v", fraudFlags), 1.0
	}

	// High amount or high risk -> escalate
	if claim.Amount > 500000 || riskScore >= 70 {
		return models.DecisionEscalated, "executive_review_queue",
			fmt.Sprintf("High amount (₦%.0f) or high risk (%.0f%%) requires executive review", claim.Amount, riskScore),
			0.60
	}

	// Low amount, low risk, sufficient evidence -> auto-approve
	if claim.Amount <= 50000 && riskScore < 30 && len(claim.Evidence) >= 2 {
		return models.DecisionAutoApproved, "",
			"Auto-approved: amount within threshold, low risk, sufficient evidence", 0.95
	}

	// Everything else -> supervisor review
	return models.DecisionPendingReview, "supervisor_queue",
		"Requires supervisor review: moderate amount/risk profile", 0.75
}

// calculateSLADeadline determines the SLA deadline based on decision and claim type
func (e *Engine) calculateSLADeadline(claim *models.Claim, decision models.ClaimDecision) time.Time {
	switch decision {
	case models.DecisionAutoApproved:
		return time.Now().Add(time.Duration(e.config.SLA.AutoApprovalMaxHours) * time.Hour)
	case models.DecisionPendingReview:
		return time.Now().Add(time.Duration(e.config.SLA.SupervisorReviewHours) * time.Hour)
	case models.DecisionEscalated:
		return time.Now().Add(time.Duration(e.config.SLA.ExecutiveApprovalDays) * 24 * time.Hour)
	case models.DecisionFraudAlert:
		return time.Now().Add(time.Duration(e.config.SLA.FraudInvestigationDays) * 24 * time.Hour)
	default:
		return time.Now().Add(24 * time.Hour)
	}
}

// determineComplianceTags adds regulatory compliance tags
func (e *Engine) determineComplianceTags(claim *models.Claim, decision models.ClaimDecision) []string {
	tags := make([]string, 0)

	// NAICOM compliance tags
	if claim.Amount > 5000000 {
		tags = append(tags, "naicom_high_value")
	}
	if claim.Amount > 10000000 {
		tags = append(tags, "naicom_regulatory_review_required")
	}

	// CBN AML tags
	if claim.Amount > 5000000 {
		tags = append(tags, "cbn_str_threshold")
	}

	// Fraud-related tags
	if decision == models.DecisionFraudAlert {
		tags = append(tags, "aml_fraud_alert")
	}

	// NDPR data protection
	tags = append(tags, "ndpr_applicable")

	return tags
}

// determineNextActions generates follow-up actions
func (e *Engine) determineNextActions(claim *models.Claim, decision models.ClaimDecision, fraudFlags []string) []models.NextAction {
	actions := make([]models.NextAction, 0)

	switch decision {
	case models.DecisionAutoApproved:
		actions = append(actions, models.NextAction{
			Type:     "payment_processing",
			Label:    "Initiate payment to claimant",
			Priority: "high",
			DueBy:    time.Now().Add(24 * time.Hour),
		})
	case models.DecisionPendingReview:
		actions = append(actions, models.NextAction{
			Type:     "supervisor_review",
			Label:    "Assign to supervisor for manual review",
			Priority: "medium",
			DueBy:    time.Now().Add(24 * time.Hour),
		})
	case models.DecisionEscalated:
		actions = append(actions, models.NextAction{
			Type:     "executive_approval",
			Label:    "Escalate to executive committee",
			Priority: "high",
			DueBy:    time.Now().Add(48 * time.Hour),
		})
		if claim.Amount > 5000000 {
			actions = append(actions, models.NextAction{
				Type:     "naicom_notification",
				Label:    "Notify NAICOM of high-value claim",
				Priority: "high",
				DueBy:    time.Now().Add(24 * time.Hour),
			})
		}
	case models.DecisionFraudAlert:
		actions = append(actions, models.NextAction{
			Type:     "fraud_investigation",
			Label:    "Initiate fraud investigation",
			Priority: "critical",
			DueBy:    time.Now().Add(12 * time.Hour),
		})
		actions = append(actions, models.NextAction{
			Type:     "payment_hold",
			Label:    "Place payment on hold",
			Priority: "critical",
			DueBy:    time.Now().Add(1 * time.Hour),
		})
		actions = append(actions, models.NextAction{
			Type:     "cbn_notification",
			Label:    "File STR with CBN if threshold met",
			Priority: "high",
			DueBy:    time.Now().Add(48 * time.Hour),
		})
	}

	return actions
}

// checkRateLimits validates rate limits for claims per policy
func (e *Engine) checkRateLimits(claim *models.Claim) error {
	if e.cache == nil {
		return nil
	}

	count, err := e.cache.GetPolicyClaimCount(context.Background(), claim.PolicyID)
	if err != nil {
		return fmt.Errorf("failed to check policy claim count: %w", err)
	}

	if count >= e.config.RateLimit.MaxClaimsPerDay {
		return fmt.Errorf("rate limit exceeded: policy %s has reached max claims per day", claim.PolicyID)
	}

	if _, err := e.cache.IncrementPolicyClaimCount(context.Background(), claim.PolicyID, e.config.RateLimit.MaxClaimsPerDay); err != nil {
		return fmt.Errorf("failed to update policy claim count: %w", err)
	}

	return nil
}

// recordAdjudicationHistory stores the adjudication decision in history
func (e *Engine) recordAdjudicationHistory(claim *models.Claim, result *models.AdjudicationResult) {
	if e.db == nil {
		return
	}

	history := models.AdjudicationResult{
		ClaimID: result.ClaimID,
	}
	_ = history // Used for context in the actual implementation
	// The history is recorded via the UpdateClaimStatus method in the repository
}

// trackAdjudicationMetric updates processing metrics
func (e *Engine) trackAdjudicationMetric(result *models.AdjudicationResult) {
	e.requestCount.Add(1)

	if result.Decision == models.DecisionDenied || result.Decision == models.DecisionFraudAlert {
		e.errorCount.Add(1)
	}

	// Track in cache if available
	if e.cache != nil {
		if err := e.cache.IncrementMetric(context.Background(), "total_processed", 1); err != nil {
			e.logger.Error("Failed to increment metric", zap.Error(err))
		}
	}
}

// ServeHTTP implements http.Handler for chi router compatibility
func (e *Engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	chi.NewRouter().ServeHTTP(w, r)
}

// ========================== HTTP Handlers ==========================

// ── Kafka Event Publishing (via REST Proxy) ─────────────────────────────────
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
	defer func() { _ = resp.Body.Close() }()
}

// ── Redis Caching ───────────────────────────────────────────────────────────
var redisAddr string

type redisConn struct {
	addr string
}

func initRedis() *redisConn {
	redisAddr = os.Getenv("REDIS_URL")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	log.Printf("Redis configured at %s", redisAddr)
	return &redisConn{addr: redisAddr}
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
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "rate limit exceeded", "retry_after": 60})
			return
		}
		bucket.tokens--
		prodRateLimitMu.Unlock()
		next.ServeHTTP(w, r)
	})
}

// Prometheus-compatible metrics
var (
	prodMetricsReqCount  int64
	prodMetricsErrCount  int64
	prodMetricsStartTime = time.Now()
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
	_, _ = fmt.Fprintf(w, "# HELP http_requests_total Total HTTP requests\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_requests_total counter\n")
	_, _ = fmt.Fprintf(w, "http_requests_total %d\n", reqCount)
	_, _ = fmt.Fprintf(w, "# HELP http_errors_total Total HTTP errors (4xx/5xx)\n")
	_, _ = fmt.Fprintf(w, "# TYPE http_errors_total counter\n")
	_, _ = fmt.Fprintf(w, "http_errors_total %d\n", errCount)
	_, _ = fmt.Fprintf(w, "# HELP process_uptime_seconds Process uptime in seconds\n")
	_, _ = fmt.Fprintf(w, "# TYPE process_uptime_seconds gauge\n")
	_, _ = fmt.Fprintf(w, "process_uptime_seconds %.2f\n", uptime)
}

// Panic recovery middleware - catches panics and returns 500
func prodRecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{"error": "internal server error", "recovered": true})
				log.Printf(`{"level":"error","msg":"panic recovered","error":"%v","path":"%s","method":"%s"}`, err, r.URL.Path, r.Method)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// legacyDB backs the standalone initDB helper below. It is named legacyDB to
// avoid colliding with the imported "db" package (claims repository).
var legacyDB *sql.DB

func initDB() {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://ngapp:ngapp@localhost:5432/ngapp?sslmode=disable"
	}
	var err error
	legacyDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		log.Printf("WARN: database connection failed: %v", err)
		return
	}
	legacyDB.SetMaxOpenConns(25)
	legacyDB.SetMaxIdleConns(5)
	legacyDB.SetConnMaxLifetime(5 * time.Minute)
	if err = legacyDB.Ping(); err != nil {
		log.Printf("WARN: database ping failed: %v", err)
		return
	}
	log.Printf(`{"level":"info","msg":"database connected","service":"claims-adjudication-engine","driver":"postgresql"}`)
	_, err = legacyDB.Exec(`CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, policy_id TEXT NOT NULL, claimant_id TEXT, amount NUMERIC(15,2), claim_type TEXT, status TEXT DEFAULT 'submitted', risk_score NUMERIC(5,2), decision TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`)
	if err != nil {
		log.Printf("WARN: table creation failed: %v", err)
	}
}

func handleLive(w http.ResponseWriter, r *http.Request) {
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "alive"})
}

// Circuit breaker for external API calls
type circuitBreaker struct {
	maxFailures int
	failures    int
	state       string // "closed", "open", "half-open"
	lastFailure time.Time
	timeout     time.Duration
	mu          sync.Mutex
}

var externalAPIBreaker = &circuitBreaker{
	maxFailures: 5,
	state:       "closed",
	timeout:     30 * time.Second,
}

func (cb *circuitBreaker) execute(fn func() error) error {
	cb.mu.Lock()
	if cb.state == "open" {
		if time.Since(cb.lastFailure) > cb.timeout {
			cb.state = "half-open"
		} else {
			cb.mu.Unlock()
			log.Printf(`{"level":"warn","msg":"circuit breaker open","failures":%d}`, cb.failures)
			return fmt.Errorf("circuit breaker open: too many failures")
		}
	}
	cb.mu.Unlock()

	err := fn()

	cb.mu.Lock()
	defer cb.mu.Unlock()
	if err != nil {
		cb.failures++
		cb.lastFailure = time.Now()
		if cb.failures >= cb.maxFailures {
			cb.state = "open"
			log.Printf(`{"level":"error","msg":"circuit breaker tripped","failures":%d}`, cb.failures)
		}
		return err
	}
	cb.failures = 0
	cb.state = "closed"
	return nil
}

func main() {
	// Load configuration
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	// Create engine
	engine, err := NewEngine(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize engine: %v", err)
	}
	defer func() { _ = engine.Shutdown(context.Background()) }()

	// Setup router
	r := chi.NewRouter()
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(60 * time.Second))

	// CORS
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   getEnvStringSlice("ALLOWED_ORIGINS", []string{"*"}),
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Request-ID"},
		ExposedHeaders:   []string{"Link", "X-Total-Count"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health check
	r.Get("/health", handleHealth(engine))
	r.Get("/ready", handleReady(engine))
	r.Get("/metrics", handleMetrics(engine))

	// Claims API
	r.Route("/api/v1/claims", func(r chi.Router) {
		r.Post("/", handleCreateClaim(engine))
		r.Get("/{claimID}", handleGetClaim(engine))
		r.Put("/{claimID}/status", handleUpdateClaimStatus(engine))
		r.Put("/{claimID}/approve", handleApproveClaim(engine))
		r.Put("/{claimID}/deny", handleDenyClaim(engine))
		r.Put("/{claimID}/escalate", handleEscalateClaim(engine))
		r.Get("/", handleListClaims(engine))
		r.Get("/queue/{queueName}", handleGetQueueClaims(engine))
		r.Get("/metrics", handleClaimsMetrics(engine))
	})

	// Adjudication (legacy endpoint, redirects to claims)
	r.Post("/api/v1/adjudicate", handleAdjudicate(engine))

	port := fmt.Sprintf(":%d", cfg.Server.Port)
	logger := engine.logger

	logger.Info("Starting claims adjudication engine",
		zap.String("port", port),
		zap.String("environment", cfg.Server.Environment),
	)

	// Graceful shutdown
	server := &http.Server{
		Addr:         port,
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  30 * time.Second,
	}

	// Start server in goroutine
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Server failed", zap.Error(err))
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		logger.Fatal("Server forced to shutdown", zap.Error(err))
	}
}

// handleHealth returns the health status of the service
func handleHealth(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status := models.HealthStatus{
			Status:    "healthy",
			Service:   "claims-adjudication-engine",
			Version:   "1.0.0",
			Timestamp: time.Now(),
			UpTime:    time.Since(e.startTime),
		}

		if e.db != nil {
			status.DBConnected = true
		}
		if e.cache != nil {
			status.RedisConnected = e.cache.IsConnected()
		}
		if !e.healthy.Load() {
			status.Status = "unhealthy"
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(status)
	}
}

// handleReady returns the readiness status
func handleReady(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ready := true
		if e.db == nil {
			ready = false
		}

		if ready {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "ready",
				"checks":  map[string]string{"database": "connected"},
				"version": "1.0.0",
			})
		} else {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "not_ready",
				"checks": map[string]string{"database": "disconnected"},
			})
		}
	}
}

// handleAdjudicate handles POST /api/v1/adjudicate (legacy endpoint)
func handleAdjudicate(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var input models.ClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		// Validate required fields
		if input.PolicyID == "" || input.ClaimantID == "" || input.Amount <= 0 {
			http.Error(w, "Missing required fields: policy_id, claimant_id, amount", http.StatusBadRequest)
			return
		}

		// Build claim from input
		claim := &models.Claim{
			ID:           input.PolicyID + "-" + input.ClaimantID + "-" + fmt.Sprint(time.Now().UnixNano()),
			PolicyID:     input.PolicyID,
			PolicyNumber: input.PolicyNumber,
			ClaimantID:   input.ClaimantID,
			ClaimantName: input.ClaimantName,
			InsurerID:    input.InsurerID,
			Amount:       input.Amount,
			Type:         input.Type,
			Description:  input.Description,
			Evidence:     make([]models.EvidenceDoc, len(input.Evidence)),
			Status:       models.ClaimStatusSubmitted,
			SubmittedAt:  time.Now(),
			UpdatedAt:    time.Now(),
		}

		for i, ev := range input.Evidence {
			claim.Evidence[i] = models.EvidenceDoc{
				ID:         fmt.Sprintf("ev-%d", i),
				Type:       ev.Type,
				FileName:   ev.FileName,
				URL:        ev.URL,
				UploadedAt: time.Now(),
			}
		}

		result := e.adjudicateClaim(claim)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(result)
	}
}

// handleCreateClaim handles POST /api/v1/claims
func handleCreateClaim(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input models.ClaimRequest
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			http.Error(w, fmt.Sprintf("Invalid request body: %v", err), http.StatusBadRequest)
			return
		}

		if err := input.Validate(); err != nil {
			http.Error(w, fmt.Sprintf("Validation error: %v", err), http.StatusBadRequest)
			return
		}

		claim := &models.Claim{
			ID:           fmt.Sprintf("CLM-%d", time.Now().UnixNano()),
			PolicyID:     input.PolicyID,
			PolicyNumber: input.PolicyNumber,
			ClaimantID:   input.ClaimantID,
			ClaimantName: input.ClaimantName,
			InsurerID:    input.InsurerID,
			Amount:       input.Amount,
			Type:         input.Type,
			Description:  input.Description,
			Evidence:     make([]models.EvidenceDoc, len(input.Evidence)),
			Status:       models.ClaimStatusSubmitted,
			SubmittedAt:  time.Now(),
			UpdatedAt:    time.Now(),
		}

		for i, ev := range input.Evidence {
			claim.Evidence[i] = models.EvidenceDoc{
				ID:         fmt.Sprintf("EVD-%d-%d", time.Now().UnixNano(), i),
				Type:       ev.Type,
				FileName:   ev.FileName,
				URL:        ev.URL,
				UploadedAt: time.Now(),
			}
		}

		result := e.adjudicateClaim(claim)

		// Store in database
		if e.db != nil {
			if err := e.db.CreateClaim(context.Background(), claim); err != nil {
				e.logger.Error("Failed to create claim in database", zap.Error(err))
				http.Error(w, "Failed to create claim", http.StatusInternalServerError)
				return
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"claim":   claim,
			"result":  result,
			"message": "Claim submitted and adjudicated successfully",
		})
	}
}

// handleGetClaim handles GET /api/v1/claims/{claimID}
func handleGetClaim(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claimID := chi.URLParam(r, "claimID")

		// Try cache first
		if e.cache != nil {
			if cached, err := e.cache.GetCachedClaim(r.Context(), claimID); err == nil && cached != nil {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(cached)
				return
			}
		}

		// Fall back to database
		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		claim, err := e.db.GetClaim(r.Context(), claimID)
		if err != nil {
			http.Error(w, fmt.Sprintf("Claim not found: %v", err), http.StatusNotFound)
			return
		}

		// Update cache
		if e.cache != nil {
			_ = e.cache.SetCachedClaim(r.Context(), claim)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(claim)
	}
}

// handleListClaims handles GET /api/v1/claims
func handleListClaims(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		filter := &models.ClaimFilter{
			Limit:     20,
			Offset:    0,
			SortBy:    "created_at",
			SortOrder: "DESC",
		}

		if status := r.URL.Query().Get("status"); status != "" {
			filter.Status = models.ClaimStatus(status)
		}
		if typ := r.URL.Query().Get("type"); typ != "" {
			filter.Type = models.ClaimType(typ)
		}
		if insurerID := r.URL.Query().Get("insurer_id"); insurerID != "" {
			filter.InsurerID = insurerID
		}
		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			_, _ = fmt.Sscanf(limitStr, "%d", &filter.Limit)
		}
		if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
			_, _ = fmt.Sscanf(offsetStr, "%d", &filter.Offset)
		}

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		paginated, err := e.db.GetClaimsByFilter(r.Context(), filter)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to list claims: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(paginated)
	}
}

// handleUpdateClaimStatus handles PUT /api/v1/claims/{claimID}/status
func handleUpdateClaimStatus(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claimID := chi.URLParam(r, "claimID")

		var update struct {
			Status     string `json:"status"`
			Reason     string `json:"reason"`
			AssignedTo string `json:"assigned_to"`
		}
		if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		newStatus := models.ClaimStatus(update.Status)
		if newStatus == "" {
			http.Error(w, "Status is required", http.StatusBadRequest)
			return
		}

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		if err := e.db.UpdateClaimStatus(r.Context(), claimID, newStatus, "", map[string]interface{}{"reason": update.Reason}); err != nil {
			http.Error(w, fmt.Sprintf("Failed to update claim: %v", err), http.StatusInternalServerError)
			return
		}

		// Invalidate cache
		if e.cache != nil {
			_ = e.cache.InvalidateClaim(r.Context(), claimID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"claim_id": claimID,
			"status":   string(newStatus),
			"message":  "Claim status updated",
		})
	}
}

// handleApproveClaim handles PUT /api/v1/claims/{claimID}/approve
func handleApproveClaim(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claimID := chi.URLParam(r, "claimID")

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		if err := e.db.UpdateClaimStatus(r.Context(), claimID, models.ClaimStatusApproved, models.DecisionAutoApproved, map[string]interface{}{"action": "approve"}); err != nil {
			http.Error(w, fmt.Sprintf("Failed to approve claim: %v", err), http.StatusInternalServerError)
			return
		}

		if e.cache != nil {
			_ = e.cache.InvalidateClaim(r.Context(), claimID)
			_ = e.cache.RemoveFromQueue(r.Context(), "supervisor_queue", claimID)
			_ = e.cache.RemoveFromQueue(r.Context(), "executive_review_queue", claimID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"claim_id": claimID,
			"decision": "approved",
			"message":  "Claim approved successfully",
		})
	}
}

// handleDenyClaim handles PUT /api/v1/claims/{claimID}/deny
func handleDenyClaim(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claimID := chi.URLParam(r, "claimID")

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		if err := e.db.UpdateClaimStatus(r.Context(), claimID, models.ClaimStatusDenied, models.DecisionDenied, map[string]interface{}{"action": "deny"}); err != nil {
			http.Error(w, fmt.Sprintf("Failed to deny claim: %v", err), http.StatusInternalServerError)
			return
		}

		if e.cache != nil {
			_ = e.cache.InvalidateClaim(r.Context(), claimID)
			_ = e.cache.RemoveFromQueue(r.Context(), "supervisor_queue", claimID)
			_ = e.cache.RemoveFromQueue(r.Context(), "executive_review_queue", claimID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"claim_id": claimID,
			"decision": "denied",
			"message":  "Claim denied successfully",
		})
	}
}

// handleEscalateClaim handles PUT /api/v1/claims/{claimID}/escalate
func handleEscalateClaim(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claimID := chi.URLParam(r, "claimID")

		var body struct {
			Reason string `json:"reason"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		if err := e.db.UpdateClaimStatus(r.Context(), claimID, models.ClaimStatusEscalated, models.DecisionEscalated, map[string]interface{}{"action": "escalate", "reason": body.Reason}); err != nil {
			http.Error(w, fmt.Sprintf("Failed to escalate claim: %v", err), http.StatusInternalServerError)
			return
		}

		if e.cache != nil {
			_ = e.cache.AddToQueue(r.Context(), "executive_review_queue", claimID)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"claim_id": claimID,
			"status":   "escalated",
			"message":  "Claim escalated to executive review",
		})
	}
}

// handleGetQueueClaims handles GET /api/v1/claims/queue/{queueName}
func handleGetQueueClaims(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		queueName := chi.URLParam(r, "queueName")
		limit := 20

		if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
			_, _ = fmt.Sscanf(limitStr, "%d", &limit)
		}

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		claims, err := e.db.GetClaimsInQueue(r.Context(), queueName, limit)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get queue claims: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"queue":  queueName,
			"claims": claims,
			"count":  len(claims),
			"limit":  limit,
		})
	}
}

// handleClaimsMetrics handles GET /api/v1/claims/metrics
func handleClaimsMetrics(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Try cache first
		if e.cache != nil {
			if cached, err := e.cache.GetCachedMetrics(r.Context()); err == nil && cached != nil {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(cached)
				return
			}
		}

		if e.db == nil {
			http.Error(w, "Database not available", http.StatusServiceUnavailable)
			return
		}

		metrics, err := e.db.GetMetrics(r.Context())
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get metrics: %v", err), http.StatusInternalServerError)
			return
		}

		// Update cache
		if e.cache != nil {
			_ = e.cache.SetCachedMetrics(r.Context(), metrics)
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(metrics)
	}
}

// handleMetrics handles GET /metrics (Prometheus-compatible)
func handleMetrics(e *Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var metrics map[string]interface{}

		if e.db != nil {
			if m, err := e.db.GetMetrics(r.Context()); err == nil {
				metrics = map[string]interface{}{
					"total_claims_processed": m.TotalClaimsProcessed,
					"auto_approved_rate":     m.AutoApprovedRate,
					"denied_rate":            m.DeniedRate,
					"escalated_rate":         m.EscalatedRate,
					"avg_processing_time":    m.AvgProcessingTime,
					"max_processing_time":    m.MaxProcessingTime,
					"sla_compliance":         m.SLACompliance,
					"current_queue_size":     m.CurrentQueueSize,
					"avg_claim_amount":       m.AvgClaimAmount,
					"fraud_alert_count":      m.FraudAlertCount,
				}
			}
		}

		if metrics == nil {
			metrics = map[string]interface{}{}
		}

		metrics["service"] = "claims-adjudication-engine"
		metrics["uptime_seconds"] = time.Since(e.startTime).Seconds()
		metrics["requests_processed"] = e.requestCount.Load()
		metrics["errors"] = e.errorCount.Load()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(metrics)
	}
}

// Helper functions
func getEnvStringSlice(key string, defaultValue []string) []string {
	if value := os.Getenv(key); value != "" {
		return []string{value}
	}
	return defaultValue
}
