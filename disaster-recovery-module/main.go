package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/insureportal/disaster_recovery_module/config"
	"github.com/insureportal/disaster_recovery_module/db"
	"github.com/insureportal/disaster_recovery_module/internal/handlers"
	appmw "github.com/insureportal/disaster_recovery_module/internal/middleware"
	"github.com/insureportal/disaster_recovery_module/internal/service"
	"go.uber.org/zap"
)

func main() {
	// Initialize logger
	logger, err := zap.NewProduction()
	if err != nil {
		panic(fmt.Sprintf("Failed to initialize logger: %v", err))
	}
	defer logger.Sync()

	zap.ReplaceGlobals(logger)
	log := zap.L()

	log.Info("Disaster Recovery Module starting up")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatal("Failed to load configuration", zap.Error(err))
	}

	log.Info("Configuration loaded",
		zap.String("environment", cfg.Env),
		zap.Int("port", cfg.Port),
		zap.String("primary_dc", cfg.PrimaryDC),
		zap.String("secondary_dc", cfg.SecondaryDC),
	)

	// Initialize database
	pg, err := db.NewPostgreSQL(cfg)
	if err != nil {
		log.Fatal("Failed to initialize PostgreSQL", zap.Error(err))
	}
	defer pg.Close()
	log.Info("PostgreSQL initialized")

	// Initialize Redis
	rdb, err := db.NewRedisCache(cfg)
	if err != nil {
		log.Warn("Redis not available, running without cache", zap.Error(err))
		// Create a no-op Redis cache for graceful degradation
		rdb = &db.RedisCache{}
	}
	defer rdb.Close()
	log.Info("Redis initialized")

	// Initialize services
	drService := service.NewDRService(pg, rdb, cfg)
	h := handlers.NewHandlers(drService)

	// Build router
	r := chi.NewRouter()

	// Core middleware
	r.Use(middleware.RequestID)
	r.Use(appmw.CORSMiddleware())
	r.Use(RecovererWithLogger(log))
	r.Use(LoggerWithConfig(log))
	r.Use(middleware.RealIP)
	r.Use(middleware.RequestID)

	// Health endpoints (no auth required)
	r.Get(cfg.HealthCheckPath, h.HealthCheck)
	r.Get("/ready", h.ReadinessCheck)

	// API v1 routes
	r.Group(func(api chi.Router) {
		api.Use(appmw.APIKeyAuth)

		// Dashboard
		api.Get("/api/v1/dashboard", h.GetDashboard)
		api.Get("/api/v1/status", h.GetDRStatus)
		api.Get("/api/v1/health-sync", h.SyncHealthSync)

		// Service registration
		api.Post("/api/v1/services/register", h.RegisterService)
		api.Post("/api/v1/services/heartbeat", h.UpdateHeartbeat)
		api.Get("/api/v1/services/protected", h.GetProtectedServices)

		// Failover
		api.Post("/api/v1/failover", h.TriggerFailover)
		api.Post("/api/v1/failover/complete", h.CompleteFailover)
		api.Get("/api/v1/failover/history", h.GetFailoverHistory)

		// DR Drills
		api.Post("/api/v1/drills", h.CreateDRDrill)
		api.Post("/api/v1/drills/complete", h.CompleteDRDrill)
		api.Get("/api/v1/drills/history", h.GetDRDrillHistory)

		// Backups
		api.Post("/api/v1/backups", h.CreateBackupStatus)
		api.Get("/api/v1/backups", h.GetBackupStatus)
		api.Get("/api/v1/backups/latest", h.GetLatestBackup)

		// RTO/RPO tracking
		api.Get("/api/v1/rto-rpo", h.GetRTOCompliance)
		api.Post("/api/v1/rto-rpo/metrics", h.RecordRTOMetric)

		// NAICOM notifications
		api.Post("/api/v1/naicom/notify", h.SendNAICOMNotification)
		api.Get("/api/v1/naicom/notifications", h.GetNAICOMNotifications)
	})

	// Metrics endpoint for Prometheus
	r.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
		// Simplified metrics endpoint
		w.Header().Set("Content-Type", "text/plain")
		fmt.Fprintf(w, "# HELP dr_services_total Total registered services\n")
		fmt.Fprintf(w, "# TYPE dr_services_total gauge\n")
		fmt.Fprintf(w, "dr_services_total 0\n")
		fmt.Fprintf(w, "# HELP dr_failovers_total Total failover events\n")
		fmt.Fprintf(w, "# TYPE dr_failovers_total counter\n")
		fmt.Fprintf(w, "dr_failovers_total 0\n")
	})

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in goroutine
	go func() {
		log.Info("Starting disaster recovery server",
			zap.String("address", srv.Addr),
			zap.String("environment", cfg.Env),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed to start", zap.Error(err))
		}
	}()

	// Wait for interrupt signal
	<-ctx.Done()
	log.Info("Shutting down disaster recovery server...")

	// Graceful shutdown with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced to shutdown", zap.Error(err))
	}

	log.Info("Disaster recovery server stopped gracefully")
}

// RecovererWithLogger returns chi middleware that logs panics
func RecovererWithLogger(log *zap.Logger) func(http.Handler) http.Handler {
	return middleware.Recoverer
}

// LoggerWithConfig returns chi middleware that logs with zap
func LoggerWithConfig(log *zap.Logger) func(http.Handler) http.Handler {
	return middleware.RequestLogger(&DefaultLogFormatter{log: log})
}

// DefaultLogFormatter implements middleware.LogFormatter
type DefaultLogFormatter struct {
	log *zap.Logger
}

func (l *DefaultLogFormatter) NewLogEntry(r *http.Request) middleware.LogEntry {
	return &DefaultLogEntry{log: l.log, request: r}
}

type DefaultLogEntry struct {
	log     *zap.Logger
	request *http.Request
}

func (e *DefaultLogEntry) Write(status, bytes int, header http.Header, elapsed time.Duration, extra interface{}) {
	// Simple key-value logging
	requestID, _ := e.request.Context().Value("request_id").(string)
	l := e.log.With(zap.String("request_id", requestID))
	// Log format: method path status remote_ip
	l.Info("request",
		zap.String("method", e.request.Method),
		zap.String("path", e.request.URL.Path),
	)
}

func (e *DefaultLogEntry) Panic(v interface{}, stack []byte) {
	e.log.Error("panic recovered", zap.Any("value", v), zap.ByteString("stack", stack))
}
