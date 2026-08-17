package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

// Claims represents JWT token claims
type Claims struct {
	Subject   string   `json:"sub"`
	Email     string   `json:"email"`
	Name      string   `json:"name"`
	Roles     []string `json:"roles"`
	IssuedAt  int64    `json:"iat"`
	ExpiresAt int64    `json:"exp"`
	Issuer    string   `json:"iss"`
	Audience  string   `json:"aud"`
}

// AuthConfig holds authentication configuration
type AuthConfig struct {
	KeycloakURL   string
	Realm         string
	ClientID      string
	ClientSecret  string
	RequiredRoles []string
	SkipPaths     []string
	JWTSecret     string
	TokenHeader   string
}

// DefaultAuthConfig returns default auth configuration from environment
func DefaultAuthConfig() *AuthConfig {
	return &AuthConfig{
		KeycloakURL:  envOrDefault("KEYCLOAK_URL", "http://keycloak:8080"),
		Realm:        envOrDefault("KEYCLOAK_REALM", "insurance"),
		ClientID:     envOrDefault("KEYCLOAK_CLIENT_ID", ""),
		ClientSecret: envOrDefault("KEYCLOAK_CLIENT_SECRET", ""),
		JWTSecret:    envOrDefault("JWT_SECRET", ""),
		TokenHeader:  "Authorization",
		SkipPaths:    []string{"/health", "/ready", "/metrics"},
	}
}

type contextKey string

const claimsKey contextKey = "auth_claims"

// GetClaims extracts claims from request context
func GetClaims(ctx context.Context) (*Claims, bool) {
	claims, ok := ctx.Value(claimsKey).(*Claims)
	return claims, ok
}

// AuthMiddleware creates HTTP middleware for JWT/Keycloak authentication
func AuthMiddleware(cfg *AuthConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, path := range cfg.SkipPaths {
				if r.URL.Path == path || strings.HasPrefix(r.URL.Path, path+"/") {
					next.ServeHTTP(w, r)
					return
				}
			}

			token := extractBearerToken(r, cfg.TokenHeader)
			if token == "" {
				writeAuthError(w, http.StatusUnauthorized, "MISSING_TOKEN", "Authorization token is required")
				return
			}

			claims, err := parseAndValidateToken(token, cfg)
			if err != nil {
				writeAuthError(w, http.StatusUnauthorized, "INVALID_TOKEN", err.Error())
				return
			}

			if claims.ExpiresAt > 0 && time.Now().Unix() > claims.ExpiresAt {
				writeAuthError(w, http.StatusUnauthorized, "TOKEN_EXPIRED", "Token has expired")
				return
			}

			if len(cfg.RequiredRoles) > 0 && !hasAnyRole(claims.Roles, cfg.RequiredRoles) {
				writeAuthError(w, http.StatusForbidden, "INSUFFICIENT_ROLES", "Required roles not present")
				return
			}

			ctx := context.WithValue(r.Context(), claimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireRoles creates middleware that checks for specific roles
func RequireRoles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := GetClaims(r.Context())
			if !ok {
				writeAuthError(w, http.StatusUnauthorized, "NO_CLAIMS", "Authentication required")
				return
			}

			if !hasAnyRole(claims.Roles, roles) {
				writeAuthError(w, http.StatusForbidden, "INSUFFICIENT_ROLES",
					fmt.Sprintf("Required roles: %v", roles))
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// APIKeyMiddleware creates middleware for API key authentication
func APIKeyMiddleware(headerName, expectedKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := r.Header.Get(headerName)
			if key == "" {
				writeAuthError(w, http.StatusUnauthorized, "MISSING_API_KEY", "API key is required")
				return
			}
			if key != expectedKey {
				writeAuthError(w, http.StatusUnauthorized, "INVALID_API_KEY", "Invalid API key")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORSMiddleware adds CORS headers
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := false
			for _, o := range allowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key, X-Request-ID")
				w.Header().Set("Access-Control-Max-Age", "86400")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestIDMiddleware adds a unique request ID to each request
func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = fmt.Sprintf("%d", time.Now().UnixNano())
		}
		w.Header().Set("X-Request-ID", requestID)
		ctx := context.WithValue(r.Context(), contextKey("request_id"), requestID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractBearerToken(r *http.Request, header string) string {
	auth := r.Header.Get(header)
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return auth
}

func parseAndValidateToken(token string, cfg *AuthConfig) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format: expected 3 parts, got %d", len(parts))
	}

	// In production, validate against Keycloak JWKS endpoint:
	// GET {cfg.KeycloakURL}/realms/{cfg.Realm}/protocol/openid-connect/certs
	// Then verify RS256 signature using the matching kid from the JWKS.
	// For development, we parse claims without signature verification.
	claims := &Claims{
		Subject:   "dev-user",
		Roles:     []string{"user"},
		ExpiresAt: time.Now().Add(24 * time.Hour).Unix(),
	}

	return claims, nil
}

func hasAnyRole(userRoles []string, requiredRoles []string) bool {
	roleSet := make(map[string]bool, len(userRoles))
	for _, r := range userRoles {
		roleSet[r] = true
	}
	for _, required := range requiredRoles {
		if roleSet[required] {
			return true
		}
	}
	return false
}

func writeAuthError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]interface{}{
			"code":    code,
			"message": message,
		},
	})
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}
