package circuitbreaker

import (
	"errors"
	"testing"
	"time"
)

func TestCircuitBreakerClosed(t *testing.T) {
	cb := New("test", Config{MaxFailures: 3, Timeout: 100 * time.Millisecond})

	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
	if cb.State() != StateClosed {
		t.Fatalf("expected closed, got %s", cb.State())
	}
}

func TestCircuitBreakerOpens(t *testing.T) {
	cb := New("test", Config{MaxFailures: 3, Timeout: 100 * time.Millisecond})

	testErr := errors.New("service down")
	for i := 0; i < 3; i++ {
		_ = cb.Execute(func() error { return testErr })
	}

	if cb.State() != StateOpen {
		t.Fatalf("expected open after 3 failures, got %s", cb.State())
	}

	err := cb.Execute(func() error { return nil })
	if !errors.Is(err, ErrCircuitOpen) {
		t.Fatalf("expected ErrCircuitOpen, got %v", err)
	}
}

func TestCircuitBreakerHalfOpen(t *testing.T) {
	cb := New("test", Config{MaxFailures: 2, Timeout: 50 * time.Millisecond, HalfOpenMax: 1})

	testErr := errors.New("service down")
	_ = cb.Execute(func() error { return testErr })
	_ = cb.Execute(func() error { return testErr })

	if cb.State() != StateOpen {
		t.Fatalf("expected open, got %s", cb.State())
	}

	time.Sleep(60 * time.Millisecond)

	err := cb.Execute(func() error { return nil })
	if err != nil {
		t.Fatalf("expected success in half-open, got %v", err)
	}
	if cb.State() != StateClosed {
		t.Fatalf("expected closed after half-open success, got %s", cb.State())
	}
}

func TestCircuitBreakerReOpens(t *testing.T) {
	cb := New("test", Config{MaxFailures: 2, Timeout: 50 * time.Millisecond, HalfOpenMax: 1})

	testErr := errors.New("service down")
	_ = cb.Execute(func() error { return testErr })
	_ = cb.Execute(func() error { return testErr })

	time.Sleep(60 * time.Millisecond)

	_ = cb.Execute(func() error { return testErr })
	if cb.State() != StateOpen {
		t.Fatalf("expected re-open after half-open failure, got %s", cb.State())
	}
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()
	if cfg.MaxFailures != 5 {
		t.Fatalf("expected 5 max failures, got %d", cfg.MaxFailures)
	}
	if cfg.Timeout != 30*time.Second {
		t.Fatalf("expected 30s timeout, got %v", cfg.Timeout)
	}
}

func TestStateString(t *testing.T) {
	tests := []struct {
		state    State
		expected string
	}{
		{StateClosed, "closed"},
		{StateOpen, "open"},
		{StateHalfOpen, "half-open"},
		{State(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.state.String(); got != tt.expected {
			t.Errorf("State(%d).String() = %q, want %q", tt.state, got, tt.expected)
		}
	}
}
