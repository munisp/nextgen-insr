// Package main is the entry point for the InsurePortal infra-go sidecar service.
// This service acts as a unified infrastructure bridge, exposing HTTP endpoints
// consumed by the TypeScript application layer for:
//   - TigerBeetle ledger operations (double-entry bookkeeping)
//   - Fluvio event streaming (produce/consume)
//   - Dapr pub/sub and service invocation
//   - Temporal workflow management
//   - PostgreSQL connection pool health
//   - Redis distributed lock management
//   - Permify authorization checks
//   - Keycloak token introspection
//   - APISIX admin API management
//   - Lakehouse (MinIO/S3) ETL operations
//   - OpenAppSec WAF policy management
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
	"github.com/go-chi/cors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"

	"github.com/insureportal/infra-go/internal/apisix"
	"github.com/insureportal/infra-go/internal/dapr"
	"github.com/insureportal/infra-go/internal/fluvio"
	"github.com/insureportal/infra-go/internal/keycloak"
	"github.com/insureportal/infra-go/internal/lakehouse"
	"github.com/insureportal/infra-go/internal/openappsec"
	"github.com/insureportal/infra-go/internal/permify"
	"github.com/insureportal/infra-go/internal/postgres"
	"github.com/insureportal/infra-go/internal/redis"
	"github.com/insureportal/infra-go/internal/temporal"
	"github.com/insureportal/infra-go/internal/tigerbeetle"
)

func main() {
	// ── Logger ────────────────────────────────────────────────────────────────
	logger, _ := zap.NewProduction()
	defer func() { _ = logger.Sync() }()

	port := getEnv("INFRA_GO_PORT", "8090")
	logger.Info("InsurePortal infra-go sidecar starting", zap.String("port", port))

	// ── Initialize all service clients ────────────────────────────────────────
	tbClient := tigerbeetle.NewClient(logger)
	fluvioClient := fluvio.NewClient(logger)
	daprClient := dapr.NewClient(logger)
	temporalClient := temporal.NewClient(logger)
	pgClient := postgres.NewClient(logger)
	redisClient := redis.NewClient(logger)
	permifyClient := permify.NewClient(logger)
	keycloakClient := keycloak.NewClient(logger)
	apisixClient := apisix.NewClient(logger)
	lakehouseClient := lakehouse.NewClient(logger)
	openappsecClient := openappsec.NewClient(logger)

	// ── Router ────────────────────────────────────────────────────────────────
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Internal-Key"},
		AllowCredentials: true,
	}))

	// Internal API key auth middleware
	r.Use(internalAuthMiddleware(logger))

	// ── Health ────────────────────────────────────────────────────────────────
	r.Get("/health", healthHandler(tbClient, fluvioClient, daprClient, temporalClient,
		pgClient, redisClient, permifyClient, keycloakClient, logger))
	r.Get("/metrics", promhttp.Handler().ServeHTTP)

	// ── TigerBeetle routes ────────────────────────────────────────────────────
	r.Route("/tigerbeetle", func(r chi.Router) {
		r.Post("/accounts", tbClient.CreateAccountsHandler)
		r.Post("/transfers", tbClient.CreateTransfersHandler)
		r.Get("/accounts/{id}", tbClient.GetAccountHandler)
		r.Post("/accounts/batch", tbClient.GetAccountsHandler)
		r.Get("/accounts/{id}/transfers", tbClient.GetAccountTransfersHandler)
		r.Post("/accounts/create-insurance", tbClient.CreateInsuranceAccountsHandler)
		r.Post("/transfers/premium", tbClient.RecordPremiumPaymentHandler)
		r.Post("/transfers/claim-payout", tbClient.RecordClaimPayoutHandler)
		r.Post("/transfers/commission", tbClient.RecordCommissionHandler)
		r.Post("/transfers/reinsurance-cession", tbClient.RecordReinsuranceCessionHandler)
		r.Get("/ledger/balance/{tenantId}", tbClient.GetTenantLedgerBalanceHandler)
	})

	// ── Fluvio routes ─────────────────────────────────────────────────────────
	r.Route("/fluvio", func(r chi.Router) {
		r.Post("/produce", fluvioClient.ProduceHandler)
		r.Post("/produce/batch", fluvioClient.ProduceBatchHandler)
		r.Get("/topics", fluvioClient.ListTopicsHandler)
		r.Get("/topics/{topic}/stats", fluvioClient.TopicStatsHandler)
		r.Post("/topics", fluvioClient.CreateTopicHandler)
		r.Get("/consumer-groups", fluvioClient.ListConsumerGroupsHandler)
		r.Get("/health", fluvioClient.HealthHandler)
	})

	// ── Dapr routes ───────────────────────────────────────────────────────────
	r.Route("/dapr", func(r chi.Router) {
		r.Post("/publish", daprClient.PublishHandler)
		r.Post("/invoke/{appId}/{method}", daprClient.InvokeHandler)
		r.Post("/state/{storeName}", daprClient.SaveStateHandler)
		r.Get("/state/{storeName}/{key}", daprClient.GetStateHandler)
		r.Delete("/state/{storeName}/{key}", daprClient.DeleteStateHandler)
		r.Post("/bindings/{bindingName}", daprClient.InvokeBindingHandler)
		r.Get("/secrets/{storeName}/{key}", daprClient.GetSecretHandler)
		r.Get("/health", daprClient.HealthHandler)
	})

	// ── Temporal routes ───────────────────────────────────────────────────────
	r.Route("/temporal", func(r chi.Router) {
		r.Post("/workflows/start", temporalClient.StartWorkflowHandler)
		r.Post("/workflows/signal", temporalClient.SignalWorkflowHandler)
		r.Post("/workflows/cancel", temporalClient.CancelWorkflowHandler)
		r.Get("/workflows/{workflowId}", temporalClient.GetWorkflowHandler)
		r.Get("/workflows/{workflowId}/history", temporalClient.GetWorkflowHistoryHandler)
		r.Post("/workflows/query", temporalClient.QueryWorkflowHandler)
		r.Get("/task-queues/{taskQueue}/stats", temporalClient.GetTaskQueueStatsHandler)
		r.Get("/health", temporalClient.HealthHandler)
	})

	// ── PostgreSQL routes ─────────────────────────────────────────────────────
	r.Route("/postgres", func(r chi.Router) {
		r.Get("/health", pgClient.HealthHandler)
		r.Get("/pool/stats", pgClient.PoolStatsHandler)
		r.Post("/query", pgClient.QueryHandler)
		r.Post("/exec", pgClient.ExecHandler)
		r.Post("/migrate", pgClient.MigrateHandler)
	})

	// ── Redis routes ──────────────────────────────────────────────────────────
	r.Route("/redis", func(r chi.Router) {
		r.Get("/health", redisClient.HealthHandler)
		r.Post("/lock", redisClient.AcquireLockHandler)
		r.Delete("/lock/{key}", redisClient.ReleaseLockHandler)
		r.Post("/set", redisClient.SetHandler)
		r.Get("/get/{key}", redisClient.GetHandler)
		r.Delete("/del/{key}", redisClient.DeleteHandler)
		r.Post("/pipeline", redisClient.PipelineHandler)
	})

	// ── Permify routes ────────────────────────────────────────────────────────
	r.Route("/permify", func(r chi.Router) {
		r.Post("/check", permifyClient.CheckHandler)
		r.Post("/check/batch", permifyClient.BatchCheckHandler)
		r.Post("/relationships/write", permifyClient.WriteRelationshipHandler)
		r.Post("/relationships/delete", permifyClient.DeleteRelationshipHandler)
		r.Get("/relationships/read", permifyClient.ReadRelationshipsHandler)
		r.Post("/schema/write", permifyClient.WriteSchemaHandler)
		r.Get("/schema/read", permifyClient.ReadSchemaHandler)
	})

	// ── Keycloak routes ───────────────────────────────────────────────────────
	r.Route("/keycloak", func(r chi.Router) {
		r.Post("/token/introspect", keycloakClient.IntrospectTokenHandler)
		r.Post("/token/refresh", keycloakClient.RefreshTokenHandler)
		r.Get("/users/{userId}", keycloakClient.GetUserHandler)
		r.Post("/users/{userId}/roles", keycloakClient.AssignRoleHandler)
		r.Delete("/users/{userId}/roles/{roleName}", keycloakClient.RemoveRoleHandler)
		r.Get("/users/{userId}/roles", keycloakClient.GetUserRolesHandler)
		r.Post("/users", keycloakClient.CreateUserHandler)
		r.Put("/users/{userId}", keycloakClient.UpdateUserHandler)
		r.Post("/users/{userId}/logout", keycloakClient.LogoutUserHandler)
	})

	// ── APISIX routes ─────────────────────────────────────────────────────────
	r.Route("/apisix", func(r chi.Router) {
		r.Get("/routes", apisixClient.ListRoutesHandler)
		r.Post("/routes", apisixClient.CreateRouteHandler)
		r.Put("/routes/{routeId}", apisixClient.UpdateRouteHandler)
		r.Delete("/routes/{routeId}", apisixClient.DeleteRouteHandler)
		r.Get("/upstreams", apisixClient.ListUpstreamsHandler)
		r.Post("/upstreams", apisixClient.CreateUpstreamHandler)
		r.Get("/plugins", apisixClient.ListPluginsHandler)
		r.Get("/health", apisixClient.HealthHandler)
	})

	// ── Lakehouse routes ──────────────────────────────────────────────────────
	r.Route("/lakehouse", func(r chi.Router) {
		r.Post("/snapshot", lakehouseClient.CreateSnapshotHandler)
		r.Get("/snapshots", lakehouseClient.ListSnapshotsHandler)
		r.Get("/snapshots/{key}", lakehouseClient.GetSnapshotHandler)
		r.Post("/export/policies", lakehouseClient.ExportPoliciesHandler)
		r.Post("/export/claims", lakehouseClient.ExportClaimsHandler)
		r.Post("/export/premiums", lakehouseClient.ExportPremiumsHandler)
		r.Post("/export/actuarial", lakehouseClient.ExportActuarialHandler)
		r.Get("/buckets", lakehouseClient.ListBucketsHandler)
		r.Post("/buckets", lakehouseClient.CreateBucketHandler)
		r.Get("/health", lakehouseClient.HealthHandler)
	})

	// ── OpenAppSec routes ─────────────────────────────────────────────────────
	r.Route("/openappsec", func(r chi.Router) {
		r.Get("/policy", openappsecClient.GetPolicyHandler)
		r.Put("/policy", openappsecClient.UpdatePolicyHandler)
		r.Get("/threats", openappsecClient.GetThreatsHandler)
		r.Post("/threats/report", openappsecClient.ReportThreatHandler)
		r.Get("/health", openappsecClient.HealthHandler)
	})

	// ── Start server ──────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		logger.Info("infra-go sidecar listening", zap.String("addr", srv.Addr))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	<-quit
	logger.Info("Shutting down infra-go sidecar...")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Close all clients
	tbClient.Close()
	fluvioClient.Close()
	daprClient.Close()
	temporalClient.Close()
	pgClient.Close()
	redisClient.Close()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("Forced shutdown", zap.Error(err))
	}
	logger.Info("infra-go sidecar stopped cleanly")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func internalAuthMiddleware(logger *zap.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth for health and metrics endpoints
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			apiKey := getEnv("INTERNAL_API_KEY", "insureportal-internal-dev-key")
			if r.Header.Get("X-Internal-Key") != apiKey {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func healthHandler(
	tb *tigerbeetle.Client,
	fl *fluvio.Client,
	dp *dapr.Client,
	tm *temporal.Client,
	pg *postgres.Client,
	rd *redis.Client,
	pm *permify.Client,
	kc *keycloak.Client,
	logger *zap.Logger,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		status := map[string]string{
			"tigerbeetle": tb.Ping(ctx),
			"fluvio":      fl.Ping(ctx),
			"dapr":        dp.Ping(ctx),
			"temporal":    tm.Ping(ctx),
			"postgres":    pg.Ping(ctx),
			"redis":       rd.Ping(ctx),
			"permify":     pm.Ping(ctx),
			"keycloak":    kc.Ping(ctx),
		}

		allOK := true
		for _, v := range status {
			if v != "ok" {
				allOK = false
				break
			}
		}

		w.Header().Set("Content-Type", "application/json")
		if !allOK {
			w.WriteHeader(http.StatusServiceUnavailable)
		}

		fmt.Fprintf(w, `{"status":"%s","services":%s}`,
			map[bool]string{true: "ok", false: "degraded"}[allOK],
			toJSON(status))
	}
}

func toJSON(m map[string]string) string {
	out := "{"
	i := 0
	for k, v := range m {
		if i > 0 {
			out += ","
		}
		out += fmt.Sprintf(`"%s":"%s"`, k, v)
		i++
	}
	return out + "}"
}
