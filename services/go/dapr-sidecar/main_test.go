package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// fakeDapr implements the real Dapr HTTP API surface the proxy speaks to.
func fakeDapr(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/v1.0/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/v1.0/invoke/billing/method/charge", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"charged":true}`))
	})
	mux.HandleFunc("/v1.0/publish/pubsub/orders", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/v1.0-alpha1/lock/lockstore", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["resourceId"] == "taken" {
			_ = json.NewEncoder(w).Encode(map[string]bool{"success": false})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"success": true})
	})
	mux.HandleFunc("/v1.0-alpha1/unlock/lockstore", func(w http.ResponseWriter, r *http.Request) {
		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["resourceId"] == "lost" {
			_ = json.NewEncoder(w).Encode(map[string]int{"status": 2})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]int{"status": 0})
	})
	return httptest.NewServer(mux)
}

func testSidecar(url string) *DaprSidecar {
	return &DaprSidecar{
		baseURL:    url,
		httpClient: &http.Client{Timeout: 2 * time.Second},
		LockStore:  "lockstore",
	}
}

func TestDaprHealthy(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	if err := s.Healthy(context.Background()); err != nil {
		t.Fatalf("expected healthy: %v", err)
	}
}

func TestDaprUnhealthyFailsLoud(t *testing.T) {
	s := testSidecar("http://127.0.0.1:1") // nothing listening
	if err := s.Healthy(context.Background()); err == nil {
		t.Fatal("expected error against dead Dapr, got nil")
	}
}

func TestDaprInvokeService(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	resp, err := s.InvokeService(context.Background(), "billing", "charge", []byte(`{"amount":1}`))
	if err != nil {
		t.Fatalf("invoke failed: %v", err)
	}
	if !strings.Contains(string(resp), "charged") {
		t.Fatalf("unexpected invoke response: %s", resp)
	}
}

func TestDaprPublishEvent(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	if err := s.PublishEvent(context.Background(), "pubsub", "orders", []byte(`{"id":1}`)); err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	if err := s.PublishEvent(context.Background(), "pubsub", "nope", []byte(`{}`)); err == nil {
		t.Fatal("expected error for unknown topic (404 from Dapr)")
	}
}

func TestDaprAcquireAndReleaseLock(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	l, err := s.AcquireLock(context.Background(), "", "res-1", "owner-1", 10)
	if err != nil {
		t.Fatalf("acquire failed: %v", err)
	}
	if err := l.Unlock(context.Background()); err != nil {
		t.Fatalf("unlock failed: %v", err)
	}
}

func TestDaprLockContentionIsAnError(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	if _, err := s.AcquireLock(context.Background(), "", "taken", "owner-2", 10); err == nil {
		t.Fatal("expected contention error, got a lock")
	}
}

func TestDaprUnlockNotHeldIsAnError(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	l := &DistributedLock{sidecar: s, store: "lockstore", resourceID: "lost", owner: "owner-1"}
	if err := l.Unlock(context.Background()); err == nil {
		t.Fatal("expected unlock failure for a lock not held")
	}
}

func TestDaprValidation(t *testing.T) {
	s := testSidecar(fakeDapr(t).URL)
	if _, err := s.AcquireLock(context.Background(), "", "", "owner", 10); err == nil {
		t.Fatal("expected validation error for empty resourceID")
	}
}
