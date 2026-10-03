package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// Security regression tests (2026-10-03): the admin endpoints
// /api/v1/ussd/sessions and /api/v1/ussd/stats must be behind the same
// shared-secret gate as the telco callbacks (USSD_CALLBACK_TOKEN):
// fail-closed 503 when unconfigured, 401 on missing/invalid token, 200 with
// the correct token.

func setupAdminRouter() *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/ussd/sessions", ussdCallbackAuth(), listActiveSessions)
	r.GET("/api/v1/ussd/stats", ussdCallbackAuth(), getUSSDStats)
	return r
}

func adminRequest(t *testing.T, tokenHeader string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ussd/stats", nil)
	if tokenHeader != "" {
		req.Header.Set("X-Callback-Token", tokenHeader)
	}
	setupAdminRouter().ServeHTTP(rec, req)
	return rec
}

func TestAdminEndpointsFailClosedWhenTokenUnconfigured(t *testing.T) {
	t.Setenv("USSD_CALLBACK_TOKEN", "")
	if got := adminRequest(t, "anything").Code; got != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured token must fail closed with 503, got %d", got)
	}
}

func TestAdminEndpointsRejectMissingToken(t *testing.T) {
	t.Setenv("USSD_CALLBACK_TOKEN", "s3cret")
	if got := adminRequest(t, "").Code; got != http.StatusUnauthorized {
		t.Fatalf("missing token must be 401, got %d", got)
	}
}

func TestAdminEndpointsRejectWrongToken(t *testing.T) {
	t.Setenv("USSD_CALLBACK_TOKEN", "s3cret")
	if got := adminRequest(t, "wrong").Code; got != http.StatusUnauthorized {
		t.Fatalf("wrong token must be 401, got %d", got)
	}
}

func TestAdminEndpointsAcceptCorrectToken(t *testing.T) {
	t.Setenv("USSD_CALLBACK_TOKEN", "s3cret")
	if got := adminRequest(t, "s3cret").Code; got != http.StatusOK {
		t.Fatalf("correct token must be 200, got %d", got)
	}
}
