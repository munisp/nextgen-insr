package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"go.uber.org/zap"

	"github.com/insureportal/premium-finance-service/config"
	"github.com/insureportal/premium-finance-service/db"
	"github.com/insureportal/premium-finance-service/models"
)

// Server holds all dependencies
type Server struct {
	Config   *config.Config
	Postgres *db.Postgres
	Redis    *db.RedisCache
	Logger   *zap.SugaredLogger
	ready    atomic.Bool
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
	sugar.Infof("Connected to PostgreSQL and migrations applied")

	srv.Redis, err = db.NewRedisCache(ctx, &cfg.Redis)
	if err != nil {
		sugar.Fatalf("Failed to connect to Redis: %v", err)
	}
	sugar.Infof("Connected to Redis")

	srv.ready.Store(true)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
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
		r.Post("/api/v1/finance/apply", srv.handleApply)
		r.Get("/api/v1/finance/applications", srv.handleListApplications)
		r.Get("/api/v1/finance/applications/{id}", srv.handleGetApplication)
		r.Patch("/api/v1/finance/applications/{id}/status", srv.handleUpdateApplicationStatus)
		r.Post("/api/v1/finance/calculate", srv.handleCalculate)
		r.Get("/api/v1/finance/schedule/{loanId}", srv.handleGetSchedule)
		r.Post("/api/v1/finance/credit-score", srv.handleCreditScore)
		r.Get("/api/v1/finance/credit-profile/{customerId}", srv.handleGetCreditProfile)
		r.Post("/api/v1/finance/collateral", srv.handleAddCollateral)
		r.Get("/api/v1/finance/collateral/{loanId}", srv.handleGetCollateral)
		r.Post("/api/v1/finance/collection", srv.handleCollectionAction)
		r.Get("/api/v1/finance/collection/overdue", srv.handleGetOverdue)
		r.Post("/api/v1/finance/early-settlement", srv.handleEarlySettlement)
		r.Get("/api/v1/finance/summary", srv.handleSummary)
	})

	httpServer := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		sugar.Infof("Premium Finance Service listening on %s", httpServer.Addr)
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
		"service":  "premium-finance-service",
		"status":   "healthy",
		"version":  "1.0.0",
		"uptime":   time.Since(time.Now().UTC().Truncate(time.Second)).String(),
		"requests": s.reqCount.Load(),
	}})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	resp := map[string]interface{}{"service": "premium-finance-service", "status": "ready", "checks": checks}
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

// handleCalculate calculates installment payments
func (s *Server) handleCalculate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Premium    float64 `json:"premium"`
		Months     int     `json:"months"`
		LoyalYears int     `json:"loyal_years"`
		Frequency  string  `json:"frequency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Premium < s.Config.Finance.MinPremiumAmount {
		writeError(w, fmt.Sprintf("premium must be at least ₦%.2f", s.Config.Finance.MinPremiumAmount), http.StatusBadRequest)
		return
	}
	if req.Months <= 0 || req.Months > s.Config.Finance.MaxInstallmentMonths {
		writeError(w, fmt.Sprintf("months must be between 1 and %d", s.Config.Finance.MaxInstallmentMonths), http.StatusBadRequest)
		return
	}

	rate := s.Config.Finance.DefaultInterestRate
	if req.LoyalYears >= s.Config.Finance.LoyalCustomerThreshold {
		rate = s.Config.Finance.LoyalCustomerRate
	}

	totalInterest := req.Premium * rate * float64(req.Months)
	total := req.Premium + totalInterest
	monthly := math.Ceil(total / float64(req.Months))

	_, _ = s.Redis.IncrementStatsAtomically(r.Context(), "calculations", 1)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"premium":                 req.Premium,
		"months":                  req.Months,
		"interest_rate":           rate,
		"monthly_rate":            fmt.Sprintf("%.4f%%", rate*100),
		"total_interest":          totalInterest,
		"total_payable":           total,
		"monthly_installment":     monthly,
		"loyal_discount":          req.LoyalYears >= s.Config.Finance.LoyalCustomerThreshold,
		"early_settlement_rebate": fmt.Sprintf("%.0f%% of remaining interest", s.Config.Finance.EarlySettlementRebate*100),
		"late_fee_percent":        s.Config.Finance.LateFeePercent * 100,
	}})
}

// handleApply creates a finance application
func (s *Server) handleApply(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID   string  `json:"policy_id"`
		CustomerID string  `json:"customer_id"`
		Premium    float64 `json:"premium"`
		Months     int     `json:"months"`
		Frequency  string  `json:"frequency"`
		LoyalYears int     `json:"loyal_years"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.PolicyID == "" || req.CustomerID == "" || req.Premium <= 0 || req.Months <= 0 {
		writeError(w, "policy_id, customer_id, premium, and months are required", http.StatusBadRequest)
		return
	}
	if req.Premium < s.Config.Finance.MinPremiumAmount {
		writeError(w, fmt.Sprintf("premium must be at least ₦%.2f", s.Config.Finance.MinPremiumAmount), http.StatusBadRequest)
		return
	}

	if req.Frequency == "" {
		req.Frequency = "monthly"
	}
	if req.LoyalYears == 0 {
		req.LoyalYears = 0
	}

	rate := s.Config.Finance.DefaultInterestRate
	if req.LoyalYears >= s.Config.Finance.LoyalCustomerThreshold {
		rate = s.Config.Finance.LoyalCustomerRate
	}

	totalInterest := req.Premium * rate * float64(req.Months)
	totalPayable := req.Premium + totalInterest
	monthlyPayment := math.Ceil(totalPayable / float64(req.Months))

	// Generate schedule entries
	scheduleEntries := make([]*db.ScheduleEntryDB, req.Months)
	for i := 0; i < req.Months; i++ {
		scheduleEntries[i] = &db.ScheduleEntryDB{
			ID:                fmt.Sprintf("sched_%d_%d", time.Now().UnixNano(), i),
			InstallmentNumber: i + 1,
			DueDate:           time.Now().AddDate(0, i+1, 0).Format("2006-01-02"),
			Amount:            monthlyPayment,
			Status:            string(models.InstPending),
		}
	}

	appID := fmt.Sprintf("PF-%d", time.Now().UnixNano())
	app := &db.ApplicationDB{
		ID:             fmt.Sprintf("app_%d", time.Now().UnixNano()),
		ApplicationID:  appID,
		PolicyID:       req.PolicyID,
		CustomerID:     req.CustomerID,
		PremiumAmount:  req.Premium,
		Currency:       "NGN",
		TermMonths:     req.Months,
		Frequency:      req.Frequency,
		Status:         string(models.LoanStatusSubmitted),
		InterestRate:   rate,
		TotalPayable:   totalPayable,
		MonthlyPayment: monthlyPayment,
	}

	if err := s.Postgres.InsertApplication(r.Context(), app); err != nil {
		s.Logger.Errorf("Failed to insert application: %v", err)
		writeError(w, "failed to create application", http.StatusInternalServerError)
		return
	}

	// Generate payment schedule
	if err := s.Postgres.GeneratePaymentSchedule(r.Context(), app.ID, scheduleEntries); err != nil {
		s.Logger.Errorf("Failed to generate schedule: %v", err)
	}

	// Publish event
	_ = s.Redis.PublishFinanceEvent(r.Context(), map[string]interface{}{
		"event":          "finance.application_submitted",
		"application_id": appID,
		"policy_id":      req.PolicyID,
		"amount":         req.Premium,
		"term_months":    req.Months,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"application_id":  appID,
			"policy_id":       req.PolicyID,
			"customer_id":     req.CustomerID,
			"premium":         req.Premium,
			"term_months":     req.Months,
			"frequency":       req.Frequency,
			"interest_rate":   rate,
			"total_payable":   totalPayable,
			"monthly_payment": monthlyPayment,
			"status":          "submitted",
			"schedule":        scheduleEntries,
			"next_due_date":   scheduleEntries[0].DueDate,
		},
	})
}

// handleListApplications retrieves finance applications with pagination
func (s *Server) handleListApplications(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
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

	applications, err := s.Postgres.ListApplications(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, "failed to retrieve applications", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"applications": applications,
		"total":        len(applications),
		"limit":        limit,
		"offset":       offset,
	}})
}

// handleGetApplication retrieves a finance application by ID
func (s *Server) handleGetApplication(w http.ResponseWriter, r *http.Request) {
	appID := chi.URLParam(r, "id")

	if cached, err := s.Redis.GetCachedApplication(r.Context(), appID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	app, err := s.Postgres.GetApplication(r.Context(), appID)
	if err != nil {
		writeError(w, "application not found", http.StatusNotFound)
		return
	}

	data, _ := json.Marshal(app)
	_ = s.Redis.CacheApplication(r.Context(), appID, data, db.TCacheMedium)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: app})
}

// handleUpdateApplicationStatus updates the status of a finance application
func (s *Server) handleUpdateApplicationStatus(w http.ResponseWriter, r *http.Request) {
	appID := chi.URLParam(r, "id")

	var req struct {
		Status string `json:"status"`
		Reason string `json:"reason,omitempty"`
		By     string `json:"approved_by,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	app, err := s.Postgres.GetApplication(r.Context(), appID)
	if err != nil {
		writeError(w, "application not found", http.StatusNotFound)
		return
	}

	now := time.Now()
	nowStr := now.Format(time.RFC3339)
	if err := s.Postgres.UpdateApplicationStatus(r.Context(), appID, req.Status); err != nil {
		writeError(w, "failed to update status", http.StatusInternalServerError)
		return
	}

	// Handle status-specific side effects
	if req.Status == string(models.LoanStatusApproved) {
		app.ApprovedBy = req.By
		app.ApprovedAt = &nowStr
	} else if req.Status == string(models.LoanStatusRejected) {
		app.RejectionReason = req.Reason
		app.RejectedAt = &nowStr
	} else if req.Status == string(models.LoanStatusSuspended) {
		_ = s.Redis.PublishFinanceEvent(r.Context(), map[string]interface{}{
			"event":   "finance.policy_suspended",
			"loan_id": appID,
			"reason":  req.Reason,
		})
	} else if req.Status == string(models.LoanStatusTerminated) {
		_ = s.Redis.PublishFinanceEvent(r.Context(), map[string]interface{}{
			"event":   "finance.policy_terminated",
			"loan_id": appID,
		})
	}

	_ = s.Redis.InvalidateApplication(r.Context(), appID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"application_id":  appID,
		"previous_status": app.Status,
		"new_status":      req.Status,
		"updated_at":      now.Format(time.RFC3339),
	}})
}

// handleGetSchedule retrieves the payment schedule for a loan
func (s *Server) handleGetSchedule(w http.ResponseWriter, r *http.Request) {
	loanID := chi.URLParam(r, "loanId")

	if cached, err := s.Redis.GetCachedPaymentSchedule(r.Context(), loanID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	entries, err := s.Postgres.GetPaymentSchedule(r.Context(), loanID)
	if err != nil {
		writeError(w, "schedule not found", http.StatusNotFound)
		return
	}

	data, _ := json.Marshal(entries)
	_ = s.Redis.CachePaymentSchedule(r.Context(), loanID, data, db.TCacheMedium)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: entries})
}

// handleCreditScore triggers a credit score calculation
func (s *Server) handleCreditScore(w http.ResponseWriter, r *http.Request) {
	var req struct {
		CustomerID       string  `json:"customer_id"`
		PaymentHistory   float64 `json:"payment_history"`
		ClaimsRatio      float64 `json:"claims_ratio"`
		TenureYears      int     `json:"tenure_years"`
		ActivePolicies   int     `json:"active_policies"`
		DefaultHistory   int     `json:"default_history"`
		IncomeEstimate   float64 `json:"income_estimate"`
		EmploymentStatus string  `json:"employment_status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.CustomerID == "" {
		writeError(w, "customer_id is required", http.StatusBadRequest)
		return
	}

	// Calculate credit score (simplified scoring model)
	score := 300 // base score
	score += int(req.PaymentHistory * 150)
	score -= req.DefaultHistory * 50
	if req.ClaimsRatio < 0.2 {
		score += 50
	} else if req.ClaimsRatio < 0.5 {
		score += 25
	} else {
		score -= 25
	}
	score += req.TenureYears * 10
	score += req.ActivePolicies * 5
	if req.IncomeEstimate > 1000000 {
		score += 50
	}
	if score > 850 {
		score = 850
	}

	// Determine rating
	rating := string(models.CreditVeryPoor)
	if score >= 750 {
		rating = string(models.CreditExcellent)
	} else if score >= 650 {
		rating = string(models.CreditGood)
	} else if score >= 550 {
		rating = string(models.CreditFair)
	} else if score >= 450 {
		rating = string(models.CreditPoor)
	}

	// Determine max financed amount and rate
	maxFinanced := 500000.0
	if score >= 700 {
		maxFinanced = 5000000.0
	} else if score >= 600 {
		maxFinanced = 2000000.0
	} else if score >= 500 {
		maxFinanced = 1000000.0
	}

	recommendedRate := s.Config.Finance.DefaultInterestRate
	if score >= 700 {
		recommendedRate = s.Config.Finance.LoyalCustomerRate
	}

	profile := &db.CreditProfileDB{
		ID:               fmt.Sprintf("cred_%d", time.Now().UnixNano()),
		CustomerID:       req.CustomerID,
		CreditScore:      score,
		ScoreDate:        time.Now().Format(time.RFC3339),
		PaymentHistory:   req.PaymentHistory,
		ClaimsRatio:      req.ClaimsRatio,
		TenureYears:      req.TenureYears,
		ActivePolicies:   req.ActivePolicies,
		DefaultHistory:   req.DefaultHistory,
		IncomeEstimate:   req.IncomeEstimate,
		EmploymentStatus: req.EmploymentStatus,
		Rating:           rating,
		Recommendation:   fmt.Sprintf("approved_with_score_%d", score),
		MaxFinanced:      maxFinanced,
		RecommendedRate:  recommendedRate,
	}

	if err := s.Postgres.UpsertCreditProfile(r.Context(), profile); err != nil {
		s.Logger.Errorf("Failed to save credit profile: %v", err)
	}

	data, _ := json.Marshal(profile)
	_ = s.Redis.CacheCreditProfile(r.Context(), req.CustomerID, data, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"customer_id":               req.CustomerID,
		"credit_score":              score,
		"credit_rating":             rating,
		"max_financed_amount":       maxFinanced,
		"recommended_interest_rate": recommendedRate,
		"recommendation":            profile.Recommendation,
		"scored_at":                 time.Now().Format(time.RFC3339),
	}})
}

// handleGetCreditProfile retrieves a customer's credit profile
func (s *Server) handleGetCreditProfile(w http.ResponseWriter, r *http.Request) {
	customerID := chi.URLParam(r, "customerId")

	if cached, err := s.Redis.GetCachedCreditProfile(r.Context(), customerID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	profile, err := s.Postgres.GetCreditProfile(r.Context(), customerID)
	if err != nil {
		writeError(w, "credit profile not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: profile})
}

// handleAddCollateral adds collateral for a loan
func (s *Server) handleAddCollateral(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LoanID   string  `json:"loan_id"`
		Type     string  `json:"type"`
		Details  string  `json:"details"`
		Value    float64 `json:"value"`
		Currency string  `json:"currency"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.LoanID == "" || req.Type == "" || req.Details == "" || req.Value <= 0 {
		writeError(w, "loan_id, type, details, and value are required", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}

	collateral := &db.CollateralDB{
		ID:       fmt.Sprintf("coll_%d", time.Now().UnixNano()),
		LoanID:   req.LoanID,
		Type:     req.Type,
		Details:  req.Details,
		Value:    req.Value,
		Currency: req.Currency,
		Status:   "pending_verification",
		Metadata: "{}",
	}

	if err := s.Postgres.InsertCollateral(r.Context(), collateral); err != nil {
		s.Logger.Errorf("Failed to add collateral: %v", err)
		writeError(w, "failed to add collateral", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"collateral_id": collateral.ID,
		"loan_id":       req.LoanID,
		"type":          req.Type,
		"value":         req.Value,
		"status":        "pending_verification",
	}})
}

// handleGetCollateral retrieves collateral for a loan
func (s *Server) handleGetCollateral(w http.ResponseWriter, r *http.Request) {
	loanID := chi.URLParam(r, "loanId")

	if cached, err := s.Redis.GetCachedCollateral(r.Context(), loanID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	collateral, err := s.Postgres.GetCollateral(r.Context(), loanID)
	if err != nil {
		writeError(w, "collateral not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: collateral})
}

// handleCollectionAction creates a collection action for an overdue account
func (s *Server) handleCollectionAction(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LoanID     string `json:"loan_id"`
		CustomerID string `json:"customer_id"`
		ActionType string `json:"action_type"`
		Notes      string `json:"notes"`
		Scheduled  string `json:"scheduled_at,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.LoanID == "" || req.CustomerID == "" || req.ActionType == "" {
		writeError(w, "loan_id, customer_id, and action_type are required", http.StatusBadRequest)
		return
	}

	scheduledTime := time.Now().Add(24 * time.Hour).Format(time.RFC3339)
	if req.Scheduled != "" {
		scheduledTime = req.Scheduled
	}

	action := &db.CollectionActionDB{
		ID:          fmt.Sprintf("coll_action_%d", time.Now().UnixNano()),
		LoanID:      req.LoanID,
		CustomerID:  req.CustomerID,
		ActionType:  req.ActionType,
		Status:      "scheduled",
		ScheduledAt: &scheduledTime,
		Notes:       req.Notes,
		Metadata:    "{}",
	}

	if err := s.Postgres.InsertCollectionAction(r.Context(), action); err != nil {
		s.Logger.Errorf("Failed to create collection action: %v", err)
		writeError(w, "failed to create collection action", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"action_id":    action.ID,
		"loan_id":      req.LoanID,
		"customer_id":  req.CustomerID,
		"action_type":  req.ActionType,
		"status":       "scheduled",
		"scheduled_at": scheduledTime,
	}})
}

// handleGetOverdue retrieves overdue loans with collection recommendations
func (s *Server) handleGetOverdue(w http.ResponseWriter, r *http.Request) {
	applications, err := s.Postgres.ListApplications(r.Context(), string(models.LoanStatusActive), 100, 0)
	if err != nil {
		writeError(w, "failed to retrieve active loans", http.StatusInternalServerError)
		return
	}

	overdueLoans := make([]interface{}, 0)
	for _, app := range applications {
		schedule, _ := s.Postgres.GetPaymentSchedule(r.Context(), app.ID)
		for _, entry := range schedule {
			if entry.Status == string(models.InstPending) || entry.Status == string(models.InstOverdue) {
				dueDate, _ := time.Parse("2006-01-02", entry.DueDate)
				if time.Now().After(dueDate) {
					overdueLoans = append(overdueLoans, map[string]interface{}{
						"loan_id":            app.ID,
						"application_id":     app.ApplicationID,
						"customer_id":        app.CustomerID,
						"installment_no":     entry.InstallmentNumber,
						"due_date":           entry.DueDate,
						"amount":             entry.Amount,
						"days_overdue":       int(time.Since(dueDate).Hours() / 24),
						"recommended_action": string(models.ActionSMS),
					})
				}
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"total_overdue": len(overdueLoans),
		"loans":         overdueLoans,
	}})
}

// handleEarlySettlement processes an early settlement request
func (s *Server) handleEarlySettlement(w http.ResponseWriter, r *http.Request) {
	var req struct {
		LoanID string `json:"loan_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.LoanID == "" {
		writeError(w, "loan_id is required", http.StatusBadRequest)
		return
	}

	app, err := s.Postgres.GetApplication(r.Context(), req.LoanID)
	if err != nil {
		writeError(w, "loan not found", http.StatusNotFound)
		return
	}

	schedule, err := s.Postgres.GetPaymentSchedule(r.Context(), req.LoanID)
	if err != nil {
		writeError(w, "failed to get schedule", http.StatusInternalServerError)
		return
	}

	// Calculate remaining balance and interest
	var remainingBalance, remainingInterest float64
	paidInstallments := 0
	totalInstallments := len(schedule)

	for _, entry := range schedule {
		if entry.Status == string(models.InstPaid) {
			paidInstallments++
		} else {
			remainingBalance += entry.Amount
		}
	}

	remainingInterest = app.TotalPayable - app.PremiumAmount
	remainingInterest = remainingInterest * float64(totalInstallments-paidInstallments) / float64(totalInstallments)

	rebateAmount := remainingInterest * s.Config.Finance.EarlySettlementRebate
	totalPayable := remainingBalance - rebateAmount

	settlement := &db.EarlySettlementDB{
		ID:                fmt.Sprintf("es_%d", time.Now().UnixNano()),
		LoanID:            req.LoanID,
		RequestedAt:       time.Now().Format(time.RFC3339),
		RemainingBalance:  remainingBalance,
		RemainingInterest: remainingInterest,
		RebateAmount:      rebateAmount,
		RebatePercent:     s.Config.Finance.EarlySettlementRebate,
		TotalPayable:      totalPayable,
		Status:            "requested",
	}

	if err := s.Postgres.InsertEarlySettlement(r.Context(), settlement); err != nil {
		s.Logger.Errorf("Failed to create early settlement: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"settlement_id":       settlement.ID,
		"loan_id":             req.LoanID,
		"remaining_balance":   remainingBalance,
		"remaining_interest":  remainingInterest,
		"rebate_amount":       rebateAmount,
		"rebate_percent":      s.Config.Finance.EarlySettlementRebate * 100,
		"total_payable_now":   totalPayable,
		"status":              "pending_approval",
		"early_savings":       rebateAmount,
		"policy_upon_payment": string(models.LoanStatusPaidOff),
	}})
}

// handleSummary retrieves aggregated financing summary
func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	if cached, err := s.Redis.GetCachedLoanSummary(r.Context()); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	apps, err := s.Postgres.ListApplications(r.Context(), "", 1000, 0)
	if err != nil {
		writeError(w, "failed to retrieve summary", http.StatusInternalServerError)
		return
	}

	var totalApp int64
	var approvedApp int64
	var activeLoans int64
	var totalOrigination, totalReceivable, totalCollected float64
	var overdueAmount float64
	var totalCreditScore int

	for _, app := range apps {
		totalApp++
		schedule, _ := s.Postgres.GetPaymentSchedule(r.Context(), app.ID)

		for _, entry := range schedule {
			if entry.Status == string(models.InstPaid) {
				totalCollected += entry.PaidAmount
			} else {
				totalReceivable += entry.Amount - entry.PaidAmount
			}
			if entry.Status == string(models.InstOverdue) {
				dueDate, _ := time.Parse("2006-01-02", entry.DueDate)
				if time.Now().After(dueDate) {
					overdueAmount += entry.Amount
				}
			}
		}

		switch app.Status {
		case string(models.LoanStatusApproved):
			approvedApp++
		case string(models.LoanStatusActive):
			activeLoans++
		}

		totalOrigination += app.PremiumAmount
		if app.CreditScore > 0 {
			totalCreditScore += app.CreditScore
		}
	}

	summary := map[string]interface{}{
		"total_applications":    totalApp,
		"approved_applications": approvedApp,
		"active_loans":          activeLoans,
		"total_origination":     totalOrigination,
		"total_receivable":      totalReceivable,
		"total_collected":       totalCollected,
		"overdue_amount":        overdueAmount,
		"avg_credit_score":      totalCreditScore / int(totalApp),
		"updated_at":            time.Now().UTC().Format(time.RFC3339),
	}

	data, _ := json.Marshal(summary)
	_ = s.Redis.CacheLoanSummary(r.Context(), data, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: summary})
}

// validateQueryParam extracts a query parameter, enforcing a maximum length.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	v := r.URL.Query().Get(key)
	if len(v) > maxLen {
		return "", fmt.Errorf("query parameter %q exceeds maximum length of %d", key, maxLen)
	}
	return v, nil
}

// validateIntParam extracts an integer query parameter. An absent parameter
// yields 0 with no error.
func validateIntParam(r *http.Request, key string) (int, error) {
	s := r.URL.Query().Get(key)
	if s == "" {
		return 0, nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("query parameter %q must be an integer", key)
	}
	return v, nil
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(Response{Success: false, Error: msg})
}
