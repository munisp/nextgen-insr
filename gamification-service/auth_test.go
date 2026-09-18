package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"go.uber.org/zap"
)

// AB-15: authentication required on the points/rewards route group.
func TestServiceAuthMiddleware(t *testing.T) {
	logger := zap.NewNop()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	t.Run("missing token env fails closed with 503", func(t *testing.T) {
		os.Unsetenv("GAMIFICATION_SERVICE_TOKEN")
		os.Unsetenv("DEV_AUTH_BYPASS")
		rec := httptest.NewRecorder()
		serviceAuthMiddleware(logger)(next).ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/points/award", nil))
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503, got %d", rec.Code)
		}
	})

	t.Run("wrong or missing bearer rejected", func(t *testing.T) {
		os.Setenv("GAMIFICATION_SERVICE_TOKEN", "secret-token")
		defer os.Unsetenv("GAMIFICATION_SERVICE_TOKEN")
		for _, h := range []string{"", "Bearer wrong", "secret-token"} {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest("POST", "/api/v1/points/award", nil)
			if h != "" {
				req.Header.Set("Authorization", h)
			}
			serviceAuthMiddleware(logger)(next).ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("header %q: expected 401, got %d", h, rec.Code)
			}
		}
	})

	t.Run("correct bearer passes", func(t *testing.T) {
		os.Setenv("GAMIFICATION_SERVICE_TOKEN", "secret-token")
		defer os.Unsetenv("GAMIFICATION_SERVICE_TOKEN")
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/api/v1/points/award", nil)
		req.Header.Set("Authorization", "Bearer secret-token")
		serviceAuthMiddleware(logger)(next).ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("dev bypass ignored in production", func(t *testing.T) {
		os.Setenv("DEV_AUTH_BYPASS", "true")
		os.Setenv("ENVIRONMENT", "production")
		os.Setenv("GAMIFICATION_SERVICE_TOKEN", "secret-token")
		defer func() {
			os.Unsetenv("DEV_AUTH_BYPASS")
			os.Unsetenv("ENVIRONMENT")
			os.Unsetenv("GAMIFICATION_SERVICE_TOKEN")
		}()
		rec := httptest.NewRecorder()
		serviceAuthMiddleware(logger)(next).ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/points/award", nil))
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("dev bypass must not work in production, got %d", rec.Code)
		}
	})
}

// AB-15: award amounts are server-computed from rules, never client input.
func TestAwardRulesServerComputed(t *testing.T) {
	for action, rule := range pointAwardRules {
		if rule.Points <= 0 {
			t.Fatalf("rule %s has non-positive server-computed points", action)
		}
		if rule.Limit <= 0 {
			t.Fatalf("rule %s has non-positive daily limit", action)
		}
	}
	// referral self-award guard exists at handler level; rule sanity here.
	if pointAwardRules["referral"].Points != 200 {
		t.Fatalf("unexpected referral points: %d", pointAwardRules["referral"].Points)
	}
}
