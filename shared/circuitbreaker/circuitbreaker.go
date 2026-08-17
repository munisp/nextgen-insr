package circuitbreaker

import (
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// State represents the circuit breaker state
type State int

const (
	StateClosed   State = iota // Normal operation
	StateOpen                  // Failing, reject requests
	StateHalfOpen              // Testing if service recovered
)

func (s State) String() string {
	switch s {
	case StateClosed:
		return "closed"
	case StateOpen:
		return "open"
	case StateHalfOpen:
		return "half-open"
	default:
		return "unknown"
	}
}

var (
	ErrCircuitOpen = errors.New("circuit breaker is open")
)

// Config holds circuit breaker configuration
type Config struct {
	MaxFailures int           // failures before opening (default: 5)
	Timeout     time.Duration // how long to stay open (default: 30s)
	HalfOpenMax int           // max requests in half-open (default: 1)
}

// DefaultConfig returns sensible defaults
func DefaultConfig() Config {
	return Config{
		MaxFailures: 5,
		Timeout:     30 * time.Second,
		HalfOpenMax: 1,
	}
}

// CircuitBreaker implements the circuit breaker pattern
type CircuitBreaker struct {
	name        string
	config      Config
	mu          sync.RWMutex
	state       State
	failures    int
	lastFailure time.Time
	halfOpenReq int
}

// New creates a new circuit breaker
func New(name string, config Config) *CircuitBreaker {
	if config.MaxFailures == 0 {
		config.MaxFailures = 5
	}
	if config.Timeout == 0 {
		config.Timeout = 30 * time.Second
	}
	if config.HalfOpenMax == 0 {
		config.HalfOpenMax = 1
	}
	return &CircuitBreaker{
		name:   name,
		config: config,
		state:  StateClosed,
	}
}

// Execute runs fn through the circuit breaker
func (cb *CircuitBreaker) Execute(fn func() error) error {
	if !cb.allowRequest() {
		return fmt.Errorf("%s: %w", cb.name, ErrCircuitOpen)
	}

	err := fn()

	if err != nil {
		cb.recordFailure()
		return err
	}

	cb.recordSuccess()
	return nil
}

// State returns the current state
func (cb *CircuitBreaker) State() State {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

func (cb *CircuitBreaker) allowRequest() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	switch cb.state {
	case StateClosed:
		return true
	case StateOpen:
		if time.Since(cb.lastFailure) > cb.config.Timeout {
			cb.state = StateHalfOpen
			cb.halfOpenReq = 0
			return true
		}
		return false
	case StateHalfOpen:
		if cb.halfOpenReq < cb.config.HalfOpenMax {
			cb.halfOpenReq++
			return true
		}
		return false
	default:
		return false
	}
}

func (cb *CircuitBreaker) recordSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failures = 0
	cb.state = StateClosed
}

func (cb *CircuitBreaker) recordFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	cb.failures++
	cb.lastFailure = time.Now()

	if cb.state == StateHalfOpen || cb.failures >= cb.config.MaxFailures {
		cb.state = StateOpen
	}
}

// HTTPClient wraps http.Client with circuit breaker
type HTTPClient struct {
	client  *http.Client
	breaker *CircuitBreaker
}

// NewHTTPClient creates an HTTP client with circuit breaker
func NewHTTPClient(name string, config Config) *HTTPClient {
	return &HTTPClient{
		client:  &http.Client{Timeout: 10 * time.Second},
		breaker: New(name, config),
	}
}

// Do executes an HTTP request through the circuit breaker
func (c *HTTPClient) Do(req *http.Request) (*http.Response, error) {
	var resp *http.Response
	err := c.breaker.Execute(func() error {
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
	return resp, err
}

// Get performs an HTTP GET through the circuit breaker
func (c *HTTPClient) Get(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	return c.Do(req)
}
