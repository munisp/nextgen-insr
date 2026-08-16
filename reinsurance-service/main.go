package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"reinsurance-service/config"
	"reinsurance-service/db"
	"reinsurance-service/models"
)

type Server struct {
	Config   *config.Config
	Postgres *db.Postgres
	Redis    *db.RedisCache
	Logger   *zap.SugaredLogger
	reqCount atomic.Int64
}

type Response struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

func main() {
	cfg := config.NewConfig()
	logger, _ := zap.NewProduction()
	defer logger.Sync()
	sugar := logger.Sugar()

	srv := &Server{Config: cfg, Logger: sugar}
	ctx := context.Background()

	var err error
	srv.Postgres, err = db.NewPostgres(ctx, &cfg.Postgres)
	if err != nil {
		sugar.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	if err := srv.Postgres.RunMigrations(ctx); err != nil {
		sugar.Fatalf("Failed to run migrations: %v", err)
	}

	srv.Redis, err = db.NewRedisCache(ctx, &cfg.Redis)
	if err != nil {
		sugar.Fatalf("Failed to connect to Redis: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID, middleware.RealIP, middleware.Logger, middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins: cfg.CORS.AllowedOrigins,
		AllowedMethods: cfg.CORS.AllowedMethods,
		AllowedHeaders: cfg.CORS.AllowedHeaders,
		MaxAge:         int(cfg.CORS.MaxAge.Seconds()),
	}))
	r.Use(srv.instrumentMiddleware)

	r.Get("/health", srv.handleHealth)
	r.Get("/ready", srv.handleReadiness)

	r.Group(func(r chi.Router) {
		r.Post("/api/v1/treaties", srv.handleCreateTreaty)
		r.Get("/api/v1/treaties", srv.handleListTreaties)
		r.Get("/api/v1/treaties/{id}", srv.handleGetTreaty)
		r.Patch("/api/v1/treaties/{id}", srv.handleUpdateTreaty)
		r.Delete("/api/v1/treaties/{id}", srv.handleDeleteTreaty)
		r.Post("/api/v1/ceded", srv.handleCedeRisk)
		r.Get("/api/v1/ceded/{cessionId}", srv.handleGetCession)
		r.Patch("/api/v1/ceded/{cessionId}/accept", srv.handleAcceptCession)
		r.Patch("/api/v1/ceded/{cessionId}/reject", srv.handleRejectCession)
		r.Post("/api/v1/recoveries", srv.handleCalculateRecovery)
		r.Get("/api/v1/recoveries/{cessionId}", srv.handleGetRecovery)
		r.Post("/api/v1/commissions", srv.handleCalculateCommission)
		r.Get("/api/v1/commissions/{treatyId}", srv.handleGetCommission)
		r.Post("/api/v1/quota-share/calculate", srv.handleQuotaShareCalc)
		r.Post("/api/v1/excess-of-loss/calculate", srv.handleExcessOfLossCalc)
		r.Post("/api/v1/surplus/calculate", srv.handleSurplusCalc)
		r.Get("/api/v1/summary/{treatyId}", srv.handleTreatySummary)
		r.Get("/api/v1/summary", srv.handleAllSummaries)
	})

	httpServer := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		sugar.Infof("Reinsurance Service listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	sugar.Infof("Shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownGrace)
	defer cancel()
	httpServer.Shutdown(shutdownCtx)
	srv.Redis.Close()
	srv.Postgres.Close()
	sugar.Infof("Server exited")
}

func (s *Server) instrumentMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.reqCount.Add(1)
		next.ServeHTTP(w, r)
		s.Logger.Infow("request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds(), "total", s.reqCount.Load())
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"service": "reinsurance-service", "status": "healthy", "version": "1.0.0",
		"requests": s.reqCount.Load(),
	}})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	resp := map[string]interface{}{"service": "reinsurance-service", "status": "ready", "checks": checks}
	statusCode := http.StatusOK
	if err := s.Postgres.Pool.Ping(r.Context()); err != nil {
		resp["status"] = "not_ready"
		checks["database"] = fmt.Sprintf("unavailable: %s", err.Error())
		statusCode = http.StatusServiceUnavailable
	} else {
		checks["database"] = "ok"
	}
	if err := s.Redis.Client.Ping(r.Context()).Err(); err != nil {
		resp["status"] = "not_ready"
		checks["redis"] = fmt.Sprintf("unavailable: %s", err.Error())
		statusCode = http.StatusServiceUnavailable
	} else {
		checks["redis"] = "ok"
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(resp)
}

// handleCreateTreaty creates a new reinsurance treaty
func (s *Server) handleCreateTreaty(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name           string  `json:"name"`
		Type           string  `json:"type"`
		Reinsurer      string  `json:"reinsurer"`
		EffectiveDate  string  `json:"effective_date"`
		ExpiryDate     string  `json:"expiry_date"`
		Period         string  `json:"period"`
		Retention      float64 `json:"retention"`
		Limit          float64 `json:"limit"`
		CessionRate    float64 `json:"cession_rate"`
		CommissionRate float64 `json:"commission_rate"`
		ClawbackRate   float64 `json:"clawback_rate"`
		Status         string  `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" || req.Type == "" || req.Reinsurer == "" {
		writeError(w, "name, type, and reinsurer are required", http.StatusBadRequest)
		return
	}

	if req.Period == "" {
		req.Period = s.Config.Reins.DefaultPeriod
	}
	if req.Status == "" {
		req.Status = string(models.TreatyDraft)
	}

	now := time.Now()
	treaty := &db.TreatyDB{
		ID:             fmt.Sprintf("treaty_%d", time.Now().UnixNano()),
		TreatyID:       fmt.Sprintf("TRY-%d", time.Now().UnixNano()%1000000),
		Name:           req.Name,
		Type:           req.Type,
		Reinsurer:      req.Reinsurer,
		EffectiveDate:  req.EffectiveDate,
		ExpiryDate:     req.ExpiryDate,
		Period:         req.Period,
		Retention:      req.Retention,
		Limit:          req.Limit,
		CessionRate:    req.CessionRate,
		PremiumShare:   req.CessionRate,
		CommissionRate: req.CommissionRate,
		ClawbackRate:   req.ClawbackRate,
		MinimumCeded:   0,
		Status:         req.Status,
		Currency:       s.Config.Reins.DefaultCurrency,
		Metadata:       "{}",
		CreatedAt:      now.Format(time.RFC3339),
		UpdatedAt:      now.Format(time.RFC3339),
	}

	if err := s.Postgres.InsertTreaty(r.Context(), treaty); err != nil {
		s.Logger.Errorf("Failed to create treaty: %v", err)
		writeError(w, "failed to create treaty", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.PublishEvent(r.Context(), "treaties", map[string]interface{}{
		"event":     "treaty.created",
		"treaty_id": treaty.TreatyID,
		"type":      req.Type,
		"reinsurer": req.Reinsurer,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"treaty_id":       treaty.TreatyID,
		"name":            req.Name,
		"type":            req.Type,
		"reinsurer":       req.Reinsurer,
		"retention":       req.Retention,
		"limit":           req.Limit,
		"cession_rate":    req.CessionRate,
		"commission_rate": req.CommissionRate,
		"clawback_rate":   req.ClawbackRate,
		"period":          req.Period,
		"status":          req.Status,
		"currency":        s.Config.Reins.DefaultCurrency,
		"created_at":      treaty.CreatedAt,
	}})
}

// handleListTreaties lists treaties with optional filtering
func (s *Server) handleListTreaties(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	treatyType := r.URL.Query().Get("type")
	limit := 20
	offset := 0
	if l := r.URL.Query().Get("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
		if limit > 100 {
			limit = 100
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}

	treaties, err := s.Postgres.ListTreaties(r.Context(), status, treatyType, limit, offset)
	if err != nil {
		writeError(w, "failed to retrieve treaties", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"treaties": treaties, "total": len(treaties), "limit": limit, "offset": offset,
	}})
}

// handleGetTreaty retrieves a treaty by ID
func (s *Server) handleGetTreaty(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if cached, err := s.Redis.GetCachedTreaty(r.Context(), id); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	treaty, err := s.Postgres.GetTreaty(r.Context(), id)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	data, _ := json.Marshal(treaty)
	_ = s.Redis.CacheTreaty(r.Context(), id, data, db.TCacheMedium)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: treaty})
}

// handleUpdateTreaty updates a treaty
func (s *Server) handleUpdateTreaty(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Status    string  `json:"status"`
		Retention float64 `json:"retention"`
		Limit     float64 `json:"limit"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	treaty, err := s.Postgres.GetTreaty(r.Context(), id)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	if req.Status != "" {
		if err := s.Postgres.UpdateTreatyStatus(r.Context(), id, req.Status); err != nil {
			writeError(w, "failed to update status", http.StatusInternalServerError)
			return
		}
	}

	_ = s.Redis.InvalidateTreaty(r.Context(), id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"treaty_id":  id,
		"previous":   treaty.Status,
		"new_status": req.Status,
		"updated_at": time.Now().Format(time.RFC3339),
	}})
}

// handleDeleteTreaty marks a treaty as terminated
func (s *Server) handleDeleteTreaty(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	_, err := s.Postgres.GetTreaty(r.Context(), id)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	if err := s.Postgres.UpdateTreatyStatus(r.Context(), id, string(models.TreatyTerminated)); err != nil {
		writeError(w, "failed to terminate treaty", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.InvalidateTreaty(r.Context(), id)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"treaty_id":     id,
		"status":        string(models.TreatyTerminated),
		"terminated_at": time.Now().Format(time.RFC3339),
	}})
}

// handleCedeRisk creates a cession of risk to reinsurer
func (s *Server) handleCedeRisk(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID    string  `json:"policy_id"`
		TreatyID    string  `json:"treaty_id"`
		GrossAmount float64 `json:"gross_amount"`
		RiskType    string  `json:"risk_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.PolicyID == "" || req.TreatyID == "" || req.GrossAmount <= 0 {
		writeError(w, "policy_id, treaty_id, and gross_amount are required", http.StatusBadRequest)
		return
	}

	// Get treaty details
	treaty, err := s.Postgres.GetTreaty(r.Context(), req.TreatyID)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	if treaty.Status != string(models.TreatyActive) && treaty.Status != string(models.TreatyPending) {
		writeError(w, "treaty is not active", http.StatusBadRequest)
		return
	}

	// Calculate retention and cession based on treaty type and amount
	var retention, ceded, cessionRate float64
	retention = treaty.Retention

	switch treaty.Type {
	case string(models.TreatyQuotaShare):
		// Quota share: proportional cession
		cessionRate = treaty.CessionRate
		ceded = req.GrossAmount * cessionRate
		retention = req.GrossAmount - ceded
	case string(models.TreatySurplus):
		// Surplus: up to retention + lines
		if req.GrossAmount <= retention {
			retention = req.GrossAmount
			ceded = 0
		} else {
			ceded = req.GrossAmount - retention
			if ceded > treaty.Limit {
				ceded = treaty.Limit
			}
		}
		if req.GrossAmount > 0 {
			cessionRate = ceded / req.GrossAmount
		}
	case string(models.TreatyXL), string(models.TreatyCatXL):
		// Excess of loss: retention up to attachment point
		attachment := treaty.Retention
		if req.GrossAmount <= attachment {
			retention = req.GrossAmount
			ceded = 0
		} else {
			retention = attachment
			ceded = req.GrossAmount - attachment
			if ceded > treaty.Limit {
				ceded = treaty.Limit
			}
		}
		if req.GrossAmount > 0 {
			cessionRate = ceded / req.GrossAmount
		}
	default:
		// Default: use treaty cession rate
		ceded = req.GrossAmount * treaty.CessionRate
		retention = req.GrossAmount - ceded
		cessionRate = treaty.CessionRate
	}

	cessionID := fmt.Sprintf("CES-%d", time.Now().UnixNano()%1000000)
	cession := &db.CessionDB{
		ID:          fmt.Sprintf("ces_%d", time.Now().UnixNano()),
		CessionID:   cessionID,
		TreatyID:    treaty.ID,
		PolicyID:    req.PolicyID,
		RiskType:    req.RiskType,
		GrossAmount: req.GrossAmount,
		Retention:   retention,
		CededAmount: ceded,
		CessionRate: cessionRate,
		Reinsurer:   treaty.Reinsurer,
		Type:        string(models.CessionAutomatic),
		Status:      string(models.CessionSubmitted),
		Metadata:    "{}",
		CreatedAt:   time.Now().Format(time.RFC3339),
		UpdatedAt:   time.Now().Format(time.RFC3339),
	}

	if err := s.Postgres.InsertCession(r.Context(), cession); err != nil {
		s.Logger.Errorf("Failed to create cession: %v", err)
		writeError(w, "failed to create cession", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.PublishEvent(r.Context(), "cessions", map[string]interface{}{
		"event":      "cession.created",
		"cession_id": cessionID,
		"treaty_id":  req.TreatyID,
		"policy_id":  req.PolicyID,
		"gross":      req.GrossAmount,
		"ceded":      ceded,
	})

	_, _ = s.Redis.IncrementStats(r.Context(), "total_ceded", int64(ceded))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"cession_id":   cessionID,
		"treaty_id":    req.TreatyID,
		"treaty_type":  treaty.Type,
		"policy_id":    req.PolicyID,
		"gross_amount": req.GrossAmount,
		"retention":    retention,
		"ceded_amount": ceded,
		"cession_rate": cessionRate,
		"reinsurer":    treaty.Reinsurer,
		"status":       string(models.CessionSubmitted),
		"auto_ceeded":  req.GrossAmount >= s.Config.Reins.AutoCedeThreshold,
	}})
}

// handleGetCession retrieves a cession
func (s *Server) handleGetCession(w http.ResponseWriter, r *http.Request) {
	cessionID := chi.URLParam(r, "cessionId")

	cession, err := s.Postgres.GetCession(r.Context(), cessionID)
	if err != nil {
		writeError(w, "cession not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: cession})
}

// handleAcceptCession accepts a submitted cession
func (s *Server) handleAcceptCession(w http.ResponseWriter, r *http.Request) {
	cessionID := chi.URLParam(r, "cessionId")

	cession, err := s.Postgres.GetCession(r.Context(), cessionID)
	if err != nil {
		writeError(w, "cession not found", http.StatusNotFound)
		return
	}

	if cession.Status != string(models.CessionSubmitted) {
		writeError(w, "cession is not in submitted status", http.StatusBadRequest)
		return
	}

	now := time.Now().Format(time.RFC3339)
	_, err = s.Postgres.Pool.Exec(r.Context(), `
		UPDATE cessions SET status = 'accepted', accepted_at = $1, updated_at = NOW()
		WHERE cession_id = $2
	`, now, cessionID)
	if err != nil {
		writeError(w, "failed to accept cession", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.PublishEvent(r.Context(), "cessions", map[string]interface{}{
		"event": "cession.accepted", "cession_id": cessionID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"cession_id":  cessionID,
		"previous":    cession.Status,
		"new_status":  "accepted",
		"accepted_at": now,
	}})
}

// handleRejectCession rejects a submitted cession
func (s *Server) handleRejectCession(w http.ResponseWriter, r *http.Request) {
	cessionID := chi.URLParam(r, "cessionId")

	var req struct {
		Reason string `json:"reason"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	cession, err := s.Postgres.GetCession(r.Context(), cessionID)
	if err != nil {
		writeError(w, "cession not found", http.StatusNotFound)
		return
	}

	if cession.Status != string(models.CessionSubmitted) {
		writeError(w, "cession is not in submitted status", http.StatusBadRequest)
		return
	}

	now := time.Now().Format(time.RFC3339)
	_, err = s.Postgres.Pool.Exec(r.Context(), `
		UPDATE cessions SET status = 'rejected', rejected_at = $1, reject_reason = $2, updated_at = NOW()
		WHERE cession_id = $3
	`, now, req.Reason, cessionID)
	if err != nil {
		writeError(w, "failed to reject cession", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"cession_id": cessionID, "previous": cession.Status, "new_status": "rejected",
		"rejected_at": now, "reason": req.Reason,
	}})
}

// handleCalculateRecovery calculates reinsurance recovery for a claim
func (s *Server) handleCalculateRecovery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CessionID   string  `json:"cession_id"`
		ClaimAmount float64 `json:"claim_amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.CessionID == "" || req.ClaimAmount <= 0 {
		writeError(w, "cession_id and claim_amount are required", http.StatusBadRequest)
		return
	}

	cession, err := s.Postgres.GetCession(r.Context(), req.CessionID)
	if err != nil {
		writeError(w, "cession not found", http.StatusNotFound)
		return
	}

	if cession.Status != string(models.CessionAccepted) {
		writeError(w, "cession must be accepted to calculate recovery", http.StatusBadRequest)
		return
	}

	// Get treaty for commission info
	treaty, err := s.Postgres.GetTreaty(r.Context(), cession.TreatyID)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	grossRecovery := req.ClaimAmount * cession.CessionRate
	commission := grossRecovery * treaty.CommissionRate
	clawback := commission * treaty.ClawbackRate
	netRecovery := grossRecovery - commission + clawback

	recovery := &db.RecoveryDB{
		ID:            fmt.Sprintf("rec_%d", time.Now().UnixNano()),
		CessionID:     req.CessionID,
		TreatyID:      treaty.ID,
		PolicyID:      cession.PolicyID,
		ClaimAmount:   req.ClaimAmount,
		GrossRecovery: grossRecovery,
		NetRecovery:   netRecovery,
		Commission:    commission,
		Clawback:      clawback,
		Status:        "calculated",
		CreatedAt:     time.Now().Format(time.RFC3339),
	}

	if err := s.Postgres.InsertRecovery(r.Context(), recovery); err != nil {
		s.Logger.Errorf("Failed to insert recovery: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"recovery_id":    recovery.ID,
		"cession_id":     req.CessionID,
		"claim_amount":   req.ClaimAmount,
		"gross_recovery": grossRecovery,
		"commission":     commission,
		"clawback":       clawback,
		"net_recovery":   netRecovery,
		"reinsurer":      treaty.Reinsurer,
		"status":         "calculated",
	}})
}

// handleGetRecovery retrieves a recovery calculation
func (s *Server) handleGetRecovery(w http.ResponseWriter, r *http.Request) {
	cessionID := chi.URLParam(r, "cessionId")

	// Query recoveries for this cession
	rows, err := s.Postgres.Pool.Query(r.Context(), `
		SELECT id, cession_id, treaty_id, policy_id, claim_amount, gross_recovery,
			net_recovery, commission, clawback, status, processed_at, created_at
		FROM recoveries WHERE cession_id = $1 ORDER BY created_at DESC LIMIT 1
	`, cessionID)
	if err != nil || !rows.Next() {
		writeError(w, "recovery not found", http.StatusNotFound)
		return
	}
	defer rows.Close()

	rdb := &db.RecoveryDB{}
	if err := rows.Scan(&rdb.ID, &rdb.CessionID, &rdb.TreatyID, &rdb.PolicyID,
		&rdb.ClaimAmount, &rdb.GrossRecovery, &rdb.NetRecovery, &rdb.Commission,
		&rdb.Clawback, &rdb.Status, &rdb.ProcessedAt, &rdb.CreatedAt); err != nil {
		writeError(w, "failed to scan recovery", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: rdb})
}

// handleCalculateCommission calculates commission for a treaty period
func (s *Server) handleCalculateCommission(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TreatyID     string  `json:"treaty_id"`
		Period       string  `json:"period"`
		CededPremium float64 `json:"ceded_premium"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.TreatyID == "" || req.Period == "" || req.CededPremium <= 0 {
		writeError(w, "treaty_id, period, and ceded_premium are required", http.StatusBadRequest)
		return
	}

	treaty, err := s.Postgres.GetTreaty(r.Context(), req.TreatyID)
	if err != nil {
		writeError(w, "treaty not found", http.StatusNotFound)
		return
	}

	grossCommission := req.CededPremium * treaty.CommissionRate
	clawbackAmount := grossCommission * treaty.ClawbackRate
	netCommission := grossCommission - clawbackAmount

	commission := &db.CommissionDB{
		ID:              fmt.Sprintf("comm_%d", time.Now().UnixNano()),
		TreatyID:        treaty.ID,
		Period:          req.Period,
		CededPremium:    req.CededPremium,
		GrossCommission: grossCommission,
		CommissionRate:  treaty.CommissionRate,
		ClawbackAmount:  clawbackAmount,
		NetCommission:   netCommission,
		PaidAmount:      0,
		Outstanding:     netCommission,
		Status:          "calculated",
		CreatedAt:       time.Now().Format(time.RFC3339),
	}

	if err := s.Postgres.InsertCommission(r.Context(), commission); err != nil {
		s.Logger.Errorf("Failed to create commission: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"commission_id":    commission.ID,
		"treaty_id":        req.TreatyID,
		"period":           req.Period,
		"ceded_premium":    req.CededPremium,
		"commission_rate":  treaty.CommissionRate * 100,
		"gross_commission": grossCommission,
		"clawback":         clawbackAmount,
		"net_commission":   netCommission,
		"outstanding":      netCommission,
		"status":           "calculated",
	}})
}

// handleGetCommission retrieves commission calculations for a treaty
func (s *Server) handleGetCommission(w http.ResponseWriter, r *http.Request) {
	treatyID := chi.URLParam(r, "treatyId")

	rows, err := s.Postgres.Pool.Query(r.Context(), `
		SELECT id, treaty_id, period, ceded_premium, gross_commission, commission_rate,
			clawback_amount, net_commission, paid_amount, outstanding, status, paid_at, created_at
		FROM commission_calculations WHERE treaty_id = $1 ORDER BY period DESC
	`, treatyID)
	if err != nil {
		writeError(w, "failed to retrieve commissions", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var commissions []*db.CommissionDB
	for rows.Next() {
		c := &db.CommissionDB{}
		if err := rows.Scan(&c.ID, &c.TreatyID, &c.Period, &c.CededPremium, &c.GrossCommission,
			&c.CommissionRate, &c.ClawbackAmount, &c.NetCommission, &c.PaidAmount, &c.Outstanding,
			&c.Status, &c.PaidAt, &c.CreatedAt); err != nil {
			writeError(w, "scan commission", http.StatusInternalServerError)
			return
		}
		commissions = append(commissions, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: commissions})
}

// handleQuotaShareCalc performs quota share calculation
func (s *Server) handleQuotaShareCalc(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GrossPremium     float64 `json:"gross_premium"`
		RetentionPercent float64 `json:"retention_percent"`
		CessionPercent   float64 `json:"cession_percent"`
		CommissionRate   float64 `json:"commission_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.GrossPremium <= 0 {
		writeError(w, "gross_premium must be positive", http.StatusBadRequest)
		return
	}

	retained := req.GrossPremium * req.RetentionPercent / 100
	ceded := req.GrossPremium * req.CessionPercent / 100
	commission := ceded * req.CommissionRate
	netPremium := req.GrossPremium - ceded + commission

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"gross_premium":      req.GrossPremium,
		"retention_percent":  req.RetentionPercent,
		"cession_percent":    req.CessionPercent,
		"retained_premium":   retained,
		"ceded_premium":      ceded,
		"commission":         commission,
		"net_premium":        netPremium,
		"reinsurer_share":    ceded,
		"retention_exposure": retained,
	}})
}

// handleExcessOfLossCalc performs excess of loss calculation
func (s *Server) handleExcessOfLossCalc(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GrossLoss      float64 `json:"gross_loss"`
		Attachment     float64 `json:"attachment"`
		Limit          float64 `json:"limit"`
		CommissionRate float64 `json:"commission_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	attachment := req.Attachment
	var reinsurerShare, retention float64
	exceeded := req.GrossLoss > attachment

	if exceeded {
		lossExcess := req.GrossLoss - attachment
		reinsurerShare = math.Min(lossExcess, req.Limit)
		retention = req.GrossLoss - reinsurerShare
	} else {
		retention = req.GrossLoss
		reinsurerShare = 0
	}

	commission := reinsurerShare * req.CommissionRate
	netLoss := retention - commission

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"gross_loss":          req.GrossLoss,
		"attachment":          attachment,
		"limit":               req.Limit,
		"reinsurer_share":     reinsurerShare,
		"retention":           retention,
		"commission":          commission,
		"net_loss":            netLoss,
		"exceeded_attachment": exceeded,
	}})
}

// handleSurplusCalc performs surplus treaty calculation
func (s *Server) handleSurplusCalc(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GrossSumInsured float64 `json:"gross_sum_insured"`
		LineValue       float64 `json:"line_value"`
		NumLines        int     `json:"num_lines"`
		CessionPercent  float64 `json:"cession_percent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	retention := req.LineValue
	maxCeded := float64(req.NumLines) * req.LineValue
	availableLines := float64(req.NumLines)
	ceded := 0.0

	if req.GrossSumInsured > retention {
		ceded = req.GrossSumInsured - retention
		if ceded > maxCeded {
			ceded = maxCeded
		}
		availableLines -= ceded / req.LineValue
		if availableLines < 0 {
			availableLines = 0
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"gross_sum_insured": req.GrossSumInsured,
		"retention":         retention,
		"ceded_amount":      ceded,
		"num_lines_used":    ceded / req.LineValue,
		"available_lines":   availableLines,
		"max_ceded":         maxCeded,
		"lines_capacity":    float64(req.NumLines),
	}})
}

// handleTreatySummary retrieves summary for a specific treaty
func (s *Server) handleTreatySummary(w http.ResponseWriter, r *http.Request) {
	treatyID := chi.URLParam(r, "treatyId")

	if cached, err := s.Redis.GetCachedSummary(r.Context(), treatyID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	summary, err := s.Postgres.GetTreatySummary(r.Context(), treatyID)
	if err != nil {
		writeError(w, "summary not found", http.StatusNotFound)
		return
	}

	data, _ := json.Marshal(summary)
	_ = s.Redis.CacheSummary(r.Context(), treatyID, data, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: summary})
}

// handleAllSummaries retrieves summaries for all active treaties
func (s *Server) handleAllSummaries(w http.ResponseWriter, r *http.Request) {
	rows, err := s.Postgres.Pool.Query(r.Context(), `
		SELECT id, treaty_id, name, type, reinsurer, status
		FROM treaties WHERE status IN ('active', 'pending')
		ORDER BY created_at DESC
	`)
	if err != nil {
		writeError(w, "failed to retrieve summaries", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	summaries := make([]map[string]interface{}, 0)
	for rows.Next() {
		var id, treatyID, name, tType, reinsurer, status string
		if err := rows.Scan(&id, &treatyID, &name, &tType, &reinsurer, &status); err != nil {
			continue
		}

		summary, _ := s.Postgres.GetTreatySummary(r.Context(), id)
		if summary != nil {
			summaries = append(summaries, map[string]interface{}{
				"treaty_id": treatyID, "name": name, "type": tType,
				"reinsurer": reinsurer, "status": status,
				"gross_written": summary.GrossWritten,
				"ceded_premium": summary.CededPremium,
				"net_exposed":   summary.NetExposed,
				"recoveries":    summary.Recoveries,
				"commission":    summary.CommissionEarned,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: summaries})
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(Response{Success: false, Error: msg})
}
