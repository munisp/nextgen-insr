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
	"github.com/insureportal/notification_service/config"
	"github.com/insureportal/notification_service/db"
	"github.com/insureportal/notification_service/internal/handlers"
	appmw "github.com/insureportal/notification_service/internal/middleware"
	"github.com/insureportal/notification_service/internal/service"
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

	log.Info("Notification Service starting up")

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

	notifSvc := service.NewNotificationService(pg, rdb, cfg)
	h := handlers.NewHandlers(notifSvc)

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(appmw.CORSMiddleware())
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)
	r.Use(middleware.RealIP)

	r.Get(cfg.HealthCheckPath, h.HealthCheck)
	r.Get("/ready", h.ReadinessCheck)
	r.Get("/live", h.LivenessCheck)

	r.Group(func(api chi.Router) {
		api.Use(appmw.APIKeyAuth)

		// Send notification
		api.Post("/api/v1/send", h.SendNotification)

		// Templates
		api.Get("/api/v1/templates", h.ListTemplates)
		api.Get("/api/v1/templates/by-code", h.GetTemplate)
		api.Post("/api/v1/templates", h.CreateTemplate)

		// Delivery tracking
		api.Get("/api/v1/delivery-stats", h.GetDeliveryStats)
		api.Get("/api/v1/delivery-stats/daily", h.GetDeliveryStatsDaily)
		api.Get("/api/v1/delivery-attempts", h.GetDeliveryAttempts)
		api.Post("/api/v1/delivery/retry", h.RetryNotification)

		// Dashboard
		api.Get("/api/v1/dashboard", h.GetDashboard)

		// Customer preferences
		api.Get("/api/v1/preferences", h.GetCustomerPreference)
		api.Post("/api/v1/preferences", h.UpdateCustomerPreference)

		// Notification history
		api.Get("/api/v1/notifications", h.GetNotificationsByCustomer)

		// Channel status
		api.Get("/api/v1/channels/status", h.GetChannelStatus)
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
		log.Info("Starting Notification server", zap.String("address", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal("Server failed", zap.Error(err))
		}
	}()

	<-ctx.Done()
	log.Info("Shutting down Notification server...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error("Server forced shutdown", zap.Error(err))
	}
	log.Info("Notification server stopped")
}
