// Package postgresql provides high availability configuration
// Inspired by OpenAI's PostgreSQL scaling with hot standby failover
package postgresql

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// HAConfig holds high availability configuration
type HAConfig struct {
	Primary        *PrimaryConfig
	HotStandby     *ReplicaConfig
	FailoverPolicy FailoverPolicy
	HealthCheck    HealthCheckConfig
}

// FailoverPolicy defines when and how to failover
type FailoverPolicy struct {
	AutoFailover          bool
	FailoverThreshold     int           // Number of failed health checks before failover
	FailoverCooldown      time.Duration // Minimum time between failovers
	RequireManualApproval bool          // For critical systems
}

// HealthCheckConfig defines health check parameters
type HealthCheckConfig struct {
	Interval        time.Duration
	Timeout         time.Duration
	SuccessRequired int // Consecutive successes to mark healthy
	FailureRequired int // Consecutive failures to mark unhealthy
}

// HAManager manages high availability for PostgreSQL
type HAManager struct {
	config         *HAConfig
	primary        *sql.DB
	standby        *sql.DB
	currentPrimary *sql.DB
	mu             sync.RWMutex

	// Health tracking
	primaryHealthy bool
	standbyHealthy bool
	failureCount   int
	lastFailover   time.Time

	// Callbacks
	onFailover     func(oldPrimary, newPrimary string)
	onHealthChange func(node string, healthy bool)

	ctx    context.Context
	cancel context.CancelFunc
}

// NewHAManager creates a new high availability manager
func NewHAManager(config *HAConfig) (*HAManager, error) {
	ctx, cancel := context.WithCancel(context.Background())

	ha := &HAManager{
		config:         config,
		primaryHealthy: true,
		standbyHealthy: true,
		ctx:            ctx,
		cancel:         cancel,
	}

	// Connect to primary
	primaryDSN := fmt.Sprintf(
		"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
		config.Primary.Host, config.Primary.Port, config.Primary.Database,
		config.Primary.User, config.Primary.Password, config.Primary.SSLMode,
	)

	primary, err := sql.Open("postgres", primaryDSN)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to connect to primary: %w", err)
	}

	primary.SetMaxOpenConns(config.Primary.MaxConns)
	ha.primary = primary
	ha.currentPrimary = primary

	// Connect to hot standby
	if config.HotStandby != nil {
		standbyDSN := fmt.Sprintf(
			"host=%s port=%d dbname=%s user=%s password=%s sslmode=%s",
			config.HotStandby.Host, config.HotStandby.Port, config.HotStandby.Database,
			config.HotStandby.User, config.HotStandby.Password, config.HotStandby.SSLMode,
		)

		standby, err := sql.Open("postgres", standbyDSN)
		if err != nil {
			// Log warning but continue - standby is optional
			fmt.Printf("Warning: failed to connect to hot standby: %v\n", err)
		} else {
			standby.SetMaxOpenConns(config.HotStandby.MaxConns)
			ha.standby = standby
		}
	}

	// Start health check loop
	go ha.healthCheckLoop()

	return ha, nil
}

// healthCheckLoop continuously monitors primary and standby health
func (ha *HAManager) healthCheckLoop() {
	ticker := time.NewTicker(ha.config.HealthCheck.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ha.ctx.Done():
			return
		case <-ticker.C:
			ha.checkHealth()
		}
	}
}

// checkHealth checks the health of primary and standby
func (ha *HAManager) checkHealth() {
	ha.mu.Lock()
	defer ha.mu.Unlock()

	// Check primary health
	ctx, cancel := context.WithTimeout(ha.ctx, ha.config.HealthCheck.Timeout)
	primaryHealthy := ha.checkNodeHealth(ctx, ha.primary)
	cancel()

	if primaryHealthy != ha.primaryHealthy {
		ha.primaryHealthy = primaryHealthy
		if ha.onHealthChange != nil {
			ha.onHealthChange("primary", primaryHealthy)
		}
	}

	// Check standby health
	if ha.standby != nil {
		ctx, cancel := context.WithTimeout(ha.ctx, ha.config.HealthCheck.Timeout)
		standbyHealthy := ha.checkNodeHealth(ctx, ha.standby)
		cancel()

		if standbyHealthy != ha.standbyHealthy {
			ha.standbyHealthy = standbyHealthy
			if ha.onHealthChange != nil {
				ha.onHealthChange("standby", standbyHealthy)
			}
		}
	}

	// Handle primary failure
	if !ha.primaryHealthy {
		ha.failureCount++

		if ha.failureCount >= ha.config.FailoverPolicy.FailoverThreshold {
			ha.attemptFailover()
		}
	} else {
		ha.failureCount = 0
	}
}

// checkNodeHealth checks if a database node is healthy
func (ha *HAManager) checkNodeHealth(ctx context.Context, db *sql.DB) bool {
	if db == nil {
		return false
	}

	// Simple ping check
	if err := db.PingContext(ctx); err != nil {
		return false
	}

	// Verify we can execute a query
	var result int
	err := db.QueryRowContext(ctx, "SELECT 1").Scan(&result)
	return err == nil && result == 1
}

// attemptFailover attempts to failover to the hot standby
func (ha *HAManager) attemptFailover() {
	// Check cooldown
	if time.Since(ha.lastFailover) < ha.config.FailoverPolicy.FailoverCooldown {
		fmt.Println("Failover cooldown active, skipping")
		return
	}

	// Check if auto failover is enabled
	if !ha.config.FailoverPolicy.AutoFailover {
		fmt.Println("Auto failover disabled, manual intervention required")
		return
	}

	// Check if standby is available
	if ha.standby == nil || !ha.standbyHealthy {
		fmt.Println("Hot standby not available for failover")
		return
	}

	// Perform failover
	oldPrimary := ha.currentPrimary
	ha.currentPrimary = ha.standby
	ha.lastFailover = time.Now()
	ha.failureCount = 0

	fmt.Println("Failover completed: switched to hot standby")

	if ha.onFailover != nil {
		ha.onFailover(ha.config.Primary.Host, ha.config.HotStandby.Host)
	}

	// Try to close old primary connection
	if oldPrimary != nil {
		go func() {
			time.Sleep(5 * time.Second)
			_ = oldPrimary.Close()
		}()
	}
}

// GetPrimary returns the current primary connection
func (ha *HAManager) GetPrimary() *sql.DB {
	ha.mu.RLock()
	defer ha.mu.RUnlock()
	return ha.currentPrimary
}

// GetStandby returns the standby connection (for read-only queries)
func (ha *HAManager) GetStandby() *sql.DB {
	ha.mu.RLock()
	defer ha.mu.RUnlock()
	return ha.standby
}

// IsPrimaryHealthy returns the health status of the primary
func (ha *HAManager) IsPrimaryHealthy() bool {
	ha.mu.RLock()
	defer ha.mu.RUnlock()
	return ha.primaryHealthy
}

// IsStandbyHealthy returns the health status of the standby
func (ha *HAManager) IsStandbyHealthy() bool {
	ha.mu.RLock()
	defer ha.mu.RUnlock()
	return ha.standbyHealthy
}

// OnFailover sets the callback for failover events
func (ha *HAManager) OnFailover(callback func(oldPrimary, newPrimary string)) {
	ha.mu.Lock()
	defer ha.mu.Unlock()
	ha.onFailover = callback
}

// OnHealthChange sets the callback for health change events
func (ha *HAManager) OnHealthChange(callback func(node string, healthy bool)) {
	ha.mu.Lock()
	defer ha.mu.Unlock()
	ha.onHealthChange = callback
}

// ManualFailover triggers a manual failover (for maintenance)
func (ha *HAManager) ManualFailover() error {
	ha.mu.Lock()
	defer ha.mu.Unlock()

	if ha.standby == nil {
		return fmt.Errorf("no hot standby available")
	}

	if !ha.standbyHealthy {
		return fmt.Errorf("hot standby is not healthy")
	}

	ha.attemptFailover()
	return nil
}

// Close closes all database connections
func (ha *HAManager) Close() error {
	ha.cancel()

	var errs []error

	if ha.primary != nil {
		if err := ha.primary.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close primary: %w", err))
		}
	}

	if ha.standby != nil {
		if err := ha.standby.Close(); err != nil {
			errs = append(errs, fmt.Errorf("failed to close standby: %w", err))
		}
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing connections: %v", errs)
	}

	return nil
}

// HAStatus represents the current HA status
type HAStatus struct {
	PrimaryHost    string
	PrimaryHealthy bool
	StandbyHost    string
	StandbyHealthy bool
	CurrentPrimary string
	LastFailover   time.Time
	FailureCount   int
	AutoFailover   bool
}

// GetStatus returns the current HA status
func (ha *HAManager) GetStatus() *HAStatus {
	ha.mu.RLock()
	defer ha.mu.RUnlock()

	status := &HAStatus{
		PrimaryHost:    ha.config.Primary.Host,
		PrimaryHealthy: ha.primaryHealthy,
		LastFailover:   ha.lastFailover,
		FailureCount:   ha.failureCount,
		AutoFailover:   ha.config.FailoverPolicy.AutoFailover,
	}

	if ha.config.HotStandby != nil {
		status.StandbyHost = ha.config.HotStandby.Host
		status.StandbyHealthy = ha.standbyHealthy
	}

	if ha.currentPrimary == ha.primary {
		status.CurrentPrimary = ha.config.Primary.Host
	} else if ha.config.HotStandby != nil {
		status.CurrentPrimary = ha.config.HotStandby.Host
	}

	return status
}

// ReplicationLag tracks replication lag between primary and replicas
type ReplicationLag struct {
	db *sql.DB
}

// NewReplicationLag creates a new replication lag monitor
func NewReplicationLag(db *sql.DB) *ReplicationLag {
	return &ReplicationLag{db: db}
}

// GetLag returns the current replication lag in bytes
func (rl *ReplicationLag) GetLag(ctx context.Context) (int64, error) {
	var lag int64
	err := rl.db.QueryRowContext(ctx, `
		SELECT COALESCE(
			pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn),
			0
		)
		FROM pg_stat_replication
		LIMIT 1
	`).Scan(&lag)

	if err != nil {
		return 0, fmt.Errorf("failed to get replication lag: %w", err)
	}

	return lag, nil
}

// GetLagSeconds returns the current replication lag in seconds
func (rl *ReplicationLag) GetLagSeconds(ctx context.Context) (float64, error) {
	var lag float64
	err := rl.db.QueryRowContext(ctx, `
		SELECT COALESCE(
			EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())),
			0
		)
	`).Scan(&lag)

	if err != nil {
		return 0, fmt.Errorf("failed to get replication lag: %w", err)
	}

	return lag, nil
}
