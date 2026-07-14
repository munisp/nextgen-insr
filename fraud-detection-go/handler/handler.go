package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/insureportal/fraud-detection-go/config"
	"github.com/insureportal/fraud-detection-go/db"
	"github.com/insureportal/fraud-detection-go/models"
	"go.uber.org/zap"
)

// Service holds all dependencies for HTTP handlers.
type Service struct {
	cfg     config.Config
	store   *db.PostgresStore
	cache   *db.RedisCache
	logger  *zap.Logger
}

// NewService creates a handler service from configuration and database/cache.
func NewService(cfg config.Config, store *db.PostgresStore, cache *db.RedisCache, logger *zap.Logger) *Service {
	return &Service{cfg: cfg, store: store, cache: cache, logger: logger}
}

// writeJSON marshals data to JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// writeError writes a standardized error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, models.ErrorJSON{Success: false, Error: msg})
}

// HealthHandler returns service health with DB/Redis connectivity status.
func (s *Service) HealthHandler(w http.ResponseWriter, r *http.Request) {
	checks := make(map[string]string)

	// Check DB connectivity
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := s.store.Ping(ctx); err != nil {
		checks["database"] = fmt.Sprintf("error: %s", err)
	} else {
		checks["database"] = "connected"
	}

	// Check Redis connectivity
	ctx2, cancel2 := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel2()
	if err := s.cache.Ping(ctx2); err != nil {
		checks["redis"] = fmt.Sprintf("error: %s", err)
	} else {
		checks["redis"] = "connected"
	}

	status := "healthy"
	if checks["database"] != "connected" || checks["redis"] != "connected" {
		status = "degraded"
	}

	writeJSON(w, http.StatusOK, models.HealthResponse{
		Status:  status,
		Service: "fraud-detection-go",
		Checks:  checks,
	})
}

// ReadyHandler returns true when the service is ready to accept traffic.
func (s *Service) ReadyHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, models.ReadyResponse{
		Status:  "ready",
		Service: "fraud-detection-go",
	})
}

// ScoreHandler validates, scores, persists, and caches a transaction.
func (s *Service) ScoreHandler(w http.ResponseWriter, r *http.Request) {
	var body models.TransactionInput
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	if err := body.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()

	// Check if account is blocked
	blocked, err := s.cache.IsBlocked(ctx, body.AccountID)
	if err != nil {
		s.logger.Error("check block list", zap.Error(err))
		writeError(w, http.StatusServiceUnavailable, "unable to check account status")
		return
	}
	if blocked {
		writeJSON(w, http.StatusForbidden, models.APIResponse{
			Success: false,
			Data:    models.FraudScore{Decision: "block", Details: "account is blocked"},
		})
		return
	}

	// Calculate base hour if not provided
	hourOfDay := 12
	if body.HourOfDay != nil {
		hourOfDay = *body.HourOfDay
	}
	if hourOfDay < 0 || hourOfDay > 23 {
		hourOfDay = 12
	}

	// Run scoring rules
	score, rules := s.calculateScore(body.Amount, hourOfDay, body.DeviceID)

	// Check velocity
	velocityCount, velErr := s.cache.CheckVelocity(ctx, body.AccountID, s.cfg.Fraud.VelocityWindow)
	if velErr != nil {
		s.logger.Warn("velocity check failed, continuing without it", zap.Error(velErr))
	}
	velocityCount++ // include this transaction

	if velocityCount >= s.cfg.Fraud.VelocityThreshold {
		score += 25
		rules = append(rules, models.Rule{
			Name:   "velocity_breach",
			Impact: 25,
			Detail: fmt.Sprintf("%d transactions in %.0fm (threshold: %d)",
				velocityCount, s.cfg.Fraud.VelocityWindow.Minutes(), s.cfg.Fraud.VelocityThreshold),
		})
	}

	// Track this transaction in Redis
	if err := s.cache.TrackTransactionCount(ctx, body.AccountID); err != nil {
		s.logger.Warn("track transaction failed", zap.Error(err))
	}

	// Clamp score
	score = math.Min(100, score)

	// Determine decision
	decision := "allow"
	if score >= s.cfg.Fraud.BlockScore {
		decision = "block"
	} else if score >= s.cfg.Fraud.ReviewScore {
		decision = "review"
	}

	fraudScore := models.FraudScore{
		TransactionID: body.GenerateTransactionID(),
		Score:         score,
		Decision:      decision,
		Rules:         rules,
		AccountID:     body.AccountID,
		Amount:        body.Amount,
	}

	// Persist to database
	if err := s.store.StoreScore(ctx, fraudScore); err != nil {
		s.logger.Error("persist score", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "unable to persist scoring result")
		return
	}

	// Cache the score
	if err := s.cache.CacheScore(ctx, fraudScore, 10*time.Minute); err != nil {
		s.logger.Warn("cache score", zap.Error(err))
	}

	// Auto-create fraud case for blocked transactions
	if decision == "block" {
		caseID := fmt.Sprintf("CASE-%s", fraudScore.TransactionID)
		evidence := s.buildEvidence(body, fraudScore)

		fraudCase := models.FraudCase{
			CaseID:        caseID,
			TransactionID: fraudScore.TransactionID,
			AccountID:     body.AccountID,
			Score:         fraudScore.Score,
			Decision:      decision,
			Status:        "open",
			Evidence:      evidence,
			AssignedTo:    "",
		}
		if err := s.store.CreateFraudCase(ctx, fraudCase); err != nil {
			s.logger.Error("create fraud case", zap.Error(err))
		}
		// Block the account in Redis
		if err := s.cache.SetBlockedAccount(ctx, body.AccountID, s.cfg.Fraud.BlockTTL); err != nil {
			s.logger.Error("block account in redis", zap.Error(err))
		}
	}

	writeJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data:    fraudScore,
	})
}

// buildEvidence constructs a human-readable evidence string for fraud cases.
func (s *Service) buildEvidence(body models.TransactionInput, score models.FraudScore) string {
	var parts []string
	parts = append(parts, fmt.Sprintf("Amount: %.2f", score.Amount))
	parts = append(parts, fmt.Sprintf("Score: %.2f", score.Score))
	parts = append(parts, fmt.Sprintf("Account: %s", score.AccountID))
	if body.Location != "" {
		parts = append(parts, fmt.Sprintf("Location: %s", body.Location))
	}
	if body.IP != "" {
		parts = append(parts, fmt.Sprintf("IP: %s", body.IP))
	}
	for _, r := range score.Rules {
		parts = append(parts, fmt.Sprintf("Rule: %s (%.0f impact) - %s", r.Name, r.Impact, r.Detail))
	}
	return strings.Join(parts, "; ")
}

// HistoryHandler returns the last N transactions for an account.
func (s *Service) HistoryHandler(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	if accountID == "" {
		writeError(w, http.StatusBadRequest, "account_id is required")
		return
	}

	records, err := s.store.GetTransactionHistory(r.Context(), accountID, 50)
	if err != nil {
		s.logger.Error("query history", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "unable to retrieve transaction history")
		return
	}

	writeJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data:    records,
	})
}

// FraudCasesHandler handles POST (create) and GET (list) for fraud cases.
func (s *Service) FraudCasesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var req struct {
			TransactionID string `json:"transaction_id"`
			AccountID     string `json:"account_id"`
			Score         float64 `json:"score"`
			Decision      string  `json:"decision"`
			Evidence      string  `json:"evidence"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		if req.AccountID == "" || req.TransactionID == "" {
			writeError(w, http.StatusBadRequest, "account_id and transaction_id are required")
			return
		}

		caseID := fmt.Sprintf("CASE-%s", req.TransactionID)
		fraudCase := models.FraudCase{
			CaseID:        caseID,
			TransactionID: req.TransactionID,
			AccountID:     req.AccountID,
			Score:         req.Score,
			Decision:      req.Decision,
			Status:        "open",
			Evidence:      req.Evidence,
		}
		if err := s.store.CreateFraudCase(r.Context(), fraudCase); err != nil {
			s.logger.Error("create fraud case", zap.Error(err))
			writeError(w, http.StatusInternalServerError, "unable to create fraud case")
			return
		}
		writeJSON(w, http.StatusCreated, models.APIResponse{Success: true, Data: fraudCase})
		return
	}

	// GET — list cases with optional ?status=&account_id= query params
	status := r.URL.Query().Get("status")
	accountID := r.URL.Query().Get("account_id")

	cases, err := s.store.GetFraudCases(r.Context(), status, accountID, 50)
	if err != nil {
		s.logger.Error("query fraud cases", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "unable to retrieve fraud cases")
		return
	}

	writeJSON(w, http.StatusOK, models.APIResponse{Success: true, Data: cases})
}

// RulesHandler returns the current detection rules.
func (s *Service) RulesHandler(w http.ResponseWriter, r *http.Request) {
	thrHigh := fmt.Sprintf("%.0f", s.cfg.Fraud.STRThreshold)
	thrElevated := "1000000"

	rules := []models.RuleResponse{
		{Name: "high_amount", Threshold: &thrHigh, Impact: 35},
		{Name: "elevated_amount", Threshold: &thrElevated, Impact: 15},
		{Name: "unusual_time", Impact: 20},
		{Name: "unknown_device", Impact: 15},
		{Name: "velocity_breach", Threshold: stringPtr(fmt.Sprintf("%d txn/hour", s.cfg.Fraud.VelocityThreshold)), Impact: 25},
		{Name: "geo_impossible", Threshold: stringPtr("2 states in 30min"), Impact: 30},
	}

	writeJSON(w, http.StatusOK, models.RulesResponse{Rules: rules})
}

// StatsHandler returns real-time metrics from the database.
func (s *Service) StatsHandler(w http.ResponseWriter, r *http.Request) {
	stats, err := s.store.GetStats(r.Context())
	if err != nil {
		s.logger.Error("query stats", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "unable to retrieve statistics")
		return
	}

	writeJSON(w, http.StatusOK, models.StatsResponse{FraudStats: stats})
}

// BlockAccountHandler blocks or unblocks an account in Redis.
func (s *Service) BlockAccountHandler(w http.ResponseWriter, r *http.Request) {
	accountID := chi.URLParam(r, "accountID")
	if accountID == "" {
		writeError(w, http.StatusBadRequest, "account_id is required")
		return
	}

	var req models.BlockAccountRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// If no body, unblock the account by deleting the block key
		s.cache.UnblockAccount(r.Context(), accountID)
		writeJSON(w, http.StatusOK, models.APIResponse{
			Success: true,
			Data:    models.BlockAccountResponse{AccountID: accountID, Blocked: false, Reason: "unblocked"},
		})
		return
	}

	// Block the account
	ttl := s.cfg.Fraud.BlockTTL
	if req.Duration != nil && *req.Duration != "" {
		if d, err := time.ParseDuration(*req.Duration); err == nil {
			ttl = d
		}
	}

	if err := s.cache.SetBlockedAccount(r.Context(), accountID, ttl); err != nil {
		s.logger.Error("block account", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "unable to block account")
		return
	}

	s.logger.Info("account blocked", zap.String("account_id", accountID), zap.Stringer("ttl", ttl))
	writeJSON(w, http.StatusOK, models.APIResponse{
		Success: true,
		Data: models.BlockAccountResponse{
			AccountID: accountID,
			Blocked:   true,
			Reason:    req.Reason,
		},
	})
}

// calculateScore runs the core scoring rules and returns (score, rules).
func (s *Service) calculateScore(amount float64, hourOfDay int, deviceID string) (float64, []models.Rule) {
	score := 10.0
	rules := []models.Rule{}

	// Amount anomaly
	if amount > s.cfg.Fraud.STRThreshold {
		score += 35
		rules = append(rules, models.Rule{
			Name:   "high_amount",
			Impact: 35,
			Detail: fmt.Sprintf("Transaction exceeds %.0f STR threshold", s.cfg.Fraud.STRThreshold),
		})
	} else if amount > 1000000 {
		score += 15
		rules = append(rules, models.Rule{
			Name:   "elevated_amount",
			Impact: 15,
			Detail: "Transaction > 1M",
		})
	}

	// Time pattern (2-5 AM = suspicious)
	if hourOfDay >= 2 && hourOfDay <= 5 {
		score += 20
		rules = append(rules, models.Rule{
			Name:   "unusual_time",
			Impact: 20,
			Detail: "Transaction during 2-5 AM",
		})
	}

	// New device
	if deviceID == "" || deviceID == "unknown" || deviceID == "none" {
		score += 15
		rules = append(rules, models.Rule{
			Name:   "unknown_device",
			Impact: 15,
			Detail: "Unrecognized device fingerprint",
		})
	}

	return score, rules
}

// Ping checks DB connectivity.
func (s *Service) Ping(ctx context.Context) error {
	return s.store.Ping(ctx)
}

// PingRedis checks Redis connectivity.
func (s *Service) PingRedis(ctx context.Context) error {
	return s.cache.Ping(ctx)
}

// stringPtr returns a pointer to the given string.
func stringPtr(s string) *string {
	return &s
}
