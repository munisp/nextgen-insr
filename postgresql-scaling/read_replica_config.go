// Package postgresql provides PostgreSQL scaling utilities inspired by OpenAI's architecture
// for handling 800M+ users with millions of QPS
package postgresql

import (
	"context"
	"database/sql"
	"fmt"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/lib/pq"
)

// ReplicaConfig holds configuration for a read replica
type ReplicaConfig struct {
	Host     string
	Port     int
	Database string
	User     string
	Password string
	SSLMode  string
	Region   string
	Priority int // Higher priority = preferred for routing
	MaxConns int
}

// PrimaryConfig holds configuration for the primary (write) database
type PrimaryConfig struct {
	Host       string
	Port       int
	Database   string
	User       string
	Password   string
	SSLMode    string
	MaxConns   int
	HotStandby *ReplicaConfig // For automatic failover
}

// WorkloadTier represents the priority tier for workload isolation
type WorkloadTier string

const (
	TierHighPriority   WorkloadTier = "high"     // Customer-facing operations
	TierMediumPriority WorkloadTier = "medium"   // Agent operations, underwriting
	TierLowPriority    WorkloadTier = "low"      // Analytics, reporting, batch jobs
	TierIsolated       WorkloadTier = "isolated" // Fraud detection (Insurance Radar)
)

// ReadReplicaPool manages a pool of read replicas with load balancing
type ReadReplicaPool struct {
	primary      *sql.DB
	replicas     []*sql.DB
	replicaConfs []ReplicaConfig
	mu           sync.RWMutex
	roundRobin   uint64
	healthCheck  time.Duration
	ctx          context.Context
	cancel       context.CancelFunc
}

// WorkloadRouter routes queries to appropriate database instances based on workload tier
type WorkloadRouter struct {
	pools map[WorkloadTier]*ReadReplicaPool
	mu    sync.RWMutex
}

// QueryMetrics tracks query performance for optimization
type QueryMetrics struct {
	QueryHash     string
	ExecutionTime time.Duration
	RowsAffected  int64
	IsWrite       bool
	Tier          WorkloadTier
	Timestamp     time.Time
}

// NewReadReplicaPool creates a new read replica pool
// Inspired by OpenAI's architecture: 1 primary + ~50 read replicas
func NewReadReplicaPool(primaryConf PrimaryConfig, replicaConfs []ReplicaConfig) (*ReadReplicaPool, error) {
	ctx, cancel := context.WithCancel(context.Background())

	pool := &ReadReplicaPool{
		replicaConfs: replicaConfs,
		replicas:     make([]*sql.DB, 0, len(replicaConfs)),
		healthCheck:  30 * time.Second,
		ctx:          ctx,
		cancel:       cancel,
	}

	// Connect to primary
	primaryDSN := fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
		primaryConf.Host, primaryConf.Port, primaryConf.Database,
		primaryConf.User, primaryConf.Password, primaryConf.SSLMode,
	)

	primary, err := sql.Open("postgres", primaryDSN)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to connect to primary: %w", err)
	}

	primary.SetMaxOpenConns(primaryConf.MaxConns)
	primary.SetMaxIdleConns(primaryConf.MaxConns / 4)
	primary.SetConnMaxLifetime(time.Hour)
	primary.SetConnMaxIdleTime(10 * time.Minute)

	if err := primary.PingContext(ctx); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to ping primary: %w", err)
	}

	pool.primary = primary

	// Connect to replicas
	for _, conf := range replicaConfs {
		replicaDSN := fmt.Sprintf(
			"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
			conf.Host, conf.Port, conf.Database,
			conf.User, conf.Password, conf.SSLMode,
		)

		replica, err := sql.Open("postgres", replicaDSN)
		if err != nil {
			// Log error but continue - replicas are optional
			fmt.Printf("Warning: failed to connect to replica %s: %v\n", conf.Host, err)
			continue
		}

		replica.SetMaxOpenConns(conf.MaxConns)
		replica.SetMaxIdleConns(conf.MaxConns / 4)
		replica.SetConnMaxLifetime(time.Hour)
		replica.SetConnMaxIdleTime(10 * time.Minute)

		if err := replica.PingContext(ctx); err != nil {
			fmt.Printf("Warning: failed to ping replica %s: %v\n", conf.Host, err)
			_ = replica.Close()
			continue
		}

		pool.replicas = append(pool.replicas, replica)
	}

	// Start health check goroutine
	go pool.healthCheckLoop()

	return pool, nil
}

// healthCheckLoop periodically checks replica health
func (p *ReadReplicaPool) healthCheckLoop() {
	ticker := time.NewTicker(p.healthCheck)
	defer ticker.Stop()

	for {
		select {
		case <-p.ctx.Done():
			return
		case <-ticker.C:
			p.checkReplicaHealth()
		}
	}
}

// checkReplicaHealth verifies all replicas are responsive
func (p *ReadReplicaPool) checkReplicaHealth() {
	p.mu.Lock()
	defer p.mu.Unlock()

	healthyReplicas := make([]*sql.DB, 0, len(p.replicas))

	for _, replica := range p.replicas {
		ctx, cancel := context.WithTimeout(p.ctx, 5*time.Second)
		if err := replica.PingContext(ctx); err == nil {
			healthyReplicas = append(healthyReplicas, replica)
		} else {
			fmt.Printf("Replica health check failed: %v\n", err)
		}
		cancel()
	}

	p.replicas = healthyReplicas
}

// GetPrimary returns the primary database connection for writes
func (p *ReadReplicaPool) GetPrimary() *sql.DB {
	return p.primary
}

// GetReplica returns a read replica using round-robin load balancing
// Falls back to primary if no replicas are available
func (p *ReadReplicaPool) GetReplica() *sql.DB {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if len(p.replicas) == 0 {
		// Fallback to primary if no replicas available
		// This ensures service continuity (OpenAI's approach)
		return p.primary
	}

	// Round-robin selection
	idx := atomic.AddUint64(&p.roundRobin, 1) % uint64(len(p.replicas))
	return p.replicas[idx]
}

// GetReplicaByRegion returns a replica in the specified region for latency optimization
func (p *ReadReplicaPool) GetReplicaByRegion(region string) *sql.DB {
	p.mu.RLock()
	defer p.mu.RUnlock()

	for i, conf := range p.replicaConfs {
		if conf.Region == region && i < len(p.replicas) {
			return p.replicas[i]
		}
	}

	// Fallback to any replica
	return p.GetReplica()
}

// GetRandomReplica returns a random replica for load distribution
func (p *ReadReplicaPool) GetRandomReplica() *sql.DB {
	p.mu.RLock()
	defer p.mu.RUnlock()

	if len(p.replicas) == 0 {
		return p.primary
	}

	idx := rand.Intn(len(p.replicas))
	return p.replicas[idx]
}

// ExecuteRead executes a read query on a replica
func (p *ReadReplicaPool) ExecuteRead(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	replica := p.GetReplica()
	return replica.QueryContext(ctx, query, args...)
}

// ExecuteWrite executes a write query on the primary
func (p *ReadReplicaPool) ExecuteWrite(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	return p.primary.ExecContext(ctx, query, args...)
}

// Close closes all database connections
func (p *ReadReplicaPool) Close() error {
	p.cancel()

	var errs []error

	if err := p.primary.Close(); err != nil {
		errs = append(errs, fmt.Errorf("failed to close primary: %w", err))
	}

	for _, replica := range p.replicas {
		if err := replica.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close replica: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing connections: %v", errs)
	}

	return nil
}

// NewWorkloadRouter creates a router for workload isolation
// Inspired by OpenAI's approach to isolate noisy neighbors
func NewWorkloadRouter() *WorkloadRouter {
	return &WorkloadRouter{
		pools: make(map[WorkloadTier]*ReadReplicaPool),
	}
}

// RegisterPool registers a replica pool for a specific workload tier
func (r *WorkloadRouter) RegisterPool(tier WorkloadTier, pool *ReadReplicaPool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pools[tier] = pool
}

// GetPool returns the pool for a specific workload tier
func (r *WorkloadRouter) GetPool(tier WorkloadTier) (*ReadReplicaPool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	pool, ok := r.pools[tier]
	if !ok {
		return nil, fmt.Errorf("no pool registered for tier: %s", tier)
	}

	return pool, nil
}

// ExecuteRead executes a read query on the appropriate tier
func (r *WorkloadRouter) ExecuteRead(ctx context.Context, tier WorkloadTier, query string, args ...interface{}) (*sql.Rows, error) {
	pool, err := r.GetPool(tier)
	if err != nil {
		return nil, err
	}
	return pool.ExecuteRead(ctx, query, args...)
}

// ExecuteWrite executes a write query on the appropriate tier's primary
func (r *WorkloadRouter) ExecuteWrite(ctx context.Context, tier WorkloadTier, query string, args ...interface{}) (sql.Result, error) {
	pool, err := r.GetPool(tier)
	if err != nil {
		return nil, err
	}
	return pool.ExecuteWrite(ctx, query, args...)
}

// Close closes all pools
func (r *WorkloadRouter) Close() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	var errs []error
	for tier, pool := range r.pools {
		if err := pool.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close pool for tier %s: %w", tier, err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing pools: %v", errs)
	}

	return nil
}

// InsurancePlatformDB provides a high-level interface for the insurance platform
type InsurancePlatformDB struct {
	router *WorkloadRouter
}

// NewInsurancePlatformDB creates a new insurance platform database manager
func NewInsurancePlatformDB(config *PlatformDBConfig) (*InsurancePlatformDB, error) {
	router := NewWorkloadRouter()

	// Create pools for each tier
	for tier, tierConfig := range config.Tiers {
		pool, err := NewReadReplicaPool(tierConfig.Primary, tierConfig.Replicas)
		if err != nil {
			return nil, fmt.Errorf("failed to create pool for tier %s: %w", tier, err)
		}
		router.RegisterPool(tier, pool)
	}

	return &InsurancePlatformDB{router: router}, nil
}

// PlatformDBConfig holds configuration for all workload tiers
type PlatformDBConfig struct {
	Tiers map[WorkloadTier]TierConfig
}

// TierConfig holds configuration for a single workload tier
type TierConfig struct {
	Primary  PrimaryConfig
	Replicas []ReplicaConfig
}

// CustomerPortal returns a connection for customer-facing operations (high priority)
func (db *InsurancePlatformDB) CustomerPortal() (*ReadReplicaPool, error) {
	return db.router.GetPool(TierHighPriority)
}

// AgentPortal returns a connection for agent operations (medium priority)
func (db *InsurancePlatformDB) AgentPortal() (*ReadReplicaPool, error) {
	return db.router.GetPool(TierMediumPriority)
}

// Analytics returns a connection for analytics/reporting (low priority)
func (db *InsurancePlatformDB) Analytics() (*ReadReplicaPool, error) {
	return db.router.GetPool(TierLowPriority)
}

// FraudDetection returns a connection for Insurance Radar (isolated)
func (db *InsurancePlatformDB) FraudDetection() (*ReadReplicaPool, error) {
	return db.router.GetPool(TierIsolated)
}

// Close closes all database connections
func (db *InsurancePlatformDB) Close() error {
	return db.router.Close()
}
