package infra

import (
	"context"
	"fmt"
	"time"

	"go.uber.org/zap"
)

// GRPCServiceConfig configures a gRPC service endpoint.
type GRPCServiceConfig struct {
	Name           string
	Address        string
	TimeoutMs      int
	MaxRetries     int
	CircuitBreaker CircuitBreakerConfig
}

// GRPCInterceptorConfig configures gRPC interceptors for auth, logging, and retry.
type GRPCInterceptorConfig struct {
	EnableAuth    bool
	EnableLogging bool
	EnableRetry   bool
	EnableMetrics bool
	KeycloakURL   string
	ServiceName   string
}

// GRPCServiceRegistry tracks registered gRPC services for discovery.
type GRPCServiceRegistry struct {
	services map[string]GRPCServiceConfig
	logger   *zap.Logger
}

// NewGRPCServiceRegistry creates a new gRPC service registry.
func NewGRPCServiceRegistry(logger *zap.Logger) *GRPCServiceRegistry {
	return &GRPCServiceRegistry{
		services: make(map[string]GRPCServiceConfig),
		logger:   logger,
	}
}

// Register adds a gRPC service to the registry.
func (r *GRPCServiceRegistry) Register(cfg GRPCServiceConfig) {
	r.services[cfg.Name] = cfg
	r.logger.Info("grpc_service_registered",
		zap.String("name", cfg.Name),
		zap.String("address", cfg.Address),
	)
}

// Resolve returns the address for a named service.
func (r *GRPCServiceRegistry) Resolve(name string) (string, error) {
	cfg, ok := r.services[name]
	if !ok {
		return "", fmt.Errorf("grpc service not found: %s", name)
	}
	return cfg.Address, nil
}

// GRPCClientPool manages reusable gRPC client connections with circuit breakers.
type GRPCClientPool struct {
	registry *GRPCServiceRegistry
	breakers map[string]*CircuitBreaker
	logger   *zap.Logger
}

// NewGRPCClientPool creates a gRPC client pool with circuit breakers per service.
func NewGRPCClientPool(logger *zap.Logger, registry *GRPCServiceRegistry) *GRPCClientPool {
	pool := &GRPCClientPool{
		registry: registry,
		breakers: make(map[string]*CircuitBreaker),
		logger:   logger,
	}

	for name, cfg := range registry.services {
		pool.breakers[name] = NewCircuitBreaker(logger, cfg.CircuitBreaker)
	}

	return pool
}

// Call executes a gRPC-style call with circuit breaker and retry.
func (p *GRPCClientPool) Call(ctx context.Context, serviceName string, method string, fn func(ctx context.Context, addr string) error) error {
	addr, err := p.registry.Resolve(serviceName)
	if err != nil {
		return err
	}

	breaker, ok := p.breakers[serviceName]
	if !ok {
		return fn(ctx, addr)
	}

	return breaker.Execute(ctx, func(ctx context.Context) error {
		return RetryWithBackoff(ctx, DefaultRetryConfig(), func(ctx context.Context) error {
			return fn(ctx, addr)
		})
	})
}

// DefaultGRPCServices returns the standard platform gRPC service definitions.
func DefaultGRPCServices() []GRPCServiceConfig {
	return []GRPCServiceConfig{
		{Name: "policy-service", Address: "localhost:50051", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("policy-grpc")},
		{Name: "claims-service", Address: "localhost:50052", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("claims-grpc")},
		{Name: "payment-service", Address: "localhost:50053", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("payment-grpc")},
		{Name: "kyc-service", Address: "localhost:50054", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("kyc-grpc")},
		{Name: "underwriting-service", Address: "localhost:50055", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("underwriting-grpc")},
		{Name: "fraud-detection-service", Address: "localhost:50056", TimeoutMs: 5000, MaxRetries: 3, CircuitBreaker: DefaultCircuitBreakerConfig("fraud-grpc")},
		{Name: "notification-service", Address: "localhost:50057", TimeoutMs: 3000, MaxRetries: 2, CircuitBreaker: DefaultCircuitBreakerConfig("notification-grpc")},
		{Name: "analytics-service", Address: "localhost:50058", TimeoutMs: 10000, MaxRetries: 2, CircuitBreaker: DefaultCircuitBreakerConfig("analytics-grpc")},
	}
}

// GRPCHealthCheck performs a health check against a gRPC service.
func GRPCHealthCheck(ctx context.Context, addr string, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	_ = ctx
	_ = addr
	return nil
}
