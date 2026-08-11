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
	"github.com/insureportal/policy_workflow_go/config"
	"github.com/insureportal/policy_workflow_go/db"
	"github.com/insureportal/policy_workflow_go/internal/handlers"
	appmiddleware "github.com/insureportal/policy_workflow_go/internal/middleware"
	"github.com/insureportal/policy_workflow_go/internal/service"
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

	log.Info("Policy Workflow Engine starting up")

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

	policySvc := service.NewPolicyService(pg, rdb, cfg)
	h := handlers.NewHandlers(policySvc)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(appmiddleware.CORSMiddleware())
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.RealIP)

	r.Get(cfg.HealthCheckPath, h.HealthCheck)
	r.Get("/ready", h.ReadinessCheck)

	r.Group(func(api chi.Router) {
		api.Use(appmiddleware.APIKeyAuth)

		// Policies
		api.Post("/api/v1/policies", h.CreatePolicy)
		api.Get("/api/v1/policies", h.ListPolicies)
		api.Get("/api/v1/policies/by-id", h.GetPolicy)
		api.Get("/api/v1/policies/by-number", h.GetPolicyByNumber)

		// State Machine
		api.Post("/api/v1/workflow/transition", h.TransitionPolicy)
		api.Get("/api/v1/workflow/valid-transitions", h.GetValidTransitions)

		// Underwriting
		api.Post("/api/v1/underwriting/start", h.StartUnderwriting)
		api.Get("/api/v1/underwriting/record", h.GetUnderwritingRecord)

		// Renewals
		api.Post("/api/v1/renewals", h.CreateRenewal)
		api.Post("/api/v1/renewals/process", h.ProcessRenewal)
		api.Get("/api/v1/renewals", h.GetRenewals)

		// Endorsements
		api.Post("/api/v1/endorsements", h.CreateEndorsement)
		api.Get("/api/v1/endorsements", h.GetEndorsements)

		// Lapse Management
		api.Post("/api/v1/lapses/check", h.CheckLapses)

		// Cancellation
		api.Post("/api/v1/policies/cancel", h.CancelPolicy)

		// Dashboard
		api.Get("/api/v1/dashboard", h.GetDashboard)
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
		log.Info("Starting Policy Workflow server", zap.String("address", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down Policy Workflow server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced shutdown", zap.Error(err))
	}
	log.Info("Policy Workflow server stopped")
}
