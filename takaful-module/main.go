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
	"github.com/insureportal/takaful_module/config"
	"github.com/insureportal/takaful_module/db"
	"github.com/insureportal/takaful_module/internal/handlers"
	appmw "github.com/insureportal/takaful_module/internal/middleware"
	"github.com/insureportal/takaful_module/internal/service"
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

	log.Info("Takaful Module starting up")

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

	takafulSvc := service.NewTakafulService(pg, rdb, cfg)
	h := handlers.NewHandlers(takafulSvc)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(appmw.CORSMiddleware())
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.RealIP)

	r.Get(cfg.HealthCheckPath, h.HealthCheck)
	r.Get("/ready", h.ReadinessCheck)

	r.Group(func(api chi.Router) {
		api.Use(appmw.APIKeyAuth)

		// Products (Shariah-compliant)
		api.Post("/api/v1/products", h.CreateProduct)
		api.Get("/api/v1/products", h.ListProducts)
		api.Get("/api/v1/products/by-id", h.GetProduct)

		// Participants
		api.Post("/api/v1/participants", h.RegisterParticipant)
		api.Get("/api/v1/participants", h.ListParticipants)
		api.Get("/api/v1/participants/by-id", h.GetParticipant)
		api.Post("/api/v1/participants/verify-kyc", h.VerifyKYC)

		// Contributions
		api.Post("/api/v1/contributions", h.MakeContribution)

		// Pools
		api.Get("/api/v1/pools", h.ListPools)
		api.Get("/api/v1/pools/by-id", h.GetPool)
		api.Get("/api/v1/pools/stats", h.GetPoolStats)

		// Claims
		api.Post("/api/v1/claims", h.CreateClaim)
		api.Post("/api/v1/claims/status", h.UpdateClaimStatus)
		api.Get("/api/v1/claims/by-id", h.GetClaim)
		api.Get("/api/v1/claims/by-participant", h.GetClaimsByParticipant)

		// Surplus Distribution
		api.Post("/api/v1/surplus/calculate", h.CalculateSurplus)

		// Zakat
		api.Post("/api/v1/zakat/calculate", h.CalculateZakat)

		// Retakaful
		api.Post("/api/v1/retakaful", h.CreateRetakafulEntry)

		// Pool Snapshot
		api.Post("/api/v1/pools/snapshot", h.CreatePoolSnapshot)
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
		log.Info("Starting Takaful server", zap.String("address", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down Takaful server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced shutdown", zap.Error(err))
	}
	log.Info("Takaful server stopped")
}
