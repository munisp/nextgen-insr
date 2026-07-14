package infra

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Circuit breaker states.
const (
	StateClosed   = "closed"
	StateOpen     = "open"
	StateHalfOpen = "half-open"
)

var (
	ErrCircuitOpen    = errors.New("circuit breaker is open")
	ErrTooManyRetries = errors.New("max retries exceeded")
)

// CircuitBreaker implements the circuit breaker pattern for inter-service calls.
type CircuitBreaker struct {
	mu               sync.RWMutex
	name             string
	state            string
	failureCount     int
	successCount     int
	failureThreshold int
	successThreshold int
	timeout          time.Duration
	lastFailure      time.Time
	halfOpenMax      int
	halfOpenCurrent  int
	logger           *zap.Logger
}

// CircuitBreakerConfig configures a circuit breaker instance.
type CircuitBreakerConfig struct {
	Name             string
	FailureThreshold int
	SuccessThreshold int
	Timeout          time.Duration
	HalfOpenMax      int
}

// DefaultCircuitBreakerConfig returns production-ready defaults.
func DefaultCircuitBreakerConfig(name string) CircuitBreakerConfig {
	return CircuitBreakerConfig{
		Name:             name,
		FailureThreshold: 5,
		SuccessThreshold: 3,
		Timeout:          30 * time.Second,
		HalfOpenMax:      1,
	}
}

// NewCircuitBreaker creates a new circuit breaker.
func NewCircuitBreaker(logger *zap.Logger, cfg CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		name:             cfg.Name,
		state:            StateClosed,
		failureThreshold: cfg.FailureThreshold,
		successThreshold: cfg.SuccessThreshold,
		timeout:          cfg.Timeout,
		halfOpenMax:      cfg.HalfOpenMax,
		logger:           logger,
	}
}

// Execute runs the given function through the circuit breaker.
func (cb *CircuitBreaker) Execute(ctx context.Context, fn func(context.Context) error) error {
	if err := cb.canExecute(); err != nil {
		return err
	}

	err := fn(ctx)
	cb.recordResult(err)
	return err
}

func (cb *CircuitBreaker) canExecute() error {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return nil
	case StateOpen:
		if time.Since(cb.lastFailure) > cb.timeout {
			cb.state = StateHalfOpen
			cb.halfOpenCurrent = 0
			cb.successCount = 0
			cb.logger.Info("circuit_breaker_half_open", zap.String("name", cb.name))
			return nil
		}
		return ErrCircuitOpen
	case StateHalfOpen:
		if cb.halfOpenCurrent >= cb.halfOpenMax {
			return ErrCircuitOpen
		}
		cb.halfOpenCurrent++
		return nil
	}
	return nil
}

func (cb *CircuitBreaker) recordResult(err error) {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if err != nil {
		cb.failureCount++
		cb.lastFailure = time.Now()

		if cb.state == StateHalfOpen {
			cb.state = StateOpen
			cb.logger.Warn("circuit_breaker_reopened", zap.String("name", cb.name))
			return
		}

		if cb.failureCount >= cb.failureThreshold {
			cb.state = StateOpen
			cb.logger.Warn("circuit_breaker_opened",
				zap.String("name", cb.name),
				zap.Int("failures", cb.failureCount),
			)
		}
		return
	}

	if cb.state == StateHalfOpen {
		cb.successCount++
		if cb.successCount >= cb.successThreshold {
			cb.state = StateClosed
			cb.failureCount = 0
			cb.successCount = 0
			cb.logger.Info("circuit_breaker_closed", zap.String("name", cb.name))
		}
		return
	}

	cb.failureCount = 0
}

// State returns the current circuit breaker state.
func (cb *CircuitBreaker) State() string {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// RetryConfig configures retry behavior with exponential backoff.
type RetryConfig struct {
	MaxRetries  int
	BaseDelay   time.Duration
	MaxDelay    time.Duration
	Multiplier  float64
	JitterRatio float64
}

// DefaultRetryConfig returns production-ready retry defaults.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:  3,
		BaseDelay:   100 * time.Millisecond,
		MaxDelay:    5 * time.Second,
		Multiplier:  2.0,
		JitterRatio: 0.1,
	}
}

// RetryWithBackoff executes fn with exponential backoff and jitter.
func RetryWithBackoff(ctx context.Context, cfg RetryConfig, fn func(context.Context) error) error {
	var lastErr error
	for attempt := 0; attempt <= cfg.MaxRetries; attempt++ {
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("context cancelled during retry: %w", err)
		}

		lastErr = fn(ctx)
		if lastErr == nil {
			return nil
		}

		if attempt == cfg.MaxRetries {
			break
		}

		delay := float64(cfg.BaseDelay) * math.Pow(cfg.Multiplier, float64(attempt))
		if delay > float64(cfg.MaxDelay) {
			delay = float64(cfg.MaxDelay)
		}
		jitter := delay * cfg.JitterRatio * (rand.Float64()*2 - 1)
		sleepDuration := time.Duration(delay + jitter)

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleepDuration):
		}
	}
	return fmt.Errorf("%w: %v", ErrTooManyRetries, lastErr)
}

// ResilientHTTPClient wraps http.Client with circuit breaker and retry logic.
type ResilientHTTPClient struct {
	client  *http.Client
	breaker *CircuitBreaker
	retry   RetryConfig
	logger  *zap.Logger
}

// NewResilientHTTPClient creates an HTTP client with circuit breaker and retries.
func NewResilientHTTPClient(logger *zap.Logger, serviceName string) *ResilientHTTPClient {
	return &ResilientHTTPClient{
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				MaxIdleConnsPerHost: 10,
				IdleConnTimeout:     90 * time.Second,
			},
		},
		breaker: NewCircuitBreaker(logger, DefaultCircuitBreakerConfig(serviceName)),
		retry:   DefaultRetryConfig(),
		logger:  logger,
	}
}

// Do executes an HTTP request with circuit breaker and retry logic.
func (c *ResilientHTTPClient) Do(ctx context.Context, req *http.Request) (*http.Response, error) {
	var resp *http.Response
	err := c.breaker.Execute(ctx, func(ctx context.Context) error {
		return RetryWithBackoff(ctx, c.retry, func(ctx context.Context) error {
			req = req.WithContext(ctx)
			var err error
			resp, err = c.client.Do(req)
			if err != nil {
				return err
			}
			if resp.StatusCode >= 500 {
				return fmt.Errorf("server error: %d", resp.StatusCode)
			}
			return nil
		})
	})
	return resp, err
}

// BreakerState returns the current state of the circuit breaker.
func (c *ResilientHTTPClient) BreakerState() string {
	return c.breaker.State()
}
