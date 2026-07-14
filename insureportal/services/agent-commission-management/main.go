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
	"github.com/insureportal/agent_commission_management/config"
	"github.com/insureportal/agent_commission_management/db"
	"github.com/insureportal/agent_commission_management/internal/handlers"
	"github.com/insureportal/agent_commission_management/internal/middleware"
	"github.com/insureportal/agent_commission_management/internal/service"
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

	log.Info("Agent Commission Management starting up")

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

	commissionSvc := service.NewCommissionService(pg, rdb, cfg)
	h := handlers.NewHandlers(commissionSvc)

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

		// Commission calculation
		api.Post("/api/v1/commissions/calculate", h.CalculateCommission)
		api.Get("/api/v1/commissions", h.GetCommission)
		api.Get("/api/v1/commissions/by-policy", h.GetCommissionByPolicy)
		api.Get("/api/v1/commissions/by-agent", h.GetCommissionByAgent)

		// Payments
		api.Post("/api/v1/payments", h.ProcessPayment)
		api.Get("/api/v1/payments", h.GetPaymentRecords)

		// Agent profiles
		api.Post("/api/v1/agents", h.CreateAgentProfile)
		api.Get("/api/v1/agents", h.ListAgentProfiles)
		api.Get("/api/v1/agents/by-code", h.GetAgentProfile)

		// Period management
		api.Post("/api/v1/periods", h.CreateCommissionPeriod)
		api.Get("/api/v1/periods", h.GetCommissionPeriods)

		// Clawbacks
		api.Post("/api/v1/clawbacks", h.CreateClawback)
		api.Get("/api/v1/clawbacks/pending", h.GetPendingClawbacks)
		api.Post("/api/v1/clawbacks/process", h.ProcessClawback)

		// Adjustments
		api.Post("/api/v1/adjustments", h.CreateAdjustment)
		api.Get("/api/v1/adjustments", h.GetAdjustments)
		api.Post("/api/v1/adjustments/approve", h.ApproveAdjustment)

		// Reports
		api.Post("/api/v1/reports", h.CreateCommissionReport)
		api.Get("/api/v1/reports", h.GetCommissionReports)

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
		log.Info("Starting Agent Commission server", zap.String("address", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down Agent Commission server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced shutdown", zap.Error(err))
	}
	log.Info("Agent Commission server stopped")
}
