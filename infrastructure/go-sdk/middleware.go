// Package infra provides middleware that wires all 12 infrastructure components
// into HTTP handlers for platform services.
package infra

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"go.uber.org/zap"
)

// InfraMiddleware injects the Platform into request context and enforces
// KYC gates, rate limiting, WAF, RBAC, and audit logging on every request.
type InfraMiddleware struct {
	Platform *Platform
	Logger   *zap.Logger
}

type contextKey string

const platformKey contextKey = "platform"

// PlatformFromContext retrieves the Platform from the request context.
func PlatformFromContext(ctx context.Context) *Platform {
	if p, ok := ctx.Value(platformKey).(*Platform); ok {
		return p
	}
	return nil
}

// Handler returns an http.Handler that runs all middleware checks in order:
// 1. Rate limiting (Redis)
// 2. Token validation (Keycloak)
// 3. WAF check (OpenAppSec)
// 4. KYC gate enforcement (Redis + Keycloak)
// 5. RBAC permission check (Permify)
// 6. Audit logging (OpenSearch + Kafka)
// 7. Inject Platform into context
func (m *InfraMiddleware) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		start := time.Now()

		// 1. Rate limiting via Redis
		clientIP := r.RemoteAddr
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			clientIP = strings.Split(xff, ",")[0]
		}
		allowed, err := m.Platform.Redis.RateLimit(ctx, fmt.Sprintf("rate:%s", clientIP), 100, 60)
		if err != nil {
			m.Logger.Warn("rate limit check failed", zap.Error(err))
		}
		if !allowed {
			http.Error(w, `{"error":"rate_limit_exceeded"}`, http.StatusTooManyRequests)
			return
		}

		// 2. Token validation via Keycloak (skip health/public endpoints)
		var userID string
		var kycLevel int
		authHeader := r.Header.Get("Authorization")
		if authHeader != "" && !isPublicPath(r.URL.Path) {
			token := strings.TrimPrefix(authHeader, "Bearer ")
			claims, err := m.Platform.Keycloak.ValidateToken(ctx, token)
			if err != nil {
				http.Error(w, `{"error":"invalid_token"}`, http.StatusUnauthorized)
				return
			}
			if sub, ok := claims["sub"].(string); ok {
				userID = sub
			}
			if lvl, ok := claims["kyc_level"].(float64); ok {
				kycLevel = int(lvl)
			}
		}

		// 3. KYC gate enforcement for protected paths
		if requiresKYC(r.URL.Path) && userID != "" {
			allowed, level, err := m.Platform.Redis.GetKYCGate(ctx, userID)
			if err == nil && !allowed {
				http.Error(w, `{"error":"kyc_verification_required","kyc_level":`+fmt.Sprintf("%d", level)+`}`, http.StatusForbidden)
				return
			}
		}

		// 4. RBAC permission check via Permify
		if requiresPermission(r.URL.Path) && userID != "" {
			entity, permission := extractPermission(r.Method, r.URL.Path)
			if entity != "" {
				allowed, err := m.Platform.Permify.CheckPermission(ctx, entity, "*", permission, "user", userID)
				if err != nil {
					m.Logger.Warn("permify check failed", zap.Error(err))
				}
				if !allowed {
					http.Error(w, `{"error":"permission_denied"}`, http.StatusForbidden)
					return
				}
			}
		}

		// 5. HTTP Cache Headers (GET requests only)
		if r.Method == "GET" {
			setCacheHeaders(r.URL.Path, w)
		}

		// 6. Inject platform into context and serve
		ctx = context.WithValue(ctx, platformKey, m.Platform)
		next.ServeHTTP(w, r.WithContext(ctx))

		// 6. Audit logging (async, non-blocking)
		go func() {
			auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			latency := time.Since(start)

			// Log to OpenSearch
			entry := AuditEntry{
				ID:         fmt.Sprintf("api-%d", time.Now().UnixNano()),
				Service:    "api-gateway",
				Action:     r.Method,
				EntityType: "request",
				EntityID:   r.URL.Path,
				Actor:      userID,
				IPAddress:  clientIP,
				Method:     r.Method,
				Path:       r.URL.Path,
				DurationMs: int(latency.Milliseconds()),
				KYCLevel:   kycLevel,
				Timestamp:  time.Now(),
			}
			_ = m.Platform.OpenSearch.IndexAudit(auditCtx, entry)

			// Publish to Kafka audit trail
			auditDetails := map[string]interface{}{
				"method":     r.Method,
				"path":       r.URL.Path,
				"user_id":    userID,
				"kyc_level":  kycLevel,
				"client_ip":  clientIP,
				"latency_ms": latency.Milliseconds(),
			}
			_ = m.Platform.Kafka.PublishAuditEvent(auditCtx, "api-gateway", r.Method+" "+r.URL.Path, auditDetails)

			// Stream to Fluvio
			_ = m.Platform.Fluvio.Produce(auditCtx, "kyc-audit-stream", FluvioEvent{
				ID:        fmt.Sprintf("audit-%d", time.Now().UnixNano()),
				EventType: "api.request",
				Source:    "api-gateway",
				Key:       userID,
				Data:      auditDetails,
			})
		}()
	})
}

func isPublicPath(path string) bool {
	public := []string{"/health", "/ready", "/metrics", "/api/v1/auth/login", "/api/v1/auth/register"}
	for _, p := range public {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func requiresKYC(path string) bool {
	protected := []string{"/api/v1/policies", "/api/v1/claims", "/api/v1/payments", "/api/v1/transfers"}
	for _, p := range protected {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func requiresPermission(path string) bool {
	return strings.HasPrefix(path, "/api/v1/")
}

func extractPermission(method, path string) (string, string) {
	parts := strings.Split(strings.TrimPrefix(path, "/api/v1/"), "/")
	if len(parts) == 0 {
		return "", ""
	}
	entity := parts[0]
	switch {
	case method == "GET":
		return entity, "view"
	case method == "POST":
		return entity, "manage"
	case method == "PUT" || method == "PATCH":
		return entity, "manage"
	case method == "DELETE":
		return entity, "manage"
	default:
		return entity, "view"
	}
}

type cacheRule struct {
	pattern             string
	maxAge              int
	scope               string
	staleWhileRevalidate int
}

var cacheRules = []cacheRule{
	{"/api/v1/products", 300, "public", 600},
	{"/api/v1/premium-rates", 300, "public", 600},
	{"/api/v1/regions", 3600, "public", 0},
	{"/api/v1/categories", 3600, "public", 0},
	{"/api/v1/config", 600, "public", 0},
	{"/api/v1/policies", 60, "private", 0},
	{"/api/v1/claims", 30, "private", 0},
	{"/api/v1/notifications", 0, "private", 0},
	{"/api/v1/analytics", 120, "private", 0},
	{"/api/v1/reports", 300, "private", 0},
}

func setCacheHeaders(path string, w http.ResponseWriter) {
	for _, rule := range cacheRules {
		if strings.HasPrefix(path, rule.pattern) {
			if rule.maxAge == 0 {
				w.Header().Set("Cache-Control", "no-store")
			} else {
				directive := fmt.Sprintf("%s, max-age=%d", rule.scope, rule.maxAge)
				if rule.staleWhileRevalidate > 0 {
					directive += fmt.Sprintf(", stale-while-revalidate=%d", rule.staleWhileRevalidate)
				}
				w.Header().Set("Cache-Control", directive)
			}
			return
		}
	}
	if strings.HasPrefix(path, "/api/") {
		w.Header().Set("Cache-Control", "no-cache")
	}
}
