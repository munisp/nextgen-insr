package auth

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type KeycloakConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	Realm        string
}

func KeycloakConfigFromEnv() KeycloakConfig {
	return KeycloakConfig{
		IssuerURL:    envOr("KEYCLOAK_URL", "http://localhost:8180"),
		ClientID:     envOr("KEYCLOAK_CLIENT_ID", "ngapp"),
		ClientSecret: os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		Realm:        envOr("KEYCLOAK_REALM", "ngapp"),
	}
}

type Claims struct {
	jwt.RegisteredClaims
	RealmAccess   RealmAccess `json:"realm_access"`
	PreferredUser string      `json:"preferred_username"`
	Email         string      `json:"email"`
	TenantID      string      `json:"tenant_id"`
}

type RealmAccess struct {
	Roles []string `json:"roles"`
}

func (c *Claims) HasRole(role string) bool {
	for _, r := range c.RealmAccess.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type JWTMiddleware struct {
	cfg       KeycloakConfig
	jwksCache map[string]interface{}
	client    *http.Client
}

func NewJWTMiddleware(cfg KeycloakConfig) *JWTMiddleware {
	return &JWTMiddleware{
		cfg:    cfg,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (m *JWTMiddleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Dev bypass — ONLY allowed when NODE_ENV=development AND DEV_AUTH_BYPASS=true.
		// Blocked entirely in production to prevent accidental admin escalation.
		if os.Getenv("DEV_AUTH_BYPASS") == "true" && os.Getenv("NODE_ENV") == "development" {
			claims := &Claims{
				PreferredUser: "dev-user",
				Email:         "dev@ngapp.local",
				RealmAccess:   RealmAccess{Roles: []string{"user"}},
				TenantID:      "default",
			}
			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		auth := r.Header.Get("Authorization")
		if auth == "" || !strings.HasPrefix(auth, "Bearer ") {
			http.Error(w, `{"error":{"code":"UNAUTHORIZED","message":"missing bearer token"}}`, 401)
			return
		}
		tokenStr := strings.TrimPrefix(auth, "Bearer ")

		token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
			return m.getPublicKey(t)
		})
		if err != nil {
			http.Error(w, fmt.Sprintf(`{"error":{"code":"INVALID_TOKEN","message":"%s"}}`, err.Error()), 401)
			return
		}

		claims, ok := token.Claims.(*Claims)
		if !ok || !token.Valid {
			http.Error(w, `{"error":{"code":"INVALID_TOKEN","message":"invalid claims"}}`, 401)
			return
		}

		ctx := context.WithValue(r.Context(), ClaimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (m *JWTMiddleware) RequireRole(role string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := GetClaims(r.Context())
		if claims == nil || !claims.HasRole(role) {
			http.Error(w, `{"error":{"code":"FORBIDDEN","message":"insufficient permissions"}}`, 403)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (m *JWTMiddleware) getPublicKey(token *jwt.Token) (interface{}, error) {
	// In production, fetch JWKS from Keycloak
	// For now, use HMAC with shared secret for dev
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); ok {
		secret := os.Getenv("JWT_SECRET")
		if secret == "" {
			log.Fatal("FATAL: JWT_SECRET environment variable is required but not set")
		}
		return []byte(secret), nil
	}
	return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
}

type contextKey string

const ClaimsKey contextKey = "claims"

func GetClaims(ctx context.Context) *Claims {
	c, _ := ctx.Value(ClaimsKey).(*Claims)
	return c
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
