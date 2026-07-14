package lakehouse

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewClient(t *testing.T) {
	config := DefaultConfig("test-service")
	client := NewClient(config)
	defer client.Close()

	if client.config.ServiceName != "test-service" {
		t.Errorf("expected service name 'test-service', got '%s'", client.config.ServiceName)
	}
	if client.config.BatchSize != 100 {
		t.Errorf("expected batch size 100, got %d", client.config.BatchSize)
	}
}

func TestEmitAndFlush(t *testing.T) {
	var received int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ingest/batch" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if r.Header.Get("X-Service-Name") != "test-service" {
			t.Errorf("missing service name header")
		}

		var events []json.RawMessage
		if err := json.NewDecoder(r.Body).Decode(&events); err != nil {
			t.Fatalf("decode error: %v", err)
		}
		atomic.AddInt64(&received, int64(len(events)))
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "accepted"})
	}))
	defer server.Close()

	config := DefaultConfig("test-service")
	config.APIEndpoint = server.URL
	config.FlushInterval = 100 * time.Millisecond
	client := NewClient(config)

	ctx := context.Background()

	// Emit claim event
	err := client.EmitClaimEvent(ctx, ClaimEvent{
		ClaimID:     "CLM-001",
		Amount:      150000.0,
		PolicyLimit: 500000.0,
	})
	if err != nil {
		t.Fatalf("emit claim event: %v", err)
	}

	// Emit fraud alert
	err = client.EmitFraudAlert(ctx, FraudAlertEvent{
		AlertID:    "FRD-001",
		CustomerID: "CUST-001",
		RiskScore:  0.85,
		AlertType:  "suspicious_claim",
	})
	if err != nil {
		t.Fatalf("emit fraud alert: %v", err)
	}

	// Emit payment
	err = client.EmitPaymentEvent(ctx, PaymentEvent{
		TransactionID: "TXN-001",
		Amount:        25000.0,
		Method:        "transfer",
		CustomerID:    "CUST-001",
	})
	if err != nil {
		t.Fatalf("emit payment: %v", err)
	}

	// Close triggers final flush
	client.Close()

	if atomic.LoadInt64(&received) != 3 {
		t.Errorf("expected 3 events received, got %d", atomic.LoadInt64(&received))
	}

	stats := client.GetStats()
	if stats.Published != 3 {
		t.Errorf("expected 3 published, got %d", stats.Published)
	}
	if stats.Delivered != 3 {
		t.Errorf("expected 3 delivered, got %d", stats.Delivered)
	}
}

func TestBatchFlushOnThreshold(t *testing.T) {
	var batchCount int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&batchCount, 1)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	config := DefaultConfig("test-service")
	config.APIEndpoint = server.URL
	config.BatchSize = 5
	config.FlushInterval = 10 * time.Second // Long interval so only batch threshold triggers
	client := NewClient(config)

	ctx := context.Background()
	for i := 0; i < 5; i++ {
		client.Emit(ctx, Event{
			Topic:   "test.event",
			Key:     "key",
			Payload: map[string]interface{}{"i": i},
		})
	}

	time.Sleep(100 * time.Millisecond) // Let flush happen
	client.Close()

	if atomic.LoadInt64(&batchCount) < 1 {
		t.Error("expected at least 1 batch flush on threshold")
	}
}

func TestCircuitBreaker(t *testing.T) {
	var callCount int64

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt64(&callCount, 1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	config := DefaultConfig("test-service")
	config.APIEndpoint = server.URL
	config.BatchSize = 1
	config.MaxRetries = 0 // No retries for fast test
	config.FlushInterval = 50 * time.Millisecond
	client := NewClient(config)

	ctx := context.Background()
	for i := 0; i < 10; i++ {
		client.Emit(ctx, Event{
			Topic:   "test.event",
			Payload: map[string]interface{}{"i": i},
		})
		time.Sleep(60 * time.Millisecond)
	}

	client.Close()

	stats := client.GetStats()
	if stats.Failed == 0 {
		t.Error("expected some failures")
	}
}
