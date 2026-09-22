package main

// P-wave perf (2026-09-19): NIBSS bounded retry + circuit breaker tests.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/insureportal/nigerian-bank-integrations/config"
)

func testNIBSSClient(baseURL string) *nibssClient {
	return newNIBSSClient(config.BankConfig{
		NIBSSBaseURL: baseURL,
		NIBSSTimeout: 2 * time.Second,
	})
}

func TestNIBSSNameEnquiryRetriesOnceOn5xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		_, _ = w.Write([]byte(`{"account_name":"Ada Lovelace","bank_name":"Test Bank"}`))
	}))
	defer srv.Close()
	name, bank, err := testNIBSSClient(srv.URL).NameEnquiry(context.Background(), "0123456789", "011")
	if err != nil {
		t.Fatalf("expected retry to recover, got %v", err)
	}
	if name != "Ada Lovelace" || bank != "Test Bank" {
		t.Fatalf("unexpected result: %q %q", name, bank)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("expected exactly 2 attempts (1 retry), got %d", calls)
	}
}

func TestNIBSSNameEnquiryNoRetryOn4xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	_, _, err := testNIBSSClient(srv.URL).NameEnquiry(context.Background(), "0123456789", "011")
	if err == nil {
		t.Fatal("expected error")
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("4xx must not be retried, got %d attempts", calls)
	}
}

func TestNIBSSCircuitOpensAndFailsLoud(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	c := testNIBSSClient(srv.URL)
	// 5 failed enquiries (each may retry → 2 HTTP calls per failure) trip the
	// breaker (maxFailures=5).
	for i := 0; i < 5; i++ {
		_, _, _ = c.NameEnquiry(context.Background(), "0123456789", "011")
	}
	_, _, err := c.NameEnquiry(context.Background(), "0123456789", "011")
	if !errors.Is(err, ErrNIBSSCircuitOpen) {
		t.Fatalf("expected fail-loud ErrNIBSSCircuitOpen, got %v", err)
	}
	// Transfer path must also fail loud while open.
	_, terr := c.NIPTransfer(context.Background(), map[string]interface{}{"reference": "R1"})
	if !errors.Is(terr, ErrNIBSSCircuitOpen) {
		t.Fatalf("expected NIPTransfer to fail loud while open, got %v", terr)
	}
}

func TestNIBSSCircuitHalfOpenRecovery(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"account_name":"Recovered","bank_name":"TB"}`))
	}))
	defer srv.Close()
	c := testNIBSSClient(srv.URL)
	c.cb.openDuration = 50 * time.Millisecond // shrink for the test
	for i := 0; i < 5; i++ {
		_, _, _ = c.NameEnquiry(context.Background(), "0123456789", "011")
	}
	if _, _, err := c.NameEnquiry(context.Background(), "0123456789", "011"); !errors.Is(err, ErrNIBSSCircuitOpen) {
		t.Fatalf("expected open circuit, got %v", err)
	}
	time.Sleep(60 * time.Millisecond)
	fail.Store(false)
	name, _, err := c.NameEnquiry(context.Background(), "0123456789", "011")
	if err != nil || name != "Recovered" {
		t.Fatalf("expected half-open probe to recover, got %v (%q)", err, name)
	}
	if c.cb.state != nibssCircuitClosed {
		t.Fatalf("expected circuit closed after successful probe")
	}
}

func TestNIPTransferNotBlindRetried(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	_, err := testNIBSSClient(srv.URL).NIPTransfer(context.Background(), map[string]interface{}{"reference": "R2"})
	if err == nil {
		t.Fatal("expected error")
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("NIPTransfer must never be blind-retried (ambiguity — requery governs), got %d attempts", calls)
	}
}
