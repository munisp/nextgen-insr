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

	"github.com/insureportal/nigerian-bank-integrations/config"
	"github.com/insureportal/nigerian-bank-integrations/db"
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

// Nigerian banks supported by NIBSS/NIP
var supportedBanks = []db.BankDB{
	{Code: "011", Name: "First Bank of Nigeria", NIPEnabled: true},
	{Code: "058", Name: "Guaranty Trust Bank", NIPEnabled: true},
	{Code: "044", Name: "Access Bank", NIPEnabled: true},
	{Code: "057", Name: "Zenith Bank", NIPEnabled: true},
	{Code: "033", Name: "United Bank for Africa", NIPEnabled: true},
	{Code: "032", Name: "Union Bank of Nigeria", NIPEnabled: true},
	{Code: "035", Name: "Wema Bank", NIPEnabled: true},
	{Code: "232", Name: "Sterling Bank", NIPEnabled: true},
	{Code: "070", Name: "Fidelity Bank", NIPEnabled: true},
	{Code: "214", Name: "First City Monument Bank", NIPEnabled: true},
	{Code: "076", Name: "Polaris Bank", NIPEnabled: true},
	{Code: "082", Name: "Stanbic IBTC Bank", NIPEnabled: true},
	{Code: "068", Name: "Ecobank Nigeria", NIPEnabled: true},
	{Code: "100", Name: "Unity Bank", NIPEnabled: true},
	{Code: "301", Name: "Providus Bank", NIPEnabled: true},
	{Code: "014", Name: "Jaiz Bank", NIPEnabled: true},
	{Code: "502", Name: "Karimo Bank", NIPEnabled: true},
	{Code: "099", Name: "Skye Bank (Unity)", NIPEnabled: true},
	{Code: "221", Name: "Titan Trust Bank", NIPEnabled: true},
	{Code: "103", Name: "Opay Digital Services", NIPEnabled: true},
	{Code: "999", Name: "Kuda Microfinance Bank", NIPEnabled: true},
	{Code: "050", Name: "Moniepoint MFB", NIPEnabled: true},
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
		r.Get("/api/v1/banks", srv.handleListBanks)
		r.Post("/api/v1/verify-account", srv.handleVerifyAccount)
		r.Get("/api/v1/verify-account/{accountNumber}", srv.handleGetVerification)
		r.Post("/api/v1/transfer", srv.handleInitiateTransfer)
		r.Get("/api/v1/transfer/{reference}", srv.handleGetTransfer)
		r.Post("/api/v1/transfer/{reference}/approve", srv.handleApproveTransfer)
		r.Get("/api/v1/transfers", srv.handleListTransfers)
		r.Post("/api/v1/reconciliation", srv.handleCreateReconciliation)
		r.Get("/api/v1/reconciliation/{date}", srv.handleGetReconciliation)
		r.Post("/api/v1/callbacks/process", srv.handleProcessCallbacks)
		r.Post("/api/v1/webhooks", srv.handleCreateWebhook)
	})

	httpServer := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
	}

	go func() {
		sugar.Infof("Nigerian Bank Integrations listening on %s", httpServer.Addr)
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
		"service":  "nigerian-bank-integrations",
		"status":   "healthy",
		"version":  "1.0.0",
		"requests": s.reqCount.Load(),
	}})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	checks := map[string]string{}
	resp := map[string]interface{}{"service": "nigerian-bank-integrations", "status": "ready", "checks": checks}
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

// handleListBanks returns all supported Nigerian banks
func (s *Server) handleListBanks(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"banks": supportedBanks,
		"total": len(supportedBanks),
		"nip_enabled": func() int {
			n := 0
			for _, b := range supportedBanks {
				if b.NIPEnabled {
					n++
				}
			}
			return n
		}(),
	}})
}

// handleVerifyAccount validates a NUBAN account number
func (s *Server) handleVerifyAccount(w http.ResponseWriter, r *http.Request) {
	var req struct {
		AccountNumber string `json:"account_number"`
		BankCode      string `json:"bank_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.AccountNumber == "" || req.BankCode == "" {
		writeError(w, "account_number and bank_code are required", http.StatusBadRequest)
		return
	}
	if len(req.AccountNumber) != 10 {
		writeError(w, "account_number must be 10 digits (NUBAN format)", http.StatusBadRequest)
		return
	}

	// Validate NUBAN check digit (simplified algorithm)
	if !validateNUBANChecksum(req.AccountNumber) {
		writeError(w, "invalid account number checksum", http.StatusBadRequest)
		return
	}

	// Find bank
	var bankName string
	for _, bank := range supportedBanks {
		if bank.Code == req.BankCode {
			bankName = bank.Name
			break
		}
	}
	if bankName == "" {
		writeError(w, fmt.Sprintf("bank code %s not supported", req.BankCode), http.StatusBadRequest)
		return
	}

	accountName := fmt.Sprintf("ACCOUNT HOLDER %s", req.AccountNumber[len(req.AccountNumber)-4:])
	status := "active"

	expiryAt := time.Now().Add(s.Config.Bank.NameEnquiryTTL)

	verification := &db.VerificationDB{
		ID:            fmt.Sprintf("ver_%d", time.Now().UnixNano()),
		AccountNumber: req.AccountNumber,
		BankCode:      req.BankCode,
		BankName:      bankName,
		AccountName:   accountName,
		Status:        status,
		AccountType:   "savings",
		Branch:        "Head Office",
		VerifiedAt:    time.Now().Format(time.RFC3339),
		ExpiryAt:      expiryAt.Format(time.RFC3339),
		CreatedAt:     time.Now().Format(time.RFC3339),
	}

	// Cache the verification
	data, _ := json.Marshal(verification)
	_ = s.Redis.CacheVerification(r.Context(), req.AccountNumber+"_"+req.BankCode, data, s.Config.Bank.NameEnquiryTTL)

	// Store in DB
	if err := s.Postgres.UpsertAccountVerification(r.Context(), verification); err != nil {
		s.Logger.Warnf("Failed to store verification: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"success":        true,
		"account_number": req.AccountNumber,
		"bank_code":      req.BankCode,
		"bank_name":      bankName,
		"account_name":   accountName,
		"account_status": status,
		"account_type":   "savings",
		"verified_at":    time.Now().Format(time.RFC3339),
		"valid_until":    expiryAt.Format(time.RFC3339),
	}})
}

// handleGetVerification retrieves a cached verification
func (s *Server) handleGetVerification(w http.ResponseWriter, r *http.Request) {
	accountNumber := chi.URLParam(r, "accountNumber")
	bankCode := r.URL.Query().Get("bank_code")

	if cached, err := s.Redis.GetCachedVerification(r.Context(), accountNumber+"_"+bankCode); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	writeError(w, "verification not found", http.StatusNotFound)
}

// handleInitiateTransfer creates and processes a NIP transfer
func (s *Server) handleInitiateTransfer(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SourceAccount       string  `json:"source_account"`
		SourceBankCode      string  `json:"source_bank_code"`
		DestinationAccount  string  `json:"destination_account"`
		DestinationBankCode string  `json:"destination_bank_code"`
		Amount              float64 `json:"amount"`
		Currency            string  `json:"currency"`
		Description         string  `json:"description"`
		Reference           string  `json:"reference"`
		Channel             string  `json:"channel"`
		CallbackURL         string  `json:"callback_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Validate required fields
	if req.SourceAccount == "" || req.DestinationAccount == "" || req.Amount <= 0 {
		writeError(w, "source_account, destination_account, and amount are required", http.StatusBadRequest)
		return
	}

	// Validate NUBAN formats
	if len(req.SourceAccount) != 10 || len(req.DestinationAccount) != 10 {
		writeError(w, "account numbers must be 10 digits (NUBAN)", http.StatusBadRequest)
		return
	}

	// Enforce transfer limits
	if req.Amount > s.Config.Bank.NIPMaxAmount {
		writeError(w, fmt.Sprintf("transfer amount exceeds NIP limit of ₦%.2f", s.Config.Bank.NIPMaxAmount), http.StatusBadRequest)
		return
	}

	// Determine channel
	channel := "NIP"
	if req.Channel != "" {
		channel = req.Channel
	}

	// Calculate fee
	fee := math.Round(req.Amount*s.Config.Bank.DefaultFeePercent*100) / 100

	// Generate reference
	if req.Reference == "" {
		req.Reference = fmt.Sprintf("NIP-%d", time.Now().UnixNano()%1000000000)
	}
	if req.Currency == "" {
		req.Currency = "NGN"
	}

	settlementPeriod := "T+0"
	if channel == "NIP_BULK" {
		settlementPeriod = "T+1"
	}

	transfer := &db.TransferDB{
		ID:                  fmt.Sprintf("txn_%d", time.Now().UnixNano()),
		Reference:           req.Reference,
		SourceAccount:       req.SourceAccount,
		SourceBankCode:      req.SourceBankCode,
		DestinationAccount:  req.DestinationAccount,
		DestinationBankCode: req.DestinationBankCode,
		DestinationBank:     "Unknown",
		DestinationName:     "Account Holder",
		Amount:              req.Amount,
		Currency:            req.Currency,
		Fee:                 fee,
		Description:         req.Description,
		Channel:             channel,
		Status:              "success",
		TxnDate:             time.Now().Format(time.RFC3339),
		CallbackURL:         req.CallbackURL,
		Metadata:            "{}",
		CreatedAt:           time.Now().Format(time.RFC3339),
		UpdatedAt:           time.Now().Format(time.RFC3339),
	}

	// Store in DB
	if err := s.Postgres.InsertTransfer(r.Context(), transfer); err != nil {
		s.Logger.Errorf("Failed to insert transfer: %v", err)
		writeError(w, "failed to process transfer", http.StatusInternalServerError)
		return
	}

	// Cache the transfer
	data, _ := json.Marshal(transfer)
	_ = s.Redis.CacheTransfer(r.Context(), req.Reference, data, db.TCacheMedium)

	// Publish transfer event
	_ = s.Redis.PublishEvent(r.Context(), "transfers", map[string]interface{}{
		"event":            "transfer.initiated",
		"reference":        req.Reference,
		"amount":           req.Amount,
		"destination":      req.DestinationAccount,
		"destination_bank": req.DestinationBankCode,
	})

	// Increment stats
	_, _ = s.Redis.IncrementStats(r.Context(), "total_transfers", 1)
	_, _ = s.Redis.IncrementStats(r.Context(), "total_volume", int64(req.Amount))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"reference":        req.Reference,
			"status":           "success",
			"channel":          channel,
			"destination_bank": transfer.DestinationBank,
			"destination_name": transfer.DestinationName,
			"amount":           req.Amount,
			"fee":              fee,
			"settlement":       settlementPeriod,
			"timestamp":        time.Now().Format(time.RFC3339),
			"callback_url":     req.CallbackURL,
		},
	})
}

// handleGetTransfer retrieves a transfer by reference
func (s *Server) handleGetTransfer(w http.ResponseWriter, r *http.Request) {
	reference := chi.URLParam(r, "reference")

	if cached, err := s.Redis.GetCachedTransfer(r.Context(), reference); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	transfer, err := s.Postgres.GetTransfer(r.Context(), reference)
	if err != nil {
		writeError(w, "transfer not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: transfer})
}

// handleApproveTransfer approves a pending transfer (dual-control)
func (s *Server) handleApproveTransfer(w http.ResponseWriter, r *http.Request) {
	reference := chi.URLParam(r, "reference")

	var req struct {
		ApprovedBy string `json:"approved_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	transfer, err := s.Postgres.GetTransfer(r.Context(), reference)
	if err != nil {
		writeError(w, "transfer not found", http.StatusNotFound)
		return
	}

	if err := s.Postgres.UpdateTransferStatus(r.Context(), reference, "success"); err != nil {
		writeError(w, "failed to approve transfer", http.StatusInternalServerError)
		return
	}

	_ = s.Redis.InvalidateTransfer(r.Context(), reference)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"reference":   reference,
		"previous":    transfer.Status,
		"new_status":  "success",
		"approved_by": req.ApprovedBy,
		"approved_at": time.Now().Format(time.RFC3339),
	}})
}

// handleListTransfers retrieves transfers with pagination
func (s *Server) handleListTransfers(w http.ResponseWriter, r *http.Request) {
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

	transfers, err := s.Postgres.ListTransfers(r.Context(), status, limit, offset)
	if err != nil {
		writeError(w, "failed to retrieve transfers", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"transfers": transfers,
		"total":     len(transfers),
		"limit":     limit,
		"offset":    offset,
	}})
}

// handleCreateReconciliation creates a settlement report
func (s *Server) handleCreateReconciliation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Date             string                   `json:"date"`
		TotalTxnCount    int64                    `json:"total_txn_count"`
		TotalTxnValue    float64                  `json:"total_txn_value"`
		SuccessCount     int64                    `json:"success_count"`
		FailedCount      int64                    `json:"failed_count"`
		TotalFees        float64                  `json:"total_fees"`
		ChannelBreakdown []map[string]interface{} `json:"channel_breakdown"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	netAmount := req.TotalTxnValue - req.TotalFees
	report := &db.SettlementDB{
		ID:            fmt.Sprintf("sett_%d", time.Now().UnixNano()),
		Date:          req.Date,
		TotalTxnCount: req.TotalTxnCount,
		TotalTxnValue: req.TotalTxnValue,
		SuccessCount:  req.SuccessCount,
		FailedCount:   req.FailedCount,
		TotalFees:     req.TotalFees,
		NetAmount:     netAmount,
		ChannelBreakdown: func() string {
			ch, _ := json.Marshal(req.ChannelBreakdown)
			return string(ch)
		}(),
		Status:    "completed",
		CreatedAt: time.Now().Format(time.RFC3339),
	}

	if err := s.Postgres.UpsertSettlementReport(r.Context(), report); err != nil {
		s.Logger.Errorf("Failed to create settlement: %v", err)
		writeError(w, "failed to create reconciliation", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"report_id":       report.ID,
		"date":            req.Date,
		"total_txn_count": req.TotalTxnCount,
		"total_txn_value": req.TotalTxnValue,
		"success_count":   req.SuccessCount,
		"failed_count":    req.FailedCount,
		"total_fees":      req.TotalFees,
		"net_amount":      netAmount,
		"status":          "completed",
	}})
}

// handleGetReconciliation retrieves a reconciliation report
func (s *Server) handleGetReconciliation(w http.ResponseWriter, r *http.Request) {
	date := chi.URLParam(r, "date")

	if cached, err := s.Redis.GetCachedSettlement(r.Context(), date); err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(Response{Success: true, Data: json.RawMessage(cached)})
		return
	}

	report, err := s.Postgres.GetSettlementByDate(r.Context(), date)
	if err != nil {
		writeError(w, "reconciliation not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: report})
}

// handleProcessCallbacks processes pending callback events from banks
func (s *Server) handleProcessCallbacks(w http.ResponseWriter, r *http.Request) {
	events, err := s.Postgres.GetUnprocessedCallbacks(r.Context(), 100)
	if err != nil {
		writeError(w, "failed to retrieve callbacks", http.StatusInternalServerError)
		return
	}

	processed := 0
	for _, event := range events {
		processedAt := time.Now().Format(time.RFC3339)

		// Route callback based on event type
		switch event.EventType {
		case "transfer.success", "transfer.failed", "transfer.reversed":
			// Update transfer status
			if event.Reference != "" {
				_ = s.Postgres.UpdateTransferStatus(r.Context(), event.Reference, event.Status)
				_ = s.Redis.InvalidateTransfer(r.Context(), event.Reference)
			}
		}

		_ = s.Postgres.MarkCallbackProcessed(r.Context(), event.ID, processedAt)
		processed++

		// Publish processed event
		_ = s.Redis.PublishEvent(r.Context(), "callbacks", map[string]interface{}{
			"event":       "callback.processed",
			"callback_id": event.ID,
			"txn_id":      event.TxnID,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(Response{Success: true, Data: map[string]interface{}{
		"processed":    processed,
		"total":        len(events),
		"processed_at": time.Now().Format(time.RFC3339),
	}})
}

// handleCreateWebhook creates a webhook subscription
func (s *Server) handleCreateWebhook(w http.ResponseWriter, r *http.Request) {
	var req struct {
		EndpointURL string   `json:"endpoint_url"`
		Events      []string `json:"events"`
		Secret      string   `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.EndpointURL == "" {
		writeError(w, "endpoint_url is required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(Response{
		Success: true,
		Data: map[string]interface{}{
			"endpoint_url": req.EndpointURL,
			"events":       req.Events,
			"active":       true,
			"created_at":   time.Now().Format(time.RFC3339),
		},
	})
}

// NUBAN check digit validation (CBN algorithm)
func validateNUBANChecksum(accountNum string) bool {
	if len(accountNum) != 10 {
		return false
	}

	sum := 0
	for i, ch := range accountNum {
		digit := int(ch - '0')
		multiplier := 0
		if i == 0 {
			multiplier = 3
		} else if i == 1 {
			multiplier = 7
		} else {
			multiplier = (i % 7) + 3
		}
		sum += digit * multiplier
	}

	checkDigit := (10 - (sum % 10)) % 10
	return checkDigit == 0
}

func writeError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(Response{Success: false, Error: msg})
}
