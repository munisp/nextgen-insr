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
	"github.com/insureportal/enterprise_mdm/config"
	"github.com/insureportal/enterprise_mdm/db"
	"github.com/insureportal/enterprise_mdm/internal/handlers"
	"github.com/insureportal/enterprise_mdm/internal/middleware"
	"github.com/insureportal/enterprise_mdm/internal/service"
	"go.uber.org/zap"
)

func main() {
	logger, err := zap.NewProduction()
	if err != nil {
		panic(fmt.Sprintf("Failed to init logger: %v", err))
	}
	defer logger.Sync()
	zap.ReplaceGlobals(logger)
	log := zap.L()

	log.Info("Enterprise MDM starting up")

	cfg, err := config.Load()
	if err != nil {
		log.Fatal("Failed to load config", zap.Error(err))
	}
	log.Info("Configuration loaded", zap.String("env", cfg.Env), zap.Int("port", cfg.Port))

	pg, err := db.NewPostgreSQL(cfg)
	if err != nil {
		log.Fatal("Failed to init PostgreSQL", zap.Error(err))
	}
	defer pg.Close()
	log.Info("PostgreSQL initialized")

	rdb, err := db.NewRedisCache(cfg)
	if err != nil {
		log.Warn("Redis not available, running without cache", zap.Error(err))
		rdb = &db.RedisCache{}
	}
	defer rdb.Close()
	log.Info("Redis initialized")

	mdmSvc := service.NewMDMService(pg, rdb, cfg)
	h := handlers.NewHandlers(mdmSvc)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.CORSMiddleware())
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.RealIP)

	r.Get(cfg.HealthCheckPath, h.HealthCheck)
	r.Get("/ready", h.ReadinessCheck)

	r.Group(func(api chi.Router) {
		api.Use(middleware.APIKeyAuth)

		// Golden Records
		api.Post("/api/v1/golden-records", h.CreateGoldenRecord)
		api.Get("/api/v1/golden-records", h.ListGoldenRecords)
		api.Get("/api/v1/golden-records/by-id", h.GetGoldenRecord)

		// Record Sources
		api.Post("/api/v1/record-sources/link", h.LinkRecordSource)
		api.Get("/api/v1/record-sources", h.GetRecordSources)

		// Deduplication
		api.Post("/api/v1/deduplicate", h.FindDuplicates)
		api.Post("/api/v1/deduplicate/approve", h.ApproveMerge)

		// Data Quality
		api.Post("/api/v1/quality/assess", h.AssessQuality)
		api.Post("/api/v1/quality/issues", h.CreateDataIssue)
		api.Get("/api/v1/quality/issues", h.GetOpenIssues)
		api.Post("/api/v1/quality/issues/resolve", h.ResolveIssue)
		api.Get("/api/v1/quality-score", h.GetDataQualityScore)

		// Sync
		api.Post("/api/v1/sync/start", h.StartSync)
		api.Get("/api/v1/sync/recent", h.GetRecentSyncs)

		// Dashboard
		api.Get("/api/v1/dashboard", h.GetDashboard)

		// Agent Records
		api.Post("/api/v1/agents", h.CreateAgentRecord)
		api.Get("/api/v1/agents", h.ListAgentRecords)
		api.Get("/api/v1/agents/by-code", h.GetAgentRecord)

		// Product Records
		api.Post("/api/v1/products", h.CreateProductRecord)
		api.Get("/api/v1/products", h.ListProductRecords)
		api.Get("/api/v1/products/by-code", h.GetProductRecord)
	})

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Info("Starting Enterprise MDM server", zap.String("address", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down Enterprise MDM server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced shutdown", zap.Error(err))
	}
	log.Info("Enterprise MDM server stopped")
}
