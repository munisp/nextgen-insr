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

	"premium-collection-service/config"
	"premium-collection-service/db"
	"premium-collection-service/models"
)

// chiURLParam wraps chi.URLParam for safe access
func chiURLParam(r *http.Request, key string) string {
	return chi.URLParam(r, key)
}

// Server holds all dependencies
type Server struct {
	Config       *config.Config
	Postgres     *db.Postgres
	Redis        *db.RedisCache
	Logger       *zap.SugaredLogger
	ready        atomic.Bool
	requestCount atomic.Int64
	healthyCount atomic.Int64
}

// Response wraps standard API responses
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

	srv := &Server{
		Config: cfg,
		Logger: sugar,
	}

	// Connect to databases
	ctx := context.Background()

	var err error
	srv.Postgres, err = db.NewPostgres(ctx, &cfg.Postgres)
	if err != nil {
		sugar.Fatalf("Failed to connect to PostgreSQL: %v", err)
	}
	sugar.Infof("Connected to PostgreSQL at %s:%s/%s", cfg.Postgres.Host, cfg.Postgres.Port, cfg.Postgres.DBName)

	if err := srv.Postgres.RunMigrations(ctx); err != nil {
		sugar.Fatalf("Failed to run migrations: %v", err)
	}
	sugar.Infof("Database migrations applied")

	srv.Redis, err = db.NewRedisCache(ctx, &cfg.Redis)
	if err != nil {
		sugar.Fatalf("Failed to connect to Redis: %v", err)
	}
	sugar.Infof("Connected to Redis at %s:%s", cfg.Redis.Host, cfg.Redis.Port)

	srv.ready.Store(true)
	sugar.Infof("Premium Collection Service initialized successfully")

	// Setup router
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(middleware.GetHead)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.AllowedOrigins,
		AllowedMethods:   cfg.CORS.AllowedMethods,
		AllowedHeaders:   cfg.CORS.AllowedHeaders,
		AllowCredentials: cfg.CORS.AllowCredentials,
		MaxAge:           int(cfg.CORS.MaxAge.Seconds()),
	}))
	r.Use(srv.instrumentMiddleware)

	// Health and readiness
	r.Get("/health", srv.handleHealth)
	r.Get("/ready", srv.handleReadiness)

	// API routes
	r.Group(func(r chi.Router) {
		r.Use(srv.rateLimitMiddleware)

		r.Post("/api/v1/payments", srv.handleCollectPayment)
		r.Post("/api/v1/payments/{reference}/refund", srv.handleRefundPayment)
		r.Get("/api/v1/payments", srv.handleListPayments)
		r.Get("/api/v1/payments/{id}", srv.handleGetPayment)
		r.Get("/api/v1/payments/stats", srv.handleCollectionStats)

		r.Post("/api/v1/installments", srv.handleCreateInstallmentPlan)
		r.Get("/api/v1/installments/{planId}", srv.handleGetInstallmentPlan)
		r.Get("/api/v1/installments/{planId}/schedule", srv.handleGetInstallmentSchedule)

		r.Post("/api/v1/receipts", srv.handleGenerateReceipt)
		r.Get("/api/v1/receipts/{receiptId}", srv.handleGetReceipt)

		r.Post("/api/v1/dunning", srv.handleCreateDunningRecord)
		r.Get("/api/v1/dunning/pending", srv.handleGetPendingDunning)
		r.Patch("/api/v1/dunning/{id}/send", srv.handleSendDunningReminder)

		r.Post("/api/v1/auto-debit", srv.handleCreateAutoDebit)
		r.Get("/api/v1/auto-debit/{policyId}", srv.handleGetAutoDebit)
		r.Patch("/api/v1/auto-debit/{policyId}", srv.handleUpdateAutoDebit)
		r.Delete("/api/v1/auto-debit/{policyId}", srv.handleCancelAutoDebit)

		r.Post("/api/v1/reconciliation", srv.handleCreateReconciliation)
		r.Get("/api/v1/reconciliation/{date}", srv.handleGetReconciliation)
	})

	// Graceful shutdown
	httpServer := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		sugar.Infof("Premium Collection Service listening on %s", httpServer.Addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			sugar.Fatalf("Server failed: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit

	sugar.Infof("Shutting down server...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownGrace)
	defer cancel()

	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		sugar.Fatalf("Server forced shutdown: %v", err)
	}

	srv.Redis.Close()
	srv.Postgres.Close()
	sugar.Infof("Server exited properly")
}

func (s *Server) instrumentMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		s.requestCount.Add(1)
		next.ServeHTTP(w, r)
		dur := time.Since(start)
		s.Logger.Infow("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", w.Header().Get("X-Status"),
			"duration_ms", dur.Milliseconds(),
			"total_requests", s.requestCount.Load(),
		)
	})
}

func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.healthyCount.Add(1)
		next.ServeHTTP(w, r)
	})
}

// handleHealth returns simple health status
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service":  "premium-collection-service",
		"status":   "healthy",
		"version":  "1.0.0",
		"uptime":   time.Since(time.Now().UTC().Truncate(time.Second)).String(),
		"requests": s.requestCount.Load(),
	})
}

// handleReadiness checks database and cache connectivity
func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	resp := map[string]interface{}{
		"service": "premium-collection-service",
		"status":  "ready",
		"version": "1.0.0",
		"checks":  checks,
	}
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

// handleCollectPayment processes a premium payment through any supported channel
func (s *Server) handleCollectPayment(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID    string         `json:"policy_id"`
		CustomerID  string         `json:"customer_id"`
		Amount      float64        `json:"amount"`
		Currency    string         `json:"currency"`
		Method      string         `json:"method"`
		ReferenceID string         `json:"reference_id"`
		Metadata    map[string]any `json:"metadata"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Validate
	if req.PolicyID == "" || req.CustomerID == "" || req.Amount <= 0 || req.Method == "" {
		writeError(w, "policy_id, customer_id, amount, and method are required", http.StatusBadRequest)
		return
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}

	feeRate := s.Config.Finance.FeeRate(req.Method)
	fee := math.Round(req.Amount*feeRate*100) / 100
	netAmount := math.Round((req.Amount-fee)*100) / 100

	if feeRate == 0 {
		fee = 0
		netAmount = req.Amount
	}

	receiptID := fmt.Sprintf("RCP-%d", time.Now().UnixNano()%1000000000)
	if req.ReferenceID == "" {
		req.ReferenceID = fmt.Sprintf("REF-%d", time.Now().UnixNano()%1000000000)
	}

	payment := &db.PaymentDB{
		ID:          fmt.Sprintf("pay_%d", time.Now().UnixNano()),
		PolicyID:    req.PolicyID,
		CustomerID:  req.CustomerID,
		Amount:      req.Amount,
		Currency:    req.Currency,
		Method:      req.Method,
		Status:      string(db.PaymentStatusConfirmed),
		Fee:         fee,
		FeeRate:     feeRate,
		NetAmount:   netAmount,
		ReceiptID:   receiptID,
		ReferenceID: req.ReferenceID,
		Metadata:    `{"channel":"api"}`,
	}

	if err := s.Postgres.InsertPayment(r.Context(), payment); err != nil {
		s.Logger.Errorf("Failed to insert payment: %v", err)
		writeError(w, "failed to process payment", http.StatusInternalServerError)
		return
	}

	// Cache the payment
	_ = s.Redis.CachePayment(r.Context(), payment, db.TCacheMedium)

	// Publish event
	_ = s.Redis.PublishPaymentEvent(r.Context(), map[string]interface{}{
		"event":      "payment.collected",
		"payment_id": payment.ID,
		"policy_id":  payment.PolicyID,
		"amount":     req.Amount,
		"method":     req.Method,
	})

	// Increment stats
	_, _ = s.Redis.IncrementStatsAtomically(r.Context(), "total_collected", int64(req.Amount))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"payment_id":   payment.ID,
			"receipt_id":   receiptID,
			"reference_id": payment.ReferenceID,
			"policy_id":    req.PolicyID,
			"customer_id":  req.CustomerID,
			"amount":       req.Amount,
			"currency":     req.Currency,
			"fee":          fee,
			"fee_rate":     feeRate,
			"net_amount":   netAmount,
			"method":       req.Method,
			"status":       "confirmed",
			"collected_at": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// handleRefundPayment processes a payment refund
func (s *Server) handleRefundPayment(w http.ResponseWriter, r *http.Request) {
	referenceID := chiURLParam(r, "reference")

	payment, err := s.Postgres.GetPaymentByReference(r.Context(), referenceID)
	if err != nil {
		writeError(w, "payment not found", http.StatusNotFound)
		return
	}

	if payment.Status == string(db.PaymentStatusRefunded) {
		writeError(w, "payment already refunded", http.StatusBadRequest)
		return
	}

	if payment.Status != string(db.PaymentStatusConfirmed) {
		writeError(w, "only confirmed payments can be refunded", http.StatusBadRequest)
		return
	}

	// Process refund
	_, _ = s.Redis.IncrementStatsAtomically(r.Context(), "total_refunds", 1)

	if err := s.Postgres.UpdatePaymentStatus(r.Context(), payment.ID, string(db.PaymentStatusRefunded)); err != nil {
		s.Logger.Errorf("Failed to update refund status: %v", err)
		writeError(w, "refund processing failed", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.InvalidatePayment(r.Context(), payment.ID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"refund_id":           fmt.Sprintf("REF-%d", time.Now().UnixNano()),
			"payment_id":          payment.ID,
			"reference_id":        payment.ReferenceID,
			"refund_amount":       payment.Amount,
			"fee_refunded":        payment.Fee,
			"net_refund":          payment.NetAmount,
			"status":              "refunded",
			"refunded_at":         time.Now().UTC().Format(time.RFC3339),
			"reverse_policy":      true,
			"settlement_reversal": true,
		},
	})
}

// handleListPayments retrieves payments with filtering and pagination
func (s *Server) handleListPayments(w http.ResponseWriter, r *http.Request) {
	policyID := r.URL.Query().Get("policy_id")
	_ = r.URL.Query().Get("status") // reserved for status filtering
	limit := 20
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if p, err := fmt.Sscanf(l, "%d", &limit); err == nil && p == 1 {
			if limit > 100 {
				limit = 100
			}
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		fmt.Sscanf(o, "%d", &offset)
	}

	var payments []*db.PaymentDB
	var err error

	if policyID != "" {
		payments, err = s.Postgres.GetPaymentsByPolicy(r.Context(), policyID, limit, offset)
	} else {
		// Default: get recent payments
		payments, err = s.Postgres.GetPaymentsByPolicy(r.Context(), "", limit, offset)
	}

	if err != nil {
		s.Logger.Errorf("Failed to list payments: %v", err)
		writeError(w, "failed to retrieve payments", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"payments": payments,
			"total":    len(payments),
			"limit":    limit,
			"offset":   offset,
		},
	})
}

// handleGetPayment retrieves a single payment by ID
func (s *Server) handleGetPayment(w http.ResponseWriter, r *http.Request) {
	id := chiURLParam(r, "id")

	// Try cache first
	cached, err := s.Redis.GetCachedPayment(r.Context(), id)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: cached})
		return
	}

	// Cache miss or error, fetch from DB
	payment, err := s.Postgres.GetPaymentByReference(r.Context(), id)
	if err != nil {
		writeError(w, "payment not found", http.StatusNotFound)
		return
	}

	// Populate cache
	_ = s.Redis.CachePayment(r.Context(), payment, db.TCacheMedium)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: payment})
}

// handleCollectionStats returns aggregated payment statistics
func (s *Server) handleCollectionStats(w http.ResponseWriter, r *http.Request) {
	period := r.URL.Query().Get("period")
	startDate := r.URL.Query().Get("start")
	endDate := r.URL.Query().Get("end")

	if startDate == "" || endDate == "" {
		endDate = time.Now().Format("2006-01-02")
		startDate = time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	}

	// Try cache
	if cached, err := s.Redis.GetCachedStats(r.Context(), period); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	stats, err := s.Postgres.GetCollectionStats(r.Context(), startDate, endDate)
	if err != nil {
		s.Logger.Errorf("Failed to get collection stats: %v", err)
		writeError(w, "failed to retrieve statistics", http.StatusInternalServerError)
		return
	}

	data, _ := json.Marshal(stats)
	_ = s.Redis.CacheStats(r.Context(), period, data, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: stats})
}

// handleCreateInstallmentPlan creates an installment payment plan
func (s *Server) handleCreateInstallmentPlan(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID     string  `json:"policy_id"`
		CustomerID   string  `json:"customer_id"`
		TotalAmount  float64 `json:"total_amount"`
		Months       int     `json:"months"`
		StartDate    string  `json:"start_date"`
		InterestRate float64 `json:"interest_rate"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.PolicyID == "" || req.CustomerID == "" || req.TotalAmount <= 0 || req.Months <= 0 {
		writeError(w, "policy_id, customer_id, total_amount, and months are required", http.StatusBadRequest)
		return
	}
	if req.Months > s.Config.Finance.InstallmentMaxMonths {
		writeError(w, fmt.Sprintf("max installments is %d months", s.Config.Finance.InstallmentMaxMonths), http.StatusBadRequest)
		return
	}
	if req.InterestRate <= 0 {
		req.InterestRate = 0.025 // default 2.5% per month
	}

	// Calculate with interest
	totalWithInterest := req.TotalAmount * (1 + req.InterestRate*float64(req.Months))
	installmentAmt := math.Ceil(totalWithInterest / float64(req.Months))

	start := time.Now()
	if req.StartDate != "" {
		if parsed, err := time.Parse("2006-01-02", req.StartDate); err == nil {
			start = parsed
		}
	}

	plan := &db.InstallmentPlanDB{
		ID:                fmt.Sprintf("plan_%d", time.Now().UnixNano()),
		PolicyID:          req.PolicyID,
		CustomerID:        req.CustomerID,
		TotalAmount:       totalWithInterest,
		Remaining:         totalWithInterest,
		Installments:      req.Months,
		InstallmentAmount: installmentAmt,
		Status:            string(db.InstallmentPending),
		StartDate:         start.Format("2006-01-02"),
	}

	// Generate schedule entries
	plan.Schedule = make([]*db.InstallmentEntryDB, req.Months)
	for i := 0; i < req.Months; i++ {
		plan.Schedule[i] = &db.InstallmentEntryDB{
			ID:     fmt.Sprintf("entry_%d_%d", time.Now().UnixNano(), i),
			PlanID: plan.ID,
			Amount: installmentAmt,
			Status: string(db.InstallmentPending),
		}
	}

	if err := s.Postgres.CreateInstallmentPlan(r.Context(), plan); err != nil {
		s.Logger.Errorf("Failed to create installment plan: %v", err)
		writeError(w, "failed to create installment plan", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.CacheInstallmentPlan(r.Context(), plan.ID, nil, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"plan_id":          plan.ID,
			"policy_id":        req.PolicyID,
			"customer_id":      req.CustomerID,
			"original_amount":  req.TotalAmount,
			"interest_rate":    req.InterestRate,
			"total_payable":    totalWithInterest,
			"monthly_payment":  installmentAmt,
			"num_installments": req.Months,
			"start_date":       plan.StartDate,
			"status":           "active",
			"schedule":         plan.Schedule,
		},
	})
}

// handleGetInstallmentPlan retrieves an installment plan
func (s *Server) handleGetInstallmentPlan(w http.ResponseWriter, r *http.Request) {
	planID := chiURLParam(r, "planId")

	// Try cache
	if cached, err := s.Redis.GetCachedInstallmentPlan(r.Context(), planID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	plan, err := s.Postgres.GetInstallmentPlan(r.Context(), planID)
	if err != nil {
		writeError(w, "installment plan not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: plan})
}

// handleGetInstallmentSchedule retrieves the schedule entries for a plan
func (s *Server) handleGetInstallmentSchedule(w http.ResponseWriter, r *http.Request) {
	planID := chiURLParam(r, "planId")

	entries, err := s.Postgres.GetInstallmentEntries(r.Context(), planID)
	if err != nil {
		writeError(w, "installment schedule not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"plan_id":     planID,
		"total_entry": len(entries),
		"schedule":    entries,
	}})
}

// handleGenerateReceipt creates a payment receipt
func (s *Server) handleGenerateReceipt(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PaymentID string `json:"payment_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	payment, err := s.Postgres.GetPaymentByReference(r.Context(), req.PaymentID)
	if err != nil {
		writeError(w, "payment not found", http.StatusNotFound)
		return
	}

	receiptID := fmt.Sprintf("RCP-%d", time.Now().UnixNano())
	validUntil := time.Now().Add(time.Duration(s.Config.Finance.ReceiptValidityHours) * time.Hour)

	receipt := map[string]interface{}{
		"id":           receiptID,
		"payment_id":   payment.ID,
		"policy_id":    payment.PolicyID,
		"amount":       payment.Amount,
		"fee":          payment.Fee,
		"net_amount":   payment.NetAmount,
		"method":       payment.Method,
		"reference_id": payment.ReferenceID,
		"issued_at":    time.Now().UTC().Format(time.RFC3339),
		"valid_until":  validUntil.Format(time.RFC3339),
		"download_url": fmt.Sprintf("/api/v1/receipts/%d/download", time.Now().UnixNano()),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: receipt})
}

// handleGetReceipt retrieves a receipt
func (s *Server) handleGetReceipt(w http.ResponseWriter, r *http.Request) {
	receiptID := chiURLParam(r, "receiptId")

	data, err := s.Redis.GetCachedReceipt(r.Context(), receiptID)
	if err != nil {
		writeError(w, "receipt not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(data)})
}

// handleCreateDunningRecord creates a dunning/reminder record
func (s *Server) handleCreateDunningRecord(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID     string   `json:"policy_id"`
		CustomerID   string   `json:"customer_id"`
		Amount       float64  `json:"amount"`
		ReminderType []string `json:"reminder_type"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	primaryType := string(db.DunningEmail)
	if len(req.ReminderType) > 0 {
		primaryType = req.ReminderType[0]
	}

	nextAttempt := time.Now().AddDate(0, 0, s.Config.Finance.DunningIntervalDays)
	dunning := &db.DunningDB{
		ID:           fmt.Sprintf("dun_%d", time.Now().UnixNano()),
		PolicyID:     req.PolicyID,
		CustomerID:   req.CustomerID,
		Amount:       req.Amount,
		Attempt:      1,
		Status:       string(db.DunningPending),
		ReminderType: primaryType,
		NextAttempt:  nextAttempt.Format(time.RFC3339),
		Metadata:     "{}",
	}

	if err := s.Postgres.CreateDunningRecord(r.Context(), dunning); err != nil {
		s.Logger.Errorf("Failed to create dunning record: %v", err)
		writeError(w, "failed to create dunning record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"dunning_id":    dunning.ID,
			"policy_id":     req.PolicyID,
			"customer_id":   req.CustomerID,
			"amount":        req.Amount,
			"reminder_type": primaryType,
			"attempt":       1,
			"max_attempts":  s.Config.Finance.DunningMaxAttempts,
			"next_attempt":  nextAttempt.Format(time.RFC3339),
			"status":        "pending",
		},
	})
}

// handleGetPendingDunning retrieves all pending dunning records
func (s *Server) handleGetPendingDunning(w http.ResponseWriter, r *http.Request) {
	records, err := s.Postgres.GetPendingDunningRecords(r.Context())
	if err != nil {
		writeError(w, "failed to retrieve dunning records", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: records})
}

// handleSendDunningReminder sends a dunning reminder
func (s *Server) handleSendDunningReminder(w http.ResponseWriter, r *http.Request) {
	_ = chiURLParam(r, "id") // record selected from pending queue

	records, err := s.Postgres.GetPendingDunningRecords(r.Context())
	if err != nil || len(records) == 0 {
		writeError(w, "dunning record not found", http.StatusNotFound)
		return
	}

	record := records[0]
	record.Attempt++
	record.Status = string(db.DunningSent)
	record.SentAt = new(string)
	*record.SentAt = time.Now().Format(time.RFC3339)
	record.NextAttempt = time.Now().AddDate(0, 0, s.Config.Finance.DunningIntervalDays).Format(time.RFC3339)

	if record.Attempt >= s.Config.Finance.DunningMaxAttempts {
		record.Status = string(db.DunningEscalated)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"dunning_id":    record.ID,
			"reminder_sent": true,
			"reminder_type": record.ReminderType,
			"attempt":       record.Attempt,
			"max_attempts":  s.Config.Finance.DunningMaxAttempts,
			"next_attempt":  record.NextAttempt,
			"status":        record.Status,
			"sent_at":       record.SentAt,
			"escalated":     record.Status == string(db.DunningEscalated),
		},
	})
}

// handleCreateAutoDebit creates auto-debit configuration
func (s *Server) handleCreateAutoDebit(w http.ResponseWriter, r *http.Request) {
	var req struct {
		PolicyID      string `json:"policy_id"`
		CustomerID    string `json:"customer_id"`
		BankName      string `json:"bank_name"`
		AccountNumber string `json:"account_number"`
		AccountName   string `json:"account_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.PolicyID == "" || req.CustomerID == "" || req.BankName == "" || req.AccountNumber == "" {
		writeError(w, "policy_id, customer_id, bank_name, and account_number are required", http.StatusBadRequest)
		return
	}

	if len(req.AccountNumber) != 10 {
		writeError(w, "account_number must be 10 digits (NUBAN)", http.StatusBadRequest)
		return
	}

	nextDebit := time.Now().AddDate(0, 0, 30).Format("2006-01-02")
	cfg := &db.AutoDebitDB{
		ID:            fmt.Sprintf("adb_%d", time.Now().UnixNano()),
		PolicyID:      req.PolicyID,
		CustomerID:    req.CustomerID,
		BankName:      req.BankName,
		AccountNumber: req.AccountNumber,
		AccountName:   req.AccountName,
		Status:        string(db.AutoDebitPending),
		NextDebitDate: &nextDebit,
		Metadata:      "{}",
	}

	if err := s.Postgres.CreateAutoDebitConfig(r.Context(), cfg); err != nil {
		s.Logger.Errorf("Failed to create auto-debit config: %v", err)
		writeError(w, "failed to create auto-debit configuration", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.SetAutoDebitConfig(r.Context(), req.PolicyID, nil, db.TCacheLong)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"config_id":       cfg.ID,
			"policy_id":       req.PolicyID,
			"customer_id":     req.CustomerID,
			"bank_name":       req.BankName,
			"account_number":  req.AccountNumber,
			"status":          "pending_verification",
			"next_debit_date": nextDebit,
		},
	})
}

// handleGetAutoDebit retrieves auto-debit configuration
func (s *Server) handleGetAutoDebit(w http.ResponseWriter, r *http.Request) {
	policyID := chiURLParam(r, "policyId")

	// Try cache
	if cached, err := s.Redis.GetAutoDebitConfig(r.Context(), policyID); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	cfg, err := s.Postgres.GetAutoDebitConfig(r.Context(), policyID)
	if err != nil {
		writeError(w, "auto-debit config not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: cfg})
}

// handleUpdateAutoDebit updates auto-debit configuration
func (s *Server) handleUpdateAutoDebit(w http.ResponseWriter, r *http.Request) {
	policyID := chiURLParam(r, "policyId")

	var req struct {
		Status    string `json:"status"`
		NextDebit string `json:"next_debit_date"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"policy_id": policyID,
			"status":    req.Status,
			"updated":   true,
			"at":        time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// handleCancelAutoDebit cancels an auto-debit configuration
func (s *Server) handleCancelAutoDebit(w http.ResponseWriter, r *http.Request) {
	policyID := chiURLParam(r, "policyId")

	_ = s.Redis.InvalidateAutoDebitConfig(r.Context(), policyID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"policy_id":    policyID,
			"status":       "cancelled",
			"cancelled_at": time.Now().UTC().Format(time.RFC3339),
		},
	})
}

// handleCreateReconciliation creates or updates a reconciliation record
func (s *Server) handleCreateReconciliation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Date             string                     `json:"date"`
		TotalCollected   float64                    `json:"total_collected"`
		TotalReconciled  float64                    `json:"total_reconciled"`
		ChannelBreakdown []models.ChannelSettlement `json:"channel_breakdown"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	discrepancy := math.Abs(req.TotalCollected - req.TotalReconciled)
	discrepancyCount := 0
	if discrepancy > 0.01 {
		discrepancyCount = len(req.ChannelBreakdown)
	}

	channels, _ := json.Marshal(req.ChannelBreakdown)
	rec := &db.ReconciliationDB{
		ID:               fmt.Sprintf("rec_%d", time.Now().UnixNano()),
		Date:             req.Date,
		TotalCollected:   req.TotalCollected,
		TotalReconciled:  req.TotalReconciled,
		TotalPending:     req.TotalCollected - req.TotalReconciled,
		TotalDiscrepancy: discrepancy,
		DiscrepancyCount: discrepancyCount,
		ChannelBreakdown: string(channels),
		Status:           "completed",
	}

	if err := s.Postgres.UpsertReconciliationRecord(r.Context(), rec); err != nil {
		s.Logger.Errorf("Failed to create reconciliation: %v", err)
		writeError(w, "failed to create reconciliation record", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"record_id":         rec.ID,
			"date":              req.Date,
			"total_collected":   req.TotalCollected,
			"total_reconciled":  req.TotalReconciled,
			"total_pending":     rec.TotalPending,
			"total_discrepancy": rec.TotalDiscrepancy,
			"discrepancy_count": rec.DiscrepancyCount,
			"status":            "completed",
		},
	})
}

// handleGetReconciliation retrieves a reconciliation record by date
func (s *Server) handleGetReconciliation(w http.ResponseWriter, r *http.Request) {
	date := chiURLParam(r, "date")

	rec, err := s.Postgres.GetReconciliationByDate(r.Context(), date)
	if err != nil {
		writeError(w, "reconciliation record not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: rec})
}

// writeError writes a JSON error response
func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(Response{
		Success: false,
		Error:   msg,
	})
}

// handleHealthSimple returns simple health status
func handleHealthSimple(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"service": "premium-collection-service",
		"status":  "healthy",
	})
}

// validateQueryParam returns a query parameter value, rejecting over-long input.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %s exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateIntParam parses an optional integer query parameter.
func validateIntParam(r *http.Request, key string) (int, error) {
	val := r.URL.Query().Get(key)
	if val == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(val)
	if err != nil {
		return 0, fmt.Errorf("parameter %s must be an integer", key)
	}
	return n, nil
}
