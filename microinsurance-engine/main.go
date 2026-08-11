package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/insureportal/microinsurance-engine/config"
	"github.com/insureportal/microinsurance-engine/db"
	"github.com/insureportal/microinsurance-engine/models"
	"go.uber.org/zap"
)

const (
	claimAutoApproveLimit = 50000.0
	kycMinAge             = 18
	kycMaxAge             = 65
	defaultLimit          = 20
	defaultOffset         = 0
)

func main() {
	cfg := config.NewConfig()

	logger, err := zap.NewProduction()
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	defer logger.Sync()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pg, err := db.NewPostgres(ctx, &cfg.Postgres)
	if err != nil {
		logger.Fatal("Failed to connect to postgres", zap.Error(err))
	}
	if err := pg.RunMigrations(ctx); err != nil {
		logger.Fatal("Failed to run migrations", zap.Error(err))
	}
	logger.Info("PostgreSQL migrations completed")

	redis, err := db.NewRedisCache(ctx, &cfg.Redis)
	if err != nil {
		logger.Warn("Failed to connect to Redis (non-fatal)", zap.Error(err))
	}

	seedProducts(pg, ctx, logger)

	router := buildRouter(cfg, pg, redis, logger)

	srv := &http.Server{
		Addr:         fmt.Sprintf("%s:%s", cfg.Server.Host, cfg.Server.Port),
		Handler:      router,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  60 * time.Second,
	}

	shutdownCh := make(chan os.Signal, 1)
	signal.Notify(shutdownCh, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		logger.Info("Microinsurance Engine starting",
			zap.String("addr", srv.Addr),
			zap.String("service", "microinsurance-engine"))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-shutdownCh
	logger.Info("Shutting down server...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.Server.ShutdownGrace)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server forced shutdown", zap.Error(err))
	}

	redis.Close()
	pg.Close()
	logger.Info("Server exited properly")
}

func buildRouter(cfg *config.Config, pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(middleware.WithValue("logger", logger))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   cfg.CORS.AllowedOrigins,
		AllowedMethods:   cfg.CORS.AllowedMethods,
		AllowedHeaders:   cfg.CORS.AllowedHeaders,
		AllowCredentials: cfg.CORS.AllowCredentials,
		MaxAge:           int(cfg.CORS.MaxAge.Seconds()),
	}))

	r.Get("/health", healthHandler(logger))
	r.Get("/ready", readinessHandler(pg, redis, logger))

	r.Group(func(r chi.Router) {
		r.Get("/api/v1/products", listProductsHandler(pg, redis, logger))
		r.Post("/api/v1/products", createProductHandler(pg, redis, logger))
		r.Get("/api/v1/products/{id}", getProductHandler(pg, redis, logger))
		r.Put("/api/v1/products/{id}", updateProductHandler(pg, redis, logger))
		r.Delete("/api/v1/products/{id}", deleteProductHandler(pg, redis, logger))

		r.Get("/api/v1/enrollments", listEnrollmentsHandler(pg, redis, logger))
		r.Post("/api/v1/enroll", enrollHandler(pg, redis, logger))
		r.Get("/api/v1/enrollment/{id}", getEnrollmentHandler(pg, redis, logger))
		r.Put("/api/v1/enrollment/{id}/cancel", cancelEnrollmentHandler(pg, redis, logger))

		r.Get("/api/v1/claims", listClaimsHandler(pg, redis, logger))
		r.Post("/api/v1/claims", createClaimHandler(pg, redis, logger))
		r.Get("/api/v1/claim/{id}", getClaimHandler(pg, redis, logger))
		r.Put("/api/v1/claim/{id}/approve", approveClaimHandler(pg, redis, logger))
		r.Put("/api/v1/claim/{id}/reject", rejectClaimHandler(pg, redis, logger))

		r.Get("/api/v1/groups", listGroupsHandler(pg, redis, logger))
		r.Post("/api/v1/groups", createGroupHandler(pg, redis, logger))
		r.Get("/api/v1/groups/{id}", getGroupHandler(pg, redis, logger))

		r.Get("/api/v1/premium/schedule", premiumScheduleHandler(pg, redis, logger))
		r.Post("/api/v1/premium/pay", recordPaymentHandler(pg, redis, logger))

		r.Get("/api/v1/parametric/triggers", listTriggersHandler(pg, redis, logger))
		r.Post("/api/v1/parametric/triggers", createTriggerHandler(pg, redis, logger))

		r.Get("/api/v1/metrics", metricsHandler(pg, redis, logger))
	})

	return r
}

// ---------- Health & Readiness ----------

func healthHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "healthy",
			"service":   "microinsurance-engine",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func readinessHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		ctx := r.Context()

		if err := pg.Pool.Ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "postgres_unavailable"})
			return
		}

		if redis != nil {
			if err := redis.Client.Ping(ctx).Err(); err != nil {
				logger.Warn("Redis not available at readiness", zap.Error(err))
			}
		}

		json.NewEncoder(w).Encode(map[string]string{
			"status":    "ready",
			"service":   "microinsurance-engine",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ---------- Products ----------

func listProductsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		status := r.URL.Query().Get("status")
		pType := r.URL.Query().Get("type")
		limit := parseIntQuery(r.URL.Query().Get("limit"), defaultLimit)
		offset := parseIntQuery(r.URL.Query().Get("offset"), defaultOffset)
		if limit > 100 {
			limit = 100
		}

		cacheKey := fmt.Sprintf("products:%s:%s:%d:%d", status, pType, limit, offset)
		if redis != nil {
			if cacheData, err := redis.GetCachedProduct(r.Context(), cacheKey); err == nil && len(cacheData) > 0 {
				w.Header().Set("X-Cache", "HIT")
				json.NewEncoder(w).Encode(json.RawMessage(cacheData))
				return
			}
			w.Header().Set("X-Cache", "MISS")
		}

		products, err := pg.ListProducts(r.Context(), status, pType, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list products", logger)
			return
		}

		resp := map[string]any{
			"products": products,
			"total":    len(products),
			"limit":    limit,
			"offset":   offset,
		}

		if redis != nil {
			if serialized, err := json.Marshal(resp); err == nil {
				_ = redis.CacheProduct(r.Context(), cacheKey, serialized, db.TCacheMedium)
			}
		}

		json.NewEncoder(w).Encode(resp)
	}
}

func createProductHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			ProductID         string         `json:"product_id"`
			Name              string         `json:"name"`
			Type              string         `json:"type"`
			Description       string         `json:"description"`
			Premium           float64        `json:"premium"`
			Currency          string         `json:"currency"`
			CoverageAmount    float64        `json:"coverage_amount"`
			CoverageType      string         `json:"coverage_type"`
			Duration          string         `json:"duration"`
			ClaimSLA          string         `json:"claim_sla"`
			MaxAge            int            `json:"max_age"`
			MinAge            int            `json:"min_age"`
			MaxSumInsured     float64        `json:"max_sum_insured"`
			WaitingPeriod     string         `json:"waiting_period"`
			ParametricTrigger string         `json:"parametric_trigger,omitempty"`
			Exclusions        []string       `json:"exclusions,omitempty"`
			Status            string         `json:"status"`
			Metadata          map[string]any `json:"metadata,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if err := validateProduct(models.MicroProduct{
			ProductID:      req.ProductID,
			Name:           req.Name,
			Premium:        req.Premium,
			CoverageAmount: req.CoverageAmount,
			MaxAge:         req.MaxAge,
			MinAge:         req.MinAge,
			Status:         models.ProductStatus(req.Status),
		}); err != nil {
			writeError(w, http.StatusBadRequest, err.Error(), logger)
			return
		}

		productID := generateID()
		now := time.Now().UTC()

		product := &models.MicroProduct{
			ID:                productID,
			ProductID:         req.ProductID,
			Name:              req.Name,
			Type:              models.ProductType(req.Type),
			Description:       req.Description,
			Premium:           req.Premium,
			Currency:          req.Currency,
			CoverageAmount:    req.CoverageAmount,
			CoverageType:      models.CoverageType(req.CoverageType),
			Duration:          req.Duration,
			ClaimSLA:          req.ClaimSLA,
			MaxAge:            req.MaxAge,
			MinAge:            req.MinAge,
			MaxSumInsured:     req.MaxSumInsured,
			WaitingPeriod:     req.WaitingPeriod,
			ParametricTrigger: req.ParametricTrigger,
			Exclusions:        req.Exclusions,
			Status:            models.ProductStatus(req.Status),
			Metadata:          req.Metadata,
			CreatedAt:         now,
			UpdatedAt:         now,
		}

		if err := pg.InsertProduct(r.Context(), product); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create product: %v", err), logger)
			return
		}

		if redis != nil {
			redis.InvalidateAllProducts(r.Context())
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(product)
	}
}

func getProductHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		if redis != nil {
			if cacheData, err := redis.GetCachedProduct(r.Context(), id); err == nil && len(cacheData) > 0 {
				w.Header().Set("X-Cache", "HIT")
				json.NewEncoder(w).Encode(json.RawMessage(cacheData))
				return
			}
			w.Header().Set("X-Cache", "MISS")
		}

		product, err := pg.GetProduct(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, fmt.Sprintf("product not found: %s", id), logger)
			return
		}

		if redis != nil {
			if serialized, err := json.Marshal(product); err == nil {
				_ = redis.CacheProduct(r.Context(), id, serialized, db.TCacheMedium)
			}
		}

		json.NewEncoder(w).Encode(product)
	}
}

func updateProductHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		product, err := pg.GetProduct(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, fmt.Sprintf("product not found: %s", id), logger)
			return
		}

		var req struct {
			Name            string         `json:"name"`
			Description     string         `json:"description"`
			Premium         float64        `json:"premium"`
			CoverageAmount  float64        `json:"coverage_amount"`
			Status          string         `json:"status"`
			ClaimSLA        string         `json:"claim_sla"`
			MaxAge          int            `json:"max_age"`
			MinAge          int            `json:"min_age"`
			Exclusions      []string       `json:"exclusions,omitempty"`
			Metadata        map[string]any `json:"metadata,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.Name != "" {
			product.Name = req.Name
		}
		if req.Description != "" {
			product.Description = req.Description
		}
		if req.Premium > 0 {
			product.Premium = req.Premium
		}
		if req.CoverageAmount > 0 {
			product.CoverageAmount = req.CoverageAmount
		}
		if req.Status != "" {
			product.Status = models.ProductStatus(req.Status)
		}
		if req.ClaimSLA != "" {
			product.ClaimSLA = req.ClaimSLA
		}
		if req.MaxAge > 0 {
			product.MaxAge = req.MaxAge
		}
		if req.MinAge > 0 {
			product.MinAge = req.MinAge
		}
		if req.Exclusions != nil {
			product.Exclusions = req.Exclusions
		}
		if req.Metadata != nil {
			product.Metadata = req.Metadata
		}

		product.UpdatedAt = time.Now().UTC()

		if err := pg.UpdateProduct(r.Context(), product); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update product", logger)
			return
		}

		if redis != nil {
			redis.InvalidateProduct(r.Context(), id)
			redis.InvalidateAllProducts(r.Context())
		}

		json.NewEncoder(w).Encode(product)
	}
}

func deleteProductHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		if err := pg.DeleteProduct(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to delete product", logger)
			return
		}

		if redis != nil {
			redis.InvalidateProduct(r.Context(), id)
			redis.InvalidateAllProducts(r.Context())
		}

		w.WriteHeader(http.StatusNoContent)
	}
}

// ---------- Enrollments ----------

func listEnrollmentsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		status := r.URL.Query().Get("status")
		productID := r.URL.Query().Get("product_id")
		customerID := r.URL.Query().Get("customer_id")
		limit := parseIntQuery(r.URL.Query().Get("limit"), defaultLimit)
		offset := parseIntQuery(r.URL.Query().Get("offset"), defaultOffset)
		if limit > 100 {
			limit = 100
		}

		enrollments, total, err := pg.ListEnrollments(r.Context(), status, productID, customerID, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list enrollments", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"enrollments": enrollments,
			"total":       total,
			"limit":       limit,
			"offset":      offset,
		})
	}
}

func enrollHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			CustomerID    string                  `json:"customer_id"`
			PhoneNumber   string                  `json:"phone_number"`
			FirstName     string                  `json:"first_name"`
			LastName      string                  `json:"last_name"`
			DateOfBirth   string                  `json:"date_of_birth"`
			ProductID     string                  `json:"product_id"`
			Channel       string                  `json:"channel"`
			PaymentMethod string                  `json:"payment_method"`
			GroupID       string                  `json:"group_id,omitempty"`
			KYCDocuments  map[string]string       `json:"kyc_documents,omitempty"`
			Metadata      map[string]any          `json:"metadata,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if err := validateEnrollment(req.CustomerID, req.ProductID, req.Channel); err != nil {
			writeError(w, http.StatusBadRequest, err.Error(), logger)
			return
		}

		product, err := pg.GetProduct(r.Context(), req.ProductID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "product not found", logger)
			return
		}

		if product.Status != models.ProductActive {
			writeError(w, http.StatusBadRequest, "product is not active", logger)
			return
		}

		// KYC check: validate age
		if req.DateOfBirth != "" {
			dob, err := time.Parse("2006-01-02", req.DateOfBirth)
			if err == nil {
				age := int(time.Since(dob).Hours() / 8766)
				if age < kycMinAge || age > kycMaxAge {
					writeError(w, http.StatusBadRequest, fmt.Sprintf("age %d is outside acceptable range (%d-%d)", age, kycMinAge, kycMaxAge), logger)
					return
				}
			}
		}

		enrollmentID := fmt.Sprintf("ENR-%s", generateID())
		now := time.Now().UTC()
		startDate := now
		duration := parseDuration(product.Duration)
		endDate := startDate.Add(duration)

		enrollment := &models.Enrollment{
			ID:            generateID(),
			EnrollmentID:  enrollmentID,
			ProductID:     product.ID,
			CustomerID:    req.CustomerID,
			PhoneNumber:   req.PhoneNumber,
			FirstName:     req.FirstName,
			LastName:      req.LastName,
			Channel:       models.EnrollmentChannel(req.Channel),
			Status:        models.EnrollmentActive,
			StartDate:     startDate,
			EndDate:       endDate,
			Premium:       product.Premium,
			PaymentMethod: req.PaymentMethod,
			GroupID:       req.GroupID,
			NextPaymentDue: startDate.AddDate(0, 1, 0),
			AutoRenew:     true,
			Metadata: map[string]any{
				"kyc_documents": req.KYCDocuments,
			},
			CreatedAt: now,
			UpdatedAt: now,
		}

		if err := pg.InsertEnrollment(r.Context(), enrollment); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to create enrollment: %v", err), logger)
			return
		}

		if redis != nil {
			redis.InvalidateAllEnrollments(r.Context())
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"enrollment":       enrollment,
			"policy_number":    enrollmentID,
			"premium_amount":   product.Premium,
			"coverage_amount":  product.CoverageAmount,
			"next_premium_due": enrollment.NextPaymentDue,
			"channel":          req.Channel,
		})
	}
}

func getEnrollmentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		enrollment, err := pg.GetEnrollment(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "enrollment not found", logger)
			return
		}

		json.NewEncoder(w).Encode(enrollment)
	}
}

func cancelEnrollmentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		enrollment, err := pg.GetEnrollment(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "enrollment not found", logger)
			return
		}

		if enrollment.Status == models.EnrollmentCancelled {
			writeError(w, http.StatusBadRequest, "enrollment already cancelled", logger)
			return
		}

		if err := pg.UpdateEnrollmentStatus(r.Context(), id, string(models.EnrollmentCancelled)); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to cancel enrollment", logger)
			return
		}

		enrollment.Status = models.EnrollmentCancelled
		enrollment.UpdatedAt = time.Now().UTC()

		if redis != nil {
			redis.InvalidateEnrollment(r.Context(), id)
		}

		json.NewEncoder(w).Encode(map[string]any{
			"enrollment":   enrollment,
			"message":      "policy cancelled successfully",
			"cancellation": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ---------- Claims ----------

func listClaimsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		status := r.URL.Query().Get("status")
		customerID := r.URL.Query().Get("customer_id")
		enrollmentID := r.URL.Query().Get("enrollment_id")
		limit := parseIntQuery(r.URL.Query().Get("limit"), defaultLimit)
		offset := parseIntQuery(r.URL.Query().Get("offset"), defaultOffset)
		if limit > 100 {
			limit = 100
		}

		claims, total, err := pg.ListClaims(r.Context(), status, customerID, enrollmentID, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list claims", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"claims":  claims,
			"total":   total,
			"limit":   limit,
			"offset":  offset,
		})
	}
}

func createClaimHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			EnrollmentID    string  `json:"enrollment_id"`
			CustomerID      string  `json:"customer_id"`
			Type            string  `json:"type"`
			Description     string  `json:"description"`
			ClaimAmount     float64 `json:"claim_amount"`
			Documents       int     `json:"documents_submitted"`
			ParametricValue float64 `json:"parametric_value,omitempty"`
			ParametricType  string  `json:"parametric_type,omitempty"`
			ProductID       string  `json:"product_id"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.EnrollmentID == "" || req.CustomerID == "" || req.Type == "" {
			writeError(w, http.StatusBadRequest, "enrollment_id, customer_id, and type are required", logger)
			return
		}

		enrollment, err := pg.GetEnrollment(r.Context(), req.EnrollmentID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "enrollment not found", logger)
			return
		}

		if enrollment.Status != models.EnrollmentActive {
			writeError(w, http.StatusBadRequest, "enrollment is not active", logger)
			return
		}

		claimID := fmt.Sprintf("CLM-%s", generateID())
		now := time.Now().UTC()

		// Auto-approve low-value claims
		autoApproved := false
		if req.ClaimAmount <= claimAutoApproveLimit && req.Documents >= 1 {
			autoApproved = true
		}

		claim := &models.Claim{
			ID:                 generateID(),
			ClaimID:            claimID,
			EnrollmentID:       enrollment.ID,
			ProductID:          req.ProductID,
			CustomerID:         req.CustomerID,
			Type:               models.ClaimType(req.Type),
			Description:        req.Description,
			ClaimAmount:        req.ClaimAmount,
			SettlementAmount:   req.ClaimAmount,
			Status:             models.ClaimSubmitted,
			DocumentsRequired:  3,
			DocumentsSubmitted: req.Documents,
			ParametricValue:    req.ParametricValue,
			ParametricTrigger:  req.ParametricType,
			CreatedAt:          now,
			UpdatedAt:          now,
		}

		if autoApproved {
			claim.Status = models.ClaimApproved
			claim.SettlementAmount = req.ClaimAmount
			claim.ApprovedBy = "auto-approval"
			approvedAt := time.Now().UTC()
			claim.ApprovedAt = &approvedAt
		}

		if _, err := pg.InsertClaim(r.Context(), claim); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create claim", logger)
			return
		}

		if redis != nil {
			redis.InvalidateClaim(r.Context(), claimID)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"claim":         claim,
			"auto_approved": autoApproved,
			"message":       "claim filed successfully",
		})
	}
}

func getClaimHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		if redis != nil {
			if data, err := redis.GetCachedClaim(r.Context(), id); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}

		claim, err := pg.GetClaim(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "claim not found", logger)
			return
		}

		json.NewEncoder(w).Encode(claim)
	}
}

func approveClaimHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		claimID := chi.URLParam(r, "id")

		claim, err := pg.GetClaim(r.Context(), claimID)
		if err != nil {
			writeError(w, http.StatusNotFound, "claim not found", logger)
			return
		}

		if claim.Status == models.ClaimPaid || claim.Status == models.ClaimSettled {
			writeError(w, http.StatusBadRequest, "claim already finalized", logger)
			return
		}

		now := time.Now().UTC()
		claim.Status = models.ClaimApproved
		claim.ApprovedBy = extractRequester(r)
		claim.ApprovedAt = &now
		claim.UpdatedAt = now

		if err := pg.UpdateClaimStatus(r.Context(), claim.ID, claim); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to approve claim", logger)
			return
		}

		if redis != nil {
			redis.InvalidateClaim(r.Context(), claimID)
		}

		json.NewEncoder(w).Encode(claim)
	}
}

func rejectClaimHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			RejectReason string `json:"reject_reason"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)

		claimID := chi.URLParam(r, "id")

		claim, err := pg.GetClaim(r.Context(), claimID)
		if err != nil {
			writeError(w, http.StatusNotFound, "claim not found", logger)
			return
		}

		if req.RejectReason == "" {
			writeError(w, http.StatusBadRequest, "reject_reason is required", logger)
			return
		}

		now := time.Now().UTC()
		claim.Status = models.ClaimRejected
		claim.RejectReason = req.RejectReason
		claim.RejectedAt = &now
		claim.UpdatedAt = now

		if err := pg.UpdateClaimStatus(r.Context(), claim.ID, claim); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to reject claim", logger)
			return
		}

		if redis != nil {
			redis.InvalidateClaim(r.Context(), claimID)
		}

		json.NewEncoder(w).Encode(claim)
	}
}

// ---------- Groups ----------

func listGroupsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		status := r.URL.Query().Get("status")
		limit := parseIntQuery(r.URL.Query().Get("limit"), defaultLimit)
		offset := parseIntQuery(r.URL.Query().Get("offset"), defaultOffset)
		if limit > 100 {
			limit = 100
		}

		groups, total, err := pg.ListGroupPolicies(r.Context(), status, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list groups", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"groups": groups,
			"total":  total,
			"limit":  limit,
			"offset": offset,
		})
	}
}

func createGroupHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			GroupID          string    `json:"group_id"`
			GroupName        string    `json:"group_name"`
			ProductID        string    `json:"product_id"`
			GroupLeader      string    `json:"group_leader"`
			MemberCount      int       `json:"member_count"`
			Members          []string  `json:"members,omitempty"`
			PremiumPerMember float64   `json:"premium_per_member"`
			StartDate        string    `json:"start_date"`
			EndDate          string    `json:"end_date"`
			Metadata         map[string]any `json:"metadata,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.GroupID == "" || req.GroupName == "" || req.ProductID == "" || req.GroupLeader == "" {
			writeError(w, http.StatusBadRequest, "group_id, group_name, product_id, and group_leader are required", logger)
			return
		}

		product, err := pg.GetProduct(r.Context(), req.ProductID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "product not found", logger)
			return
		}

		premium := req.PremiumPerMember
		if premium == 0 {
			premium = product.Premium
		}

		totalPremium := premium * float64(req.MemberCount)

		startDate := time.Now().UTC()
		endDate := startDate.AddDate(1, 0, 0)

		if req.StartDate != "" {
			if d, err := time.Parse("2006-01-02", req.StartDate); err == nil {
				startDate = d
			}
		}
		if req.EndDate != "" {
			if d, err := time.Parse("2006-01-02", req.EndDate); err == nil {
				endDate = d
			}
		}

		group := &models.GroupPolicy{
			ID:               generateID(),
			GroupID:          req.GroupID,
			GroupName:        req.GroupName,
			ProductID:        product.ID,
			ProductType:      product.Type,
			GroupLeader:      req.GroupLeader,
			MemberCount:      req.MemberCount,
			EnrolledCount:    len(req.Members),
			PremiumPerMember: premium,
			TotalPremium:     totalPremium,
			Status:           "active",
			StartDate:        startDate,
			EndDate:          endDate,
			Metadata:         req.Metadata,
			CreatedAt:        time.Now().UTC(),
		}

		if err := pg.InsertGroupPolicy(r.Context(), group); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create group", logger)
			return
		}

		if redis != nil {
			redis.InvalidateGroup(r.Context(), req.GroupID)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(group)
	}
}

func getGroupHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		id := chi.URLParam(r, "id")

		group, err := pg.GetGroupPolicy(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "group not found", logger)
			return
		}

		json.NewEncoder(w).Encode(group)
	}
}

// ---------- Premium Schedule & Payments ----------

func premiumScheduleHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		days := parseIntQuery(r.URL.Query().Get("days"), 30)
		status := r.URL.Query().Get("status")

		schedule, err := pg.GetPremiumSchedule(r.Context(), time.Now().UTC(), days, status)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get premium schedule", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"schedule": schedule,
			"days":     days,
			"generated_at": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func recordPaymentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			EnrollmentID string         `json:"enrollment_id"`
			CustomerID   string         `json:"customer_id"`
			Amount       float64        `json:"amount"`
			Method       string         `json:"method"`
			Reference    string         `json:"reference"`
			PeriodFrom   string         `json:"period_from"`
			PeriodTo     string         `json:"period_to"`
			Metadata     map[string]any `json:"metadata,omitempty"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.EnrollmentID == "" || req.CustomerID == "" || req.Method == "" {
			writeError(w, http.StatusBadRequest, "enrollment_id, customer_id, and method are required", logger)
			return
		}

		enrollment, err := pg.GetEnrollment(r.Context(), req.EnrollmentID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "enrollment not found", logger)
			return
		}

		if enrollment.Status != models.EnrollmentActive {
			writeError(w, http.StatusBadRequest, "enrollment is not active", logger)
			return
		}

		paymentID := fmt.Sprintf("PAY-%s", generateID())
		now := time.Now().UTC()

		periodFrom := now
		periodTo := now.AddDate(0, 1, 0)
		if req.PeriodFrom != "" {
			if d, err := time.Parse("2006-01-02", req.PeriodFrom); err == nil {
				periodFrom = d
			}
		}
		if req.PeriodTo != "" {
			if d, err := time.Parse("2006-01-02", req.PeriodTo); err == nil {
				periodTo = d
			}
		}

		payment := &models.Micropayment{
			ID:           generateID(),
			PaymentID:    paymentID,
			EnrollmentID: enrollment.ID,
			CustomerID:   req.CustomerID,
			Amount:       req.Amount,
			Currency:     "NGN",
			Method:       req.Method,
			Status:       "completed",
			Reference:    req.Reference,
			PeriodFrom:   periodFrom,
			PeriodTo:     periodTo,
			PaidAt:       now,
			Metadata:     req.Metadata,
		}

		if err := pg.InsertMicropayment(r.Context(), payment); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to record payment", logger)
			return
		}

		if redis != nil {
			redis.InvalidateEnrollment(r.Context(), req.EnrollmentID)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"payment":     payment,
			"receipt_no":  paymentID,
			"status":      "payment_recorded",
		})
	}
}

// ---------- Parametric Triggers ----------

func listTriggersHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		productID := r.URL.Query().Get("product_id")
		triggered := r.URL.Query().Get("triggered")
		limit := parseIntQuery(r.URL.Query().Get("limit"), defaultLimit)
		offset := parseIntQuery(r.URL.Query().Get("offset"), defaultOffset)
		if limit > 100 {
			limit = 100
		}

		triggers, total, err := pg.ListParametricTriggers(r.Context(), productID, triggered, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list triggers", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"triggers": triggers,
			"total":    total,
			"limit":    limit,
			"offset":   offset,
		})
	}
}

func createTriggerHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req struct {
			ProductID     string  `json:"product_id"`
			TriggerType   string  `json:"trigger_type"`
			TriggerValue  float64 `json:"trigger_value"`
			Threshold     float64 `json:"threshold"`
			DataSource    string  `json:"data_source"`
			DataReference string  `json:"data_reference"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}

		if req.ProductID == "" || req.TriggerType == "" {
			writeError(w, http.StatusBadRequest, "product_id and trigger_type are required", logger)
			return
		}

		triggered := req.TriggerValue >= req.Threshold
		now := time.Now().UTC()

		trigger := &models.ParametricTrigger{
			ID:            generateID(),
			ProductID:     req.ProductID,
			TriggerType:   req.TriggerType,
			TriggerValue:  req.TriggerValue,
			Threshold:     req.Threshold,
			Triggered:     triggered,
			DataSource:    req.DataSource,
			DataReference: req.DataReference,
			CreatedAt:     now,
		}

		if triggered {
			t := time.Now().UTC()
			trigger.TriggeredAt = &t
		}

		if err := pg.InsertParametricTrigger(r.Context(), trigger); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create trigger", logger)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(trigger)
	}
}

// ---------- Metrics / Dashboard ----------

func metricsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		stats, err := pg.GetPolicyStats(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to compute metrics", logger)
			return
		}

		json.NewEncoder(w).Encode(map[string]any{
			"enrollment_stats": stats.EnrollmentStats,
			"claim_stats":      stats.ClaimStats,
			"revenue_stats":    stats.RevenueStats,
			"generated_at":     time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ---------- Helpers ----------

func writeError(w http.ResponseWriter, code int, message string, logger *zap.Logger) {
	logger.Warn("Error response", zap.Int("status", code), zap.String("message", message))
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{
		"error": message,
	})
}

func validateProduct(product models.MicroProduct) error {
	if product.ProductID == "" {
		return errors.New("product_id is required")
	}
	if product.Name == "" {
		return errors.New("name is required")
	}
	if product.Premium <= 0 {
		return errors.New("premium must be positive")
	}
	if product.CoverageAmount <= 0 {
		return errors.New("coverage_amount must be positive")
	}
	if product.MaxAge <= product.MinAge {
		return errors.New("max_age must be greater than min_age")
	}
	if product.Status != "" && product.Status != models.ProductActive && product.Status != models.ProductDraft && product.Status != models.ProductSuspended && product.Status != models.ProductRetired {
		return errors.New("invalid status")
	}
	return nil
}

func validateEnrollment(customerID, productID, channel string) error {
	if customerID == "" {
		return errors.New("customer_id is required")
	}
	if productID == "" {
		return errors.New("product_id is required")
	}
	if channel == "" {
		return errors.New("channel is required")
	}
	validChannels := map[string]bool{
		string(models.ChannelUSSD): true, string(models.ChannelAgent): true,
		string(models.ChannelMobile): true, string(models.ChannelWeb): true,
		string(models.ChannelMNO): true, string(models.ChannelGroup): true,
	}
	if !validChannels[channel] {
		return errors.New("invalid enrollment channel")
	}
	return nil
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func parseDuration(d string) time.Duration {
	switch strings.ToLower(d) {
	case "monthly":
		return 30 * 24 * time.Hour
	case "season", "per_season", "quarterly":
		return 90 * 24 * time.Hour
	case "biennial", "bi_yearly":
		return 730 * 24 * time.Hour
	case "yearly", "annual":
		return 365 * 24 * time.Hour
	default:
		return 30 * 24 * time.Hour
	}
}

func parseIntQuery(val string, fallback int) int {
	if val == "" {
		return fallback
	}
	var n int
	fmt.Sscanf(val, "%d", &n)
	if n < 0 {
		return fallback
	}
	return n
}

func extractRequester(r *http.Request) string {
	if v := r.Header.Get("X-Requester"); v != "" {
		return v
	}
	return "api"
}

func seedProducts(pg *db.Postgres, ctx context.Context, logger *zap.Logger) {
	existing, err := pg.ListProducts(ctx, "", "", 100, 0)
	if err == nil && len(existing) > 0 {
		return
	}

	now := time.Now().UTC()
	products := []*models.MicroProduct{
		{
			ID: generateID(), ProductID: "MIC-CROP", Name: "Crop Protection",
			Type: models.ProductCrop, Description: "Weather-indexed crop insurance for smallholder farmers",
			Premium: 500, Currency: "NGN", CoverageAmount: 50000, CoverageType: models.CoverageParametric,
			Duration: "per_season", ClaimSLA: "48h", MaxAge: 65, MinAge: 18, MaxSumInsured: 50000,
			WaitingPeriod: "0", ParametricTrigger: "rainfall_index",
			Exclusions: []string{"negligence", "unregistered_farmland"},
			Status: models.ProductActive, CreatedAt: now, UpdatedAt: now,
			Metadata: map[string]any{"region": "all", "per_season": true},
		},
		{
			ID: generateID(), ProductID: "MIC-HEALTH", Name: "Basic Health",
			Type: models.ProductHealth, Description: "Basic health coverage for primary care and emergencies",
			Premium: 200, Currency: "NGN", CoverageAmount: 100000, CoverageType: models.CoverageBenefit,
			Duration: "monthly", ClaimSLA: "24h", MaxAge: 65, MinAge: 18, MaxSumInsured: 100000,
			WaitingPeriod: "30",
			Exclusions: []string{"pre_existing", "cosmetic"},
			Status: models.ProductActive, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: generateID(), ProductID: "MIC-LIFE", Name: "Term Life",
			Type: models.ProductLife, Description: "Affordable term life coverage for families",
			Premium: 100, Currency: "NGN", CoverageAmount: 200000, CoverageType: models.CoverageBenefit,
			Duration: "monthly", ClaimSLA: "72h", MaxAge: 65, MinAge: 18, MaxSumInsured: 200000,
			WaitingPeriod: "0",
			Status: models.ProductActive, CreatedAt: now, UpdatedAt: now,
		},
		{
			ID: generateID(), ProductID: "MIC-DEVICE", Name: "Device Protection",
			Type: models.ProductDevice, Description: "Protection for mobile devices and electronics",
			Premium: 300, Currency: "NGN", CoverageAmount: 75000, CoverageType: models.CoverageIndemnity,
			Duration: "monthly", ClaimSLA: "48h", MaxAge: 65, MinAge: 18, MaxSumInsured: 75000,
			WaitingPeriod: "14",
			Exclusions: []string{"intentional_damage", "water_damage"},
			Status: models.ProductActive, CreatedAt: now, UpdatedAt: now,
		},
	}

	for _, p := range products {
		if err := pg.InsertProduct(ctx, p); err != nil {
			logger.Warn("Failed to seed product", zap.String("product_id", p.ProductID), zap.Error(err))
		}
	}

	if err == nil {
		logger.Info("Seeded default products", zap.Int("count", len(products)))
	}
}
