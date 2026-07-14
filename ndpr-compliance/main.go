package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/insureportal/ndpr_compliance/config"
	"github.com/insureportal/ndpr_compliance/db"
	"github.com/insureportal/ndpr_compliance/models"
	"go.uber.org/zap"
)

// package-level state accessible to handlers
var (
	pkgCfg  *config.Config
	pkgPg   *db.Postgres
	pkgRedis *db.RedisCache
	pkgLog  *zap.Logger
)

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
	log.Printf("Connected to PostgreSQL for ndpr_compliance")

	// Create table if not exists
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS ndpr_compliance (
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
		logger.Warn("Redis not available (non-fatal)", zap.Error(err))
	}

	pkgCfg, pkgPg, pkgRedis, pkgLog = cfg, pg, redis, logger

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
		logger.Info("NDPR Compliance Service starting",
			zap.String("addr", srv.Addr),
			zap.String("service", "ndpr-compliance"))
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
		r.Post("/api/v1/consent", recordConsentHandler(pg, redis, logger))
		r.Get("/api/v1/consent/{subjectId}", getConsentsBySubjectHandler(pg, redis, logger))
		r.Get("/api/v1/consent/{consentId}", getConsentHandler(pg, redis, logger))
		r.Put("/api/v1/consent/{consentId}/withdraw", withdrawConsentHandler(pg, redis, logger))

		r.Post("/api/v1/dsar", submitDSARHandler(pg, redis, logger))
		r.Get("/api/v1/dsar/{id}", getDSARHandler(pg, redis, logger))
		r.Put("/api/v1/dsar/{id}/execute", executeDSARHandler(pg, redis, logger))
		r.Get("/api/v1/dsar/reporting", dsarReportingHandler(pg, redis, logger))

		r.Post("/api/v1/breach", reportBreachHandler(logger))
		r.Get("/api/v1/breach/{id}", getBreachHandler(pg, redis, logger))
		r.Put("/api/v1/breach/{id}/nitda-notify", markNITDANotifiedHandler(pg, redis, logger))
		r.Put("/api/v1/breach/{id}/complete", markBreachResolvedHandler(pg, redis, logger))

		r.Get("/api/v1/dpia", listDPIAsHandler(pg, redis, logger))
		r.Post("/api/v1/dpia", createDPIAHandler(pg, redis, logger))
		r.Put("/api/v1/dpia/{id}", updateDPIAHandler(pg, redis, logger))

		r.Get("/api/v1/retention/policies", listRetentionPoliciesHandler(pg, redis, logger))
		r.Put("/api/v1/retention/policies", upsertRetentionPolicyHandler(pg, redis, logger))

		r.Get("/api/v1/audit/report", auditReportHandler(pg, redis, logger))

		r.Get("/api/v1/metrics", metricsHandler(pg, redis, logger))
	})

	return r
}

// ========== Health & Readiness ==========

func healthHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "healthy",
			"service":   "ndpr-compliance",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

func readinessHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := pg.Pool.Ping(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "not_ready", "reason": "postgres_unavailable"})
			return
		}
		if redis != nil && redis.Client.Ping(r.Context()).Err() != nil {
			logger.Warn("Redis not available at readiness", zap.Error(redis.Client.Ping(r.Context()).Err()))
		}
		json.NewEncoder(w).Encode(map[string]string{
			"status":    "ready",
			"service":   "ndpr-compliance",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ========== Consent Handlers ==========

func recordConsentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			SubjectID     string            `json:"subject_id"`
			FullName      string            `json:"full_name"`
			Email         string            `json:"email"`
			Purposes      []string          `json:"purposes"`
			Method        string            `json:"method"`
			LawfulBasis   string            `json:"lawful_basis"`
			IPAddress     string            `json:"ip_address"`
			UserAgent     string            `json:"user_agent"`
			Version       string            `json:"version"`
			ConsentText   string            `json:"consent_text"`
			Metadata      map[string]any    `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if err := validateConsent(req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error(), logger)
			return
		}

		now := time.Now().UTC()
		consent := &models.Consent{
			ID:            generateID(),
			ConsentID:     fmt.Sprintf("CON-%s", generateID()),
			SubjectID:     req.SubjectID,
			Purposes:      parseStringSliceToPurposes(req.Purposes),
			Method:        parseConsentMethod(req.Method),
			LawfulBasis:   parseLawfulBasis(req.LawfulBasis),
			IPAddress:     req.IPAddress,
			UserAgent:     req.UserAgent,
			Version:       req.Version,
			ConsentText:   req.ConsentText,
			Withdrawn:     false,
			Metadata:      req.Metadata,
			CreatedAt:     now,
			UpdatedAt:     now,
		}

		if err := pg.InsertConsent(r.Context(), consent); err != nil {
			writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to record consent: %v", err), logger)
			return
		}
		if redis != nil {
			redis.InvalidateConsents(r.Context(), req.SubjectID)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(consent)
	}
}

func getConsentsBySubjectHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		subjectID := chi.URLParam(r, "subjectId")
		if redis != nil {
			if data, err := redis.GetConsents(r.Context(), subjectID); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}
		consents, err := pg.GetConsentsBySubject(r.Context(), subjectID)
		if err != nil {
			writeError(w, http.StatusNotFound, "no consents found for subject", logger)
			return
		}
		if redis != nil {
			data, _ := json.Marshal(consents)
			redis.CacheConsents(r.Context(), subjectID, data, db.TCacheMedium)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"subject_id": subjectID,
			"consents":   consents,
			"total":      len(consents),
			"active":     countField(consents, false),
			"withdrawn":  countField(consents, true),
		})
	}
}

func getConsentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		consentID := chi.URLParam(r, "consentId")
		consent, err := pg.GetConsent(r.Context(), consentID)
		if err != nil {
			writeError(w, http.StatusNotFound, "consent not found", logger)
			return
		}
		json.NewEncoder(w).Encode(consent)
	}
}

func withdrawConsentHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			WithdrawnBy    string `json:"withdrawn_by"`
			WithdrawalReason string `json:"withdrawal_reason"`
		}
		json.NewDecoder(r.Body).Decode(&req)

		consentID := chi.URLParam(r, "consentId")
		consent, err := pg.GetConsent(r.Context(), consentID)
		if err != nil {
			writeError(w, http.StatusNotFound, "consent not found", logger)
			return
		}
		if consent.Withdrawn {
			writeError(w, http.StatusBadRequest, "consent already withdrawn", logger)
			return
		}
		if err := pg.WithdrawConsent(r.Context(), consentID, req.WithdrawnBy, req.WithdrawalReason); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to withdraw consent", logger)
			return
		}

		consent.Withdrawn = true
		now := time.Now().UTC()
		consent.WithdrawnAt = &now
		consent.WithdrawnBy = req.WithdrawnBy
		consent.WithdrawalReason = req.WithdrawalReason
		consent.UpdatedAt = now

		if redis != nil {
			redis.InvalidateConsents(r.Context(), consent.SubjectID)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"consent":    consent,
			"withdrawn":  true,
			"withdrawn_at": now.Format(time.RFC3339),
		})
	}
}

// ========== DSAR Handlers ==========

func submitDSARHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			SubjectID   string   `json:"subject_id"`
			FullName    string   `json:"full_name"`
			Email       string   `json:"email"`
			Type        string   `json:"type"`
			Description string   `json:"description"`
			AssignedTo  string   `json:"assigned_to"`
			DataSources []string `json:"data_sources"`
			Metadata    map[string]any `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if req.SubjectID == "" || req.Type == "" {
			writeError(w, http.StatusBadRequest, "subject_id and type are required", logger)
			return
		}

		slaDays := getSlaDays(req.Type)
		receivedAt := time.Now().UTC()
		dsar := &models.DSAR{
			ID:            generateID(),
			DSARID:        fmt.Sprintf("DSAR-%s", generateID()),
			SubjectID:     req.SubjectID,
			FullName:      req.FullName,
			Email:         req.Email,
			Type:          parseDSARType(req.Type),
			Description:   req.Description,
			Status:        models.DSARReceived,
			SLADays:       slaDays,
			ReceivedAt:    receivedAt,
			Deadline:      receivedAt.AddDate(0, 0, slaDays),
			AssignedTo:    req.AssignedTo,
			DataSources:   req.DataSources,
			Metadata:      req.Metadata,
			CreatedAt:     receivedAt,
			UpdatedAt:     receivedAt,
		}

		if err := pg.InsertDSAR(r.Context(), dsar); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to submit DSAR", logger)
			return
		}
		if redis != nil {
			redis.InvalidateDSAR(r.Context(), dsar.DSARID)
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"dsar":    dsar,
			"sla_days": slaDays,
			"deadline": dsar.Deadline.Format("2006-01-02"),
		})
	}
}

func getDSARHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := chi.URLParam(r, "id")
		if redis != nil {
			if data, err := redis.GetDSAR(r.Context(), id); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}
		dsar, err := pg.GetDSAR(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "DSAR not found", logger)
			return
		}
		slaUsage := float64(0)
		totalHrs := dsar.Deadline.Sub(dsar.ReceivedAt).Hours()
		if totalHrs > 0 {
			slaUsage = (time.Since(dsar.ReceivedAt).Hours() / totalHrs) * 100
		}
		if redis != nil {
			data, _ := json.Marshal(dsar)
			redis.CacheDSAR(r.Context(), id, data, db.TCacheShort)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"dsar":          dsar,
			"sla_days":      dsar.SLADays,
			"sla_usage_pct": fmt.Sprintf("%.1f", slaUsage),
			"days_left":     max(0, int(time.Until(dsar.Deadline).Hours()/24)),
		})
	}
}

func executeDSARHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			Action        string `json:"action"`
			DataExportURL string `json:"data_export_url,omitempty"`
			RecordsFound  int    `json:"records_found"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		dsarID := chi.URLParam(r, "id")
		dsar, err := pg.GetDSAR(r.Context(), dsarID)
		if err != nil {
			writeError(w, http.StatusNotFound, "DSAR not found", logger)
			return
		}
		if dsar.Status == string(models.DSARCompleted) {
			writeError(w, http.StatusBadRequest, "DSAR already completed", logger)
			return
		}

		updates := map[string]interface{}{"records_found": req.RecordsFound}
		switch req.Action {
		case "export", "delete":
			updates["status"] = string(models.DSARCompleted)
			updates["completed_at"] = time.Now().UTC()
			if req.Action == "export" && req.DataExportURL != "" {
				updates["data_export_url"] = req.DataExportURL
			}
		case "rectify":
			updates["status"] = string(models.DSARInReview)
		default:
			writeError(w, http.StatusBadRequest, "unknown action: "+req.Action, logger)
			return
		}

		if err := pg.UpdateDSAR(r.Context(), dsarID, updates); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to execute DSAR", logger)
			return
		}
		dsar.UpdatedAt = time.Now().UTC()
		if redis != nil {
			redis.InvalidateDSAR(r.Context(), dsarID)
		}
		json.NewEncoder(w).Encode(map[string]any{"dsar": dsar, "action": req.Action, "status": string(dsar.Status)})
	}
}

func dsarReportingHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		stats, err := pg.GetDSARReporting(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get DSAR stats", logger)
			return
		}
		rows, err := pg.Pool.Query(r.Context(), `
			SELECT type, COUNT(*),
				COUNT(CASE WHEN status = 'completed' THEN 1 END),
				COUNT(CASE WHEN deadline < NOW() AND status NOT IN ('completed','denied') THEN 1 END)
			FROM dsars GROUP BY type`)
		if err != nil {
			rows.Close()
		} else {
			defer rows.Close()
		}
		typeBreakdown := []map[string]any{}
		for rows != nil && rows.Next() {
			var t string
			var total, completed, overdue int64
			if err := rows.Scan(&t, &total, &completed, &overdue); err == nil {
				typeBreakdown = append(typeBreakdown, map[string]any{"type": t, "total": total, "completed": completed, "overdue": overdue})
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"dsar_stats": stats, "type_breakdown": typeBreakdown, "generated_at": time.Now().UTC().Format(time.RFC3339)})
	}
}

// ========== Breach Handlers ==========

func reportBreachHandler(logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			Title            string   `json:"title"`
			Description      string   `json:"description"`
			Severity         string   `json:"severity"`
			DetectionDate    string   `json:"detection_date"`
			Reporter         string   `json:"reported_by"`
			AffectedPersons  int64    `json:"affected_persons"`
			DataTypes        []string `json:"data_types_affected"`
			Cause            string   `json:"cause"`
			RemediationSteps []string `json:"remediation_steps"`
			ImpactAssessment string   `json:"impact_assessment"`
			Metadata         map[string]any `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if req.Title == "" || req.Severity == "" {
			writeError(w, http.StatusBadRequest, "title and severity are required", logger)
			return
		}

		now := time.Now().UTC()
		detectionDate := now
		if req.DetectionDate != "" {
			if d, err := time.Parse("2006-01-02", req.DetectionDate); err == nil {
				detectionDate = d
			}
		}
		nitdaHrs := pkgCfg.NDPR.BreachNotificationHours
		breach := &models.Breach{
			ID:               generateID(),
			BreachID:         fmt.Sprintf("BRH-%s", generateID()),
			Title:            req.Title,
			Description:      req.Description,
			Severity:         parseBreachSeverity(req.Severity),
			Status:           models.BreachReported,
			DetectionDate:    detectionDate,
			ReportedAt:       now,
			Reporter:         req.Reporter,
			AffectedPersons:  req.AffectedPersons,
			DataTypes:        req.DataTypes,
			Cause:            req.Cause,
			NITDADeadline:    now.Add(time.Duration(nitdaHrs) * time.Hour),
			RemediationSteps: req.RemediationSteps,
			ImpactAssessment: req.ImpactAssessment,
			Metadata:         req.Metadata,
			CreatedAt:        now,
			UpdatedAt:        now,
		}

		if pkgPg != nil {
			if err := pkgPg.InsertBreach(r.Context(), breach); err != nil {
				writeError(w, http.StatusInternalServerError, "failed to report breach", logger)
				return
			}
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]any{
			"breach":                   breach,
			"nitda_notification_deadline": breach.NITDADeadline.Format(time.RFC3339),
			"hours_to_notify":          nitdaHrs,
		})
	}
}

func getBreachHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := chi.URLParam(r, "id")
		if redis != nil {
			if data, err := redis.GetBreach(r.Context(), id); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}
		breach, err := pg.GetBreach(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "breach not found", logger)
			return
		}
		if redis != nil {
			data, _ := json.Marshal(breach)
			redis.CacheBreach(r.Context(), id, data, db.TCacheShort)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"breach":              breach,
			"nitda_deadline":      breach.NITDADeadline.Format(time.RFC3339),
			"hours_until_deadline": max(0, int(time.Until(breach.NITDADeadline).Hours())),
			"sla_at_risk":         time.Until(breach.NITDADeadline).Hours() < 24,
		})
	}
}

func markNITDANotifiedHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			NotificationID string `json:"nitda_notification_id"`
		}
		json.NewDecoder(r.Body).Decode(&req)
		breachID := chi.URLParam(r, "id")
		_, err := pg.GetBreach(r.Context(), breachID)
		if err != nil {
			writeError(w, http.StatusNotFound, "breach not found", logger)
			return
		}
		now := time.Now().UTC()
		if err := pg.UpdateBreach(r.Context(), breachID, map[string]interface{}{
			"nitda_notified_at":     now,
			"nitda_notification_id": req.NotificationID,
			"status":                string(models.BreachNITDANotified),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to mark NITDA notified", logger)
			return
		}
		if redis != nil {
			redis.InvalidateBreach(r.Context(), breachID)
		}
		json.NewEncoder(w).Encode(map[string]any{
			"breach_id":         breachID,
			"nitda_notified":    true,
			"notified_at":       now.Format(time.RFC3339),
			"notification_id":   req.NotificationID,
		})
	}
}

func markBreachResolvedHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		breachID := chi.URLParam(r, "id")
		_, err := pg.GetBreach(r.Context(), breachID)
		if err != nil {
			writeError(w, http.StatusNotFound, "breach not found", logger)
			return
		}
		now := time.Now().UTC()
		if err := pg.UpdateBreach(r.Context(), breachID, map[string]interface{}{
			"remediation_complete": true,
			"resolution_date":      now,
			"status":               string(models.BreachResolved),
		}); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to mark breach resolved", logger)
			return
		}
		if redis != nil {
			redis.InvalidateBreach(r.Context(), breachID)
		}
		json.NewEncoder(w).Encode(map[string]any{"breach_id": breachID, "resolved": true, "resolved_at": now.Format(time.RFC3339)})
	}
}

// ========== DPIA Handlers ==========

func listDPIAsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := r.URL.Query().Get("status")
		riskLevel := r.URL.Query().Get("risk_level")
		limit := parseIntQuery(r.URL.Query().Get("limit"), 20)
		offset := parseIntQuery(r.URL.Query().Get("offset"), 0)
		if limit > 100 {
			limit = 100
		}
		dpias, total, err := pkgPg.ListDPIAs(r.Context(), status, riskLevel, limit, offset)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list DPIAs", logger)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"dpias": dpias, "total": total, "limit": limit, "offset": offset})
	}
}

func createDPIAHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			Title                     string            `json:"title"`
			Description               string            `json:"description"`
			ProcessingPurpose         string            `json:"processing_purpose"`
			DataController            string            `json:"data_controller"`
			DataProcessor             string            `json:"data_processor"`
			RiskLevel                 string            `json:"risk_level"`
			DataCategories            []string          `json:"data_categories"`
			Subjects                  []string          `json:"data_subjects"`
			NecessityAssessment       string            `json:"necessity_assessment"`
			ProportionalityAssessment string            `json:"proportionality_assessment"`
			Risks                     []string          `json:"risks"`
			Mitigations               []models.DPIAMitigation `json:"mitigations"`
			Metadata                  map[string]any    `json:"metadata,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if req.Title == "" || req.ProcessingPurpose == "" || req.DataController == "" {
			writeError(w, http.StatusBadRequest, "title, processing_purpose, and data_controller are required", logger)
			return
		}

		reviewMonths := pkgCfg.NDPR.DPIAReviewMonths
		if req.RiskLevel == string(models.RiskHigh) {
			reviewMonths = 6
		}

		now := time.Now().UTC()
		reviewDue := now.AddDate(0, reviewMonths, 0)

		dpia := &models.DPIA{
			ID:                        generateID(),
			DPIAID:                    fmt.Sprintf("DPIA-%s", generateID()),
			Title:                     req.Title,
			Description:               req.Description,
			ProcessingPurpose:         req.ProcessingPurpose,
			DataController:            req.DataController,
			DataProcessor:             req.DataProcessor,
			RiskLevel:                 parseDPiARiskLevel(req.RiskLevel),
			Status:                    models.DPIADraft,
			DataCategories:            req.DataCategories,
			Subjects:                  req.Subjects,
			NecessityAssessment:       req.NecessityAssessment,
			ProportionalityAssessment: req.ProportionalityAssessment,
			Risks:                     req.Risks,
			Mitigations:               req.Mitigations,
			ReviewDueDate:             &reviewDue,
			Metadata:                  req.Metadata,
			CreatedAt:                 now,
			UpdatedAt:                 now,
		}

		if err := pkgPg.InsertDPIA(r.Context(), dpia); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to create DPIA", logger)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dpia)
	}
}

func updateDPIAHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		id := chi.URLParam(r, "id")
		dpia, err := pkgPg.GetDPIA(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "DPIA not found", logger)
			return
		}

		var req struct {
			Title, Description, RiskLevel, Status string
			DataCategories, Risks                 []string
			DPOReviewed                           bool
			DPOReviewedAt, DPOComments            string
			ReviewDueDate                         string
		}
		json.NewDecoder(r.Body).Decode(&req)

		if req.Title != "" {
			dpia.Title = req.Title
		}
		if req.Description != "" {
			dpia.Description = req.Description
		}
		if req.RiskLevel != "" {
			dpia.RiskLevel = parseDPiARiskLevel(req.RiskLevel)
		}
		if req.Status != "" {
			dpia.Status = parseDPIAStatus(req.Status)
		}
		if req.DataCategories != nil {
			dpia.DataCategories = req.DataCategories
		}
		if req.Risks != nil {
			dpia.Risks = req.Risks
		}
		if req.DPOReviewed {
			dpia.DPOReviewed = true
			t := time.Now().UTC()
			dpia.DPOReviewedAt = &t
		}
		if req.DPOComments != "" {
			dpia.DPOComments = req.DPOComments
		}
		if req.ReviewDueDate != "" {
			if d, err := time.Parse("2006-01-02", req.ReviewDueDate); err == nil {
				dpia.ReviewDueDate = &d
			}
		}

		dpia.UpdatedAt = time.Now().UTC()
		if err := pkgPg.UpdateDPIA(r.Context(), dpia); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to update DPIA", logger)
			return
		}
		json.NewEncoder(w).Encode(dpia)
	}
}

// ========== Retention Policy Handlers ==========

func listRetentionPoliciesHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		policies, err := pkgPg.ListRetentionPolicies(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list retention policies", logger)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"policies": policies, "total": len(policies)})
	}
}

func upsertRetentionPolicyHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var req struct {
			Name, Description, DataCategory, RetentionPeriod, Action string
			AutoExecute                                              bool
			Exceptions                                               []string
			IsActive                                                 bool
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body", logger)
			return
		}
		if req.DataCategory == "" || req.RetentionPeriod == "" {
			writeError(w, http.StatusBadRequest, "data_category and retention_period are required", logger)
			return
		}
		action := req.Action
		if action == "" {
			action = "delete"
		}
		policy := &models.RetentionPolicy{
			ID:              generateID(),
			Name:            req.Name,
			Description:     req.Description,
			DataCategory:    req.DataCategory,
			RetentionPeriod: req.RetentionPeriod,
			Action:          action,
			AutoExecute:     req.AutoExecute,
			Exceptions:      req.Exceptions,
			IsActive:        req.IsActive,
			CreatedAt:       time.Now().UTC(),
			UpdatedAt:       time.Now().UTC(),
		}
		if err := pkgPg.UpsertRetentionPolicy(r.Context(), policy); err != nil {
			writeError(w, http.StatusInternalServerError, "failed to save retention policy", logger)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(policy)
	}
}

// ========== Audit Report Handler ==========

func auditReportHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		year := r.URL.Query().GetInt("year", 0)
		if year == 0 {
			year = time.Now().Year()
		}
		report, err := pkgPg.GenerateAuditReportData(r.Context(), year)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to generate audit report", logger)
			return
		}
		if err := pkgPg.CreateAuditReport(r.Context(), report); err != nil {
			logger.Warn("Failed to persist audit report", zap.Error(err))
		}
		json.NewEncoder(w).Encode(map[string]any{
			"report":           report,
			"overall_status":   report.OverallStatus,
			"compliance_score": report.OverallStatus,
			"generated_at":     time.Now().UTC().Format(time.RFC3339),
		})
	}
}

// ========== Metrics Handler ==========

func metricsHandler(pg *db.Postgres, redis *db.RedisCache, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if redis != nil {
			if data, err := redis.GetMetrics(r.Context()); err == nil && len(data) > 0 {
				json.NewEncoder(w).Encode(json.RawMessage(data))
				return
			}
		}
		metrics, err := pkgPg.GetComplianceMetrics(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to get compliance metrics", logger)
			return
		}
		if redis != nil {
			data, _ := json.Marshal(metrics)
			redis.CacheMetrics(r.Context(), data, db.TCacheMedium)
		}
		json.NewEncoder(w).Encode(metrics)
	}
}

// ========== Helpers ==========

func writeError(w http.ResponseWriter, code int, message string, logger *zap.Logger) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func validateConsent(req struct {
	SubjectID, Method, LawfulBasis, IPAddress, UserAgent, Version, ConsentText string
	Purposes                                   []string
	Metadata                                   map[string]any
}) error {
	if req.SubjectID == "" {
		return errors.New("subject_id is required")
	}
	if len(req.Purposes) == 0 {
		return errors.New("at least one purpose is required")
	}
	if req.ConsentText == "" {
		return errors.New("consent_text is required")
	}
	return nil
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func parseStringSliceToPurposes(src []string) []models.ConsentPurpose {
	dst := make([]models.ConsentPurpose, 0, len(src))
	for _, s := range src {
		dst = append(dst, models.ConsentPurpose(s))
	}
	return dst
}

func parseConsentMethod(s string) models.ConsentMethod {
	if s == "" {
		return models.ConsentWeb
	}
	return models.ConsentMethod(s)
}

func parseLawfulBasis(s string) models.LawfulBasis {
	if s == "" {
		return models.BasisConsent
	}
	return models.LawfulBasis(s)
}

func parseDSARType(s string) models.DSARType {
	return models.DSARType(s)
}

func parseBreachSeverity(s string) models.BreachSeverity {
	return models.BreachSeverity(s)
}

func parseDPiARiskLevel(s string) models.DPiARiskLevel {
	if s == "" {
		return models.RiskLow
	}
	return models.DPiARiskLevel(s)
}

func parseDPIAStatus(s string) models.DPIAStatus {
	if s == "" {
		return models.DPIADraft
	}
	return models.DPIAStatus(s)
}

func getSlaDays(dsarType string) int {
	switch dsarType {
	case "access":
		return 30
	case "rectification":
		return 14
	case "erasure":
		return 30
	case "portability":
		return 30
	default:
		return 30
	}
}

func countField(consents []*models.Consent, value bool) int {
	n := 0
	for _, c := range consents {
		if c.Withdrawn == value {
			n++
		}
	}
	return n
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
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
