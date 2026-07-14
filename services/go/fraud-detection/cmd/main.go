package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/munisp/ngapp/services/fraud-detection/internal/handler"
	"github.com/munisp/ngapp/services/fraud-detection/internal/scoring"
	"github.com/munisp/ngapp/services/fraud-detection/internal/store"
)

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize PostgreSQL store
	db, err := store.NewPostgres(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	// Initialize Redis cache
	cache, err := store.NewRedis(os.Getenv("REDIS_URL"))
	if err != nil {
		log.Fatalf("failed to connect to redis: %v", err)
	}
	defer cache.Close()

	// Initialize fraud scoring engine
	engine := scoring.NewEngine(db, cache)

	// Initialize Kafka consumer for claim events
	kafkaConsumer, err := store.NewKafkaConsumer(
		os.Getenv("KAFKA_BROKERS"),
		"fraud-detection-group",
		[]string{"claims.submitted", "claims.updated"},
	)
	if err != nil {
		log.Fatalf("failed to create kafka consumer: %v", err)
	}
	defer kafkaConsumer.Close()

	// Start consuming claim events in background
	go engine.ConsumeClaimEvents(ctx, kafkaConsumer)

	// HTTP server
	router := gin.New()
	router.Use(gin.Recovery())

	h := handler.New(engine, db)
	api := router.Group("/api/v1/fraud")
	{
		api.POST("/score", h.ScoreClaim)
		api.GET("/score/:claimId", h.GetClaimScore)
		api.GET("/patterns", h.ListFraudPatterns)
		api.POST("/patterns", h.CreateFraudPattern)
		api.GET("/network/:userId", h.GetFraudNetwork)
		api.GET("/stats", h.GetFraudStats)
		api.POST("/report", h.SubmitFraudReport)
		api.PUT("/threshold", h.UpdateThreshold)
	}

	// Health endpoints
	router.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "healthy", "service": "fraud-detection"})
	})
	router.GET("/health/ready", func(c *gin.Context) {
		if err := db.Ping(ctx); err != nil {
			c.JSON(503, gin.H{"status": "not ready", "error": err.Error()})
			return
		}
		c.JSON(200, gin.H{"status": "ready"})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		log.Printf("fraud-detection service starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen error: %v", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("server shutdown error: %v", err)
	}
	log.Println("fraud-detection service stopped")
}
