package main

import (
	"context"
	"fmt"
	"strconv"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/insureportal/fraud-detection-go/config"
	"github.com/insureportal/fraud-detection-go/db"
	"github.com/insureportal/fraud-detection-go/handler"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func main() {
	// Load and validate configuration
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "invalid config: %v\n", err)
		os.Exit(1)
	}

	// Initialize structured logger
	logger, err := zap.NewProduction()
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer logger.Sync()

	// Configure logger level from env
	if levelStr := os.Getenv("LOG_LEVEL"); levelStr != "" {
		if lvl, err := zapcore.ParseLevel(levelStr); err == nil {
			cfg := zap.NewProductionConfig()
			cfg.Level.SetLevel(lvl)
			logger, _ = cfg.Build()
		}
	}

	logger.Info("starting fraud-detection-go",
		zap.Int("port", cfg.Server.Port),
		zap.String("environment", cfg.Server.Environment),
	)

	// Connect to PostgreSQL
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	store, err := db.NewPostgresStore(
		ctx,
		cfg.Database.ConnectionString(),
		cfg.Database.MaxOpenConns,
		cfg.Database.MaxIdleConns,
		cfg.Database.ConnMaxLife,
		logger,
	)
	if err != nil {
		logger.Fatal("failed to connect to postgres", zap.Error(err))
	}
	defer store.Close()

	// Connect to Redis
	cache, err := db.NewRedisCache(cfg.Redis, logger)
	if err != nil {
		logger.Warn("failed to connect to redis — continuing without caching", zap.Error(err))
	}

	// Build HTTP service and router
	service := handler.NewService(cfg, store, cache, logger)
	r := setupRouter(service)

	// Create HTTP server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Server.Port),
		Handler:      r,
		ReadTimeout:  cfg.Server.ReadTimeout,
		WriteTimeout: cfg.Server.WriteTimeout,
		IdleTimeout:  cfg.Server.IdleTimeout,
	}

	// Start server in a goroutine
	go func() {
		logger.Info("server listening", zap.String("addr", server.Addr))
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	// Graceful shutdown on SIGINT/SIGTERM
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("server forced to shutdown", zap.Error(err))
	}

	logger.Info("server exited properly")
}

// setupRouter configures chi with middleware and routes.
func setupRouter(service *handler.Service) http.Handler {
	r := chi.NewRouter()

	// Core middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))

	// CORS for browser clients
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Requested-With"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Health and readiness
	r.Get("/health", service.HealthHandler)
	r.Get("/ready", service.ReadyHandler)

	// API v1 routes
	r.Group(func(api chi.Router) {
		api.Post("/score", service.ScoreHandler)

		api.Get("/history/{accountID}", service.HistoryHandler)

		api.Post("/fraud-cases", service.FraudCasesHandler)
		api.Get("/fraud-cases", service.FraudCasesHandler)

		api.Get("/rules", service.RulesHandler)
		api.Get("/stats", service.StatsHandler)

		api.Post("/accounts/{accountID}/block", service.BlockAccountHandler)
	})

	return r
}

// validateQueryParam returns the query parameter value for key, enforcing a
// maximum length. An absent parameter yields an empty string and no error.
func validateQueryParam(r *http.Request, key string, maxLen int) (string, error) {
	val := r.URL.Query().Get(key)
	if len(val) > maxLen {
		return "", fmt.Errorf("parameter %s exceeds max length %d", key, maxLen)
	}
	return val, nil
}

// validateIntParam parses the query parameter for key as an integer. An absent
// parameter yields 0 and no error; a non-integer value yields an error.
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
