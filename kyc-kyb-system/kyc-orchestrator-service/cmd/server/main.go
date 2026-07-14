package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"

	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/audit"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/bridge"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/cache"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/events"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/gateway"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/handlers"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/middleware"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/repository"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/services"
	"github.com/munisp/NGApp/kyc-kyb-system/kyc-orchestrator-service/internal/workflows"
)

func main() {
	logger, _ := zap.NewProduction()
	defer logger.Sync()

	port := getEnv("PORT", "8085")
	livenessURL := getEnv("LIVENESS_ENGINE_URL", "http://localhost:8110")
	ocrURL := getEnv("OCR_ENGINE_URL", "http://localhost:8111")
	identityMatcherURL := getEnv("IDENTITY_MATCHER_URL", "http://localhost:8112")

	// PostgreSQL Persistence
	pgConnStr := getEnv("POSTGRES_URL", "postgres://localhost:5432/kyc_db?sslmode=disable")
	pgRepo, err := repository.NewPostgresRepository(logger, pgConnStr)
	if err != nil {
		logger.Warn("postgres_init_failed_using_memory", zap.Error(err))
	} else {
		defer pgRepo.Close()
		logger.Info("postgres_connected")
	}

	// Redis Cache
	redisAddr := getEnv("REDIS_URL", "localhost:6379")
	redisCache, err := cache.NewRedisCache(logger, redisAddr)
	if err != nil {
		logger.Warn("redis_init_failed", zap.Error(err))
	} else {
		defer redisCache.Close()
		logger.Info("redis_connected")
	}

	// Kafka Event Bus
	kafkaBrokers := strings.Split(getEnv("KAFKA_BROKERS", "localhost:9092"), ",")
	kafkaProducer, err := events.NewKafkaProducer(logger, kafkaBrokers)
	if err != nil {
		logger.Warn("kafka_producer_init_failed", zap.Error(err))
	} else {
		defer kafkaProducer.Close()
		logger.Info("kafka_producer_ready")
	}

	// Temporal Workflow Engine
	temporalHost := getEnv("TEMPORAL_HOST", "localhost:7233")
	_, err = workflows.NewTemporalClient(logger, temporalHost)
	if err != nil {
		logger.Warn("temporal_init_failed", zap.Error(err))
	} else {
		logger.Info("temporal_client_ready")
	}

	// OpenSearch Audit Trail
	opensearchURL := getEnv("OPENSEARCH_URL", "http://localhost:9200")
	auditor, err := audit.NewOpenSearchAuditor(logger, opensearchURL)
	if err != nil {
		logger.Warn("opensearch_init_failed", zap.Error(err))
	} else {
		logger.Info("opensearch_auditor_ready")
	}

	// APISix Gateway + OpenAppSec WAF
	apisixURL := getEnv("APISIX_ADMIN_URL", "http://localhost:9180")
	gw, err := gateway.NewAPISixGateway(logger, apisixURL)
	if err != nil {
		logger.Warn("apisix_init_failed", zap.Error(err))
	} else {
		if err := gw.SetupOpenAppSecPlugin(context.Background()); err != nil {
			logger.Warn("openappsec_setup_failed", zap.Error(err))
		}
		logger.Info("apisix_gateway_ready")
	}

	// Mojaloop Mobile Money Bridge
	mojaloopURL := getEnv("MOJALOOP_URL", "http://localhost:3000")
	mojaBridge, err := bridge.NewMojaloopBridge(logger, mojaloopURL)
	if err != nil {
		logger.Warn("mojaloop_init_failed", zap.Error(err))
	} else {
		logger.Info("mojaloop_bridge_ready")
	}

	// Keycloak Auth
	keycloakMW := middleware.NewKeycloakMiddleware(logger, middleware.KeycloakConfig{
		RealmURL:     getEnv("KEYCLOAK_REALM_URL", "http://localhost:8180/realms/insurance"),
		ClientID:     getEnv("KEYCLOAK_CLIENT_ID", "kyc-service"),
		ClientSecret: getEnv("KEYCLOAK_CLIENT_SECRET", ""),
		AdminURL:     getEnv("KEYCLOAK_ADMIN_URL", "http://localhost:8180"),
	})

	// Permify Authorization
	permifyClient := middleware.NewPermifyClient(
		logger,
		getEnv("PERMIFY_URL", "http://localhost:3476"),
		getEnv("PERMIFY_TENANT", "insurance-platform"),
	)
	if err := permifyClient.SetupKYCSchema(context.Background()); err != nil {
		logger.Warn("permify_schema_failed", zap.Error(err))
	}

	// Core Services
	kycService := services.NewKYCService(logger, livenessURL, ocrURL, identityMatcherURL)
	kybService := services.NewKYBService(logger)
	amlService := services.NewAMLService(logger)

	kycHandler := handlers.NewKYCHandler(kycService, amlService)
	kybHandler := handlers.NewKYBHandler(kybService)

	r := gin.Default()
	r.Use(corsMiddleware())
	r.Use(auditMiddleware(logger, auditor))

	startTime := time.Now()

	// Health endpoints
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"status":         "healthy",
			"version":        "2.0.0",
			"service":        "kyc-orchestrator",
			"uptime_seconds": time.Since(startTime).Seconds(),
			"middleware": gin.H{
				"postgres":   pgRepo != nil,
				"redis":      redisCache != nil,
				"kafka":      kafkaProducer != nil,
				"opensearch": auditor != nil,
				"apisix":     gw != nil,
				"mojaloop":   mojaBridge != nil,
				"keycloak":   true,
				"permify":    permifyClient != nil,
			},
		})
	})
	r.GET("/ready", func(c *gin.Context) {
		c.JSON(200, gin.H{"ready": true})
	})

	// KYC routes
	kyc := r.Group("/api/v1/kyc")
	{
		kyc.POST("/start", kycHandler.StartVerification)
		kyc.GET("/session/:sessionId", kycHandler.GetVerification)
		kyc.GET("/user/:userId", kycHandler.GetUserVerifications)
		kyc.POST("/document", kycHandler.SubmitDocument)
		kyc.POST("/selfie", kycHandler.SubmitSelfie)
		kyc.POST("/verify/nin", kycHandler.VerifyNIN)
		kyc.POST("/verify/bvn", kycHandler.VerifyBVN)
		kyc.POST("/verify/phone", kycHandler.VerifyPhone)
		kyc.POST("/review", kycHandler.ReviewDecision)
		kyc.GET("/events/:sessionId", kycHandler.GetEvents)
		kyc.POST("/aml/screen", kycHandler.AMLScreen)
		kyc.GET("/risk/:sessionId", kycHandler.AssessRisk)

		// KYC gate endpoint for platform-wide enforcement
		kyc.GET("/gate/:userId", func(c *gin.Context) {
			userID := c.Param("userId")

			if redisCache != nil {
				allowed, level, err := redisCache.GetKYCGate(c.Request.Context(), userID)
				if err == nil && level > 0 {
					if kafkaProducer != nil {
						kafkaProducer.PublishGateEvent(c.Request.Context(), userID, allowed, "cache_hit")
					}
					c.JSON(200, gin.H{"allowed": allowed, "level": level, "source": "cache", "user_id": userID, "timestamp": time.Now()})
					return
				}
			}

			verifications, _ := kycService.GetUserVerifications(userID)
			allowed := false
			level := 0
			for _, v := range verifications {
				if v.Status == "approved" && int(v.Level) > level {
					level = int(v.Level)
					allowed = true
				}
			}

			if redisCache != nil {
				redisCache.SetKYCGate(c.Request.Context(), userID, allowed, level, 5*time.Minute)
			}
			if kafkaProducer != nil {
				reason := "no_approved_verification"
				if allowed {
					reason = fmt.Sprintf("level_%d_approved", level)
				}
				kafkaProducer.PublishGateEvent(c.Request.Context(), userID, allowed, reason)
			}

			c.JSON(200, gin.H{"allowed": allowed, "level": level, "source": "database", "user_id": userID, "timestamp": time.Now()})
		})

		// Transfer limits based on KYC level (Mojaloop)
		kyc.GET("/transfer-limits/:level", func(c *gin.Context) {
			if mojaBridge == nil {
				c.JSON(200, gin.H{"limits": bridge.KYCTransferLimits})
				return
			}
			levelStr := c.Param("level")
			level := 0
			fmt.Sscanf(levelStr, "%d", &level)
			limits := mojaBridge.GetTransferLimits(level)
			c.JSON(200, gin.H{"limits": limits})
		})

		// Validate transfer against KYC (Mojaloop)
		kyc.POST("/validate-transfer", func(c *gin.Context) {
			var transfer bridge.KYCGatedTransfer
			if err := c.ShouldBindJSON(&transfer); err != nil {
				c.JSON(400, gin.H{"error": err.Error()})
				return
			}
			if mojaBridge == nil {
				c.JSON(200, gin.H{"status": "approved", "kyc_check": gin.H{"passed": true, "reason": "mojaloop_not_configured"}})
				return
			}
			result, err := mojaBridge.ValidateKYCForTransfer(c.Request.Context(), transfer)
			if err != nil {
				c.JSON(500, gin.H{"error": err.Error()})
				return
			}
			c.JSON(200, result)
		})
	}

	// KYB routes
	kyb := r.Group("/api/v1/kyb")
	{
		kyb.POST("/start", kybHandler.StartVerification)
		kyb.GET("/session/:sessionId", kybHandler.GetVerification)
		kyb.POST("/verify/cac/:sessionId", kybHandler.VerifyCAC)
		kyb.POST("/verify/tin/:sessionId", kybHandler.VerifyTIN)
		kyb.POST("/director", kybHandler.AddDirector)
		kyb.POST("/ubo", kybHandler.AddUBO)
		kyb.POST("/document", kybHandler.SubmitDocument)
		kyb.POST("/review", kybHandler.ReviewDecision)
		kyb.GET("/events/:sessionId", kybHandler.GetEvents)
	}

	// Middleware status endpoint
	r.GET("/api/v1/middleware/status", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"postgres":     pgRepo != nil,
			"redis":        redisCache != nil,
			"kafka":        kafkaProducer != nil,
			"temporal":     true,
			"opensearch":   auditor != nil,
			"apisix":       gw != nil,
			"mojaloop":     mojaBridge != nil,
			"keycloak":     keycloakMW != nil,
			"permify":      permifyClient != nil,
			"deepface":     livenessURL,
			"paddleocr":    ocrURL,
			"identity":     identityMatcherURL,
		})
	})

	logger.Info("kyc_orchestrator_starting",
		zap.String("port", port),
		zap.String("version", "2.0.0"),
		zap.Bool("postgres", pgRepo != nil),
		zap.Bool("redis", redisCache != nil),
		zap.Bool("kafka", kafkaProducer != nil),
		zap.Bool("opensearch", auditor != nil),
	)

	if err := r.Run(fmt.Sprintf(":%s", port)); err != nil {
		logger.Fatal("server_failed", zap.Error(err))
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-KYC-Session-ID, X-Request-ID")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func auditMiddleware(logger *zap.Logger, auditor *audit.OpenSearchAuditor) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		duration := time.Since(start)

		if auditor != nil && strings.Contains(c.Request.URL.Path, "/kyc") {
			entry := audit.AuditEntry{
				ID:            fmt.Sprintf("audit-%d", time.Now().UnixNano()),
				SessionID:     c.GetHeader("X-KYC-Session-ID"),
				UserID:        c.GetString("user_id"),
				Action:        c.Request.Method + " " + c.Request.URL.Path,
				Actor:         c.GetString("user_id"),
				IPAddress:     c.ClientIP(),
				UserAgent:     c.Request.UserAgent(),
				RequestMethod: c.Request.Method,
				RequestPath:   c.Request.URL.Path,
				StatusCode:    c.Writer.Status(),
				DurationMs:    int(duration.Milliseconds()),
				Timestamp:     time.Now(),
			}
			go auditor.IndexAuditEntry(context.Background(), entry)
		}
	}
}
