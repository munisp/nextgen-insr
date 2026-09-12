package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestValidate(t *testing.T) {
	valid := &SettleRequest{SettlementID: "s1", TenantID: "t", PayerID: "p", PayeeID: "q", AmountMinor: 100, Currency: "NGN"}
	if err := valid.validate(); err != nil {
		t.Fatalf("valid request rejected: %v", err)
	}
	bad := &SettleRequest{SettlementID: "s1"}
	if err := bad.validate(); err == nil {
		t.Fatal("missing fields accepted")
	}
	neg := &SettleRequest{SettlementID: "s1", TenantID: "t", PayerID: "p", PayeeID: "q", AmountMinor: -5, Currency: "NGN"}
	if err := neg.validate(); err == nil {
		t.Fatal("negative amount accepted")
	}
}

func TestHandleSettleRejectsInvalid(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/settle", strings.NewReader(`{"settlement_id":"x"}`))
	rec := httptest.NewRecorder()
	handleSettle(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestHandleSettleFailsLoudWithoutLedger(t *testing.T) {
	// No TB bridge, no mojaloop: must fail loud at the ledger step, 502.
	old := tigerbeetleBridge
	tigerbeetleBridge = ""
	defer func() { tigerbeetleBridge = old }()
	body, _ := json.Marshal(SettleRequest{SettlementID: "s-loud", TenantID: "t",
		PayerID: "p", PayeeID: "q", AmountMinor: 100, Currency: "NGN"})
	req := httptest.NewRequest(http.MethodPost, "/settle", strings.NewReader(string(body)))
	rec := httptest.NewRecorder()
	handleSettle(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 fail-loud, got %d (%s)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "tigerbeetle") {
		t.Fatalf("error should name the missing dependency: %s", rec.Body.String())
	}
}

func TestHealthDegradedWithoutRedis(t *testing.T) {
	old := redisURL
	redisURL = "redis://127.0.0.1:1/0" // unreachable
	defer func() { redisURL = old }()
	rec := httptest.NewRecorder()
	handleHealth(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 degraded, got %d", rec.Code)
	}
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if out["status"] != "degraded" {
		t.Fatalf("expected degraded status, got %v", out["status"])
	}
}
