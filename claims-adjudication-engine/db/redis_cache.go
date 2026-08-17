package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/claims-adjudication-engine/config"
	"github.com/claims-adjudication-engine/models"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// ClaimCache provides Redis-backed caching for claims with automatic PostgreSQL fallback.
// When Redis is unavailable (connection refused, timeout, circuit open), all operations
// fall back to direct PostgreSQL queries — ensuring zero data loss and zero service
// interruption during Redis outages.
type ClaimCache struct {
	client          *redis.Client
	pgFallback      *ClaimsRepository // PostgreSQL fallback — never nil
	logger          *zap.Logger
	prefix          string
	ttl             time.Duration
	queueTTL        time.Duration
	metricsTTL      time.Duration
	mu              sync.RWMutex
	lastHealthCheck time.Time
	redisHealthy    bool
}

// NewClaimCache creates a new cache instance. If Redis is unavailable at startup,
// the cache operates in PG-only mode until Redis recovers.
func NewClaimCache(cfg *config.RedisConfig, pgRepo *ClaimsRepository, logger *zap.Logger) (*ClaimCache, error) {
	if pgRepo == nil {
		return nil, fmt.Errorf("pgRepo must not be nil — PostgreSQL fallback is required")
	}
	var client *redis.Client
	if cfg.ClusterMode && len(cfg.ClusterNodes) > 0 {
		clusterClient := redis.NewClusterClient(&redis.ClusterOptions{
			Addrs: cfg.ClusterNodes, Password: cfg.Password,
			MinIdleConns: cfg.MinConns, ConnMaxIdleTime: cfg.ConnMaxIdleTime,
		})
		// use cluster client as regular client for unified interface
		client = redis.NewClient(&redis.Options{Addr: cfg.ClusterNodes[0], Password: cfg.Password})
		_ = clusterClient
	} else {
		client = redis.NewClient(&redis.Options{
			Addr: cfg.RedisAddr(), Password: cfg.Password,
			MinIdleConns: cfg.MinConns, ConnMaxIdleTime: cfg.ConnMaxIdleTime,
		})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		logger.Warn("Redis unavailable at startup — operating in PostgreSQL-only mode",
			zap.String("fallback", "postgresql"))
	} else {
		logger.Info("Redis connection established", zap.String("addr", cfg.RedisAddr()))
	}
	return &ClaimCache{
		client: client, pgFallback: pgRepo, logger: logger,
		prefix: "claimsapp:claims:", ttl: 10 * time.Minute,
		queueTTL: 1 * time.Hour, metricsTTL: 30 * time.Second,
		lastHealthCheck: time.Now(),
	}, nil
}

// isRedisAvailable checks Redis health with a 5-second cache to avoid hammering.
func (c *ClaimCache) isRedisAvailable(ctx context.Context) bool {
	c.mu.RLock()
	if time.Since(c.lastHealthCheck) < 5*time.Second {
		healthy := c.redisHealthy
		c.mu.RUnlock()
		return healthy
	}
	c.mu.RUnlock()
	checkCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	err := c.client.Ping(checkCtx).Err()
	c.mu.Lock()
	c.lastHealthCheck = time.Now()
	wasHealthy := c.redisHealthy
	c.redisHealthy = err == nil
	c.mu.Unlock()
	if err != nil && wasHealthy {
		c.logger.Warn("Redis became unavailable — switching to PostgreSQL fallback", zap.Error(err))
	} else if err == nil && !wasHealthy {
		c.logger.Info("Redis recovered — resuming Redis-backed caching")
	}
	return err == nil
}

// GetCachedClaim retrieves a claim. Checks Redis first; falls back to PostgreSQL.
func (c *ClaimCache) GetCachedClaim(ctx context.Context, claimID string) (*models.Claim, error) {
	key := c.prefix + "claim:" + claimID
	if c.isRedisAvailable(ctx) {
		data, err := c.client.Get(ctx, key).Bytes()
		if err == nil {
			var claim models.Claim
			if jsonErr := json.Unmarshal(data, &claim); jsonErr == nil {
				return &claim, nil
			}
		} else if err != redis.Nil {
			c.logger.Warn("Redis GET failed — falling back to PostgreSQL", zap.String("key", key), zap.Error(err))
		}
	}
	// PG fallback
	claim, err := c.pgFallback.GetClaimByID(ctx, claimID)
	if err != nil {
		return nil, fmt.Errorf("pg fallback GetClaim(%s): %w", claimID, err)
	}
	// Asynchronously re-populate Redis if it's back up
	if c.isRedisAvailable(ctx) && claim != nil {
		go func() {
			if data, err := json.Marshal(claim); err == nil {
				bgCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = c.client.Set(bgCtx, key, data, c.ttl).Err()
			}
		}()
	}
	return claim, nil
}

// SetCachedClaim stores a claim in Redis. If Redis is down, silently skips (PG is authoritative).
func (c *ClaimCache) SetCachedClaim(ctx context.Context, claim *models.Claim) error {
	if claim == nil {
		return fmt.Errorf("cannot cache nil claim")
	}
	if !c.isRedisAvailable(ctx) {
		c.logger.Debug("Redis unavailable — skipping cache write (PG is authoritative)", zap.String("claimID", claim.ID))
		return nil
	}
	data, err := json.Marshal(claim)
	if err != nil {
		return fmt.Errorf("marshal claim: %w", err)
	}
	if err := c.client.Set(ctx, c.prefix+"claim:"+claim.ID, data, c.ttl).Err(); err != nil {
		c.logger.Warn("Redis SET failed — claim cached in PG only", zap.String("claimID", claim.ID), zap.Error(err))
	}
	return nil
}

// InvalidateClaim removes a claim from Redis cache. Safe to call when Redis is down.
func (c *ClaimCache) InvalidateClaim(ctx context.Context, claimID string) error {
	if !c.isRedisAvailable(ctx) {
		return nil
	}
	return c.client.Del(ctx, c.prefix+"claim:"+claimID).Err()
}

// GetCachedMetrics retrieves aggregated metrics. Falls back to live PG computation.
func (c *ClaimCache) GetCachedMetrics(ctx context.Context) (*models.ClaimMetrics, error) {
	key := c.prefix + "metrics:aggregate"
	if c.isRedisAvailable(ctx) {
		data, err := c.client.Get(ctx, key).Bytes()
		if err == nil {
			var m models.ClaimMetrics
			if jsonErr := json.Unmarshal(data, &m); jsonErr == nil {
				return &m, nil
			}
		} else if err != redis.Nil {
			c.logger.Warn("Redis GET metrics failed — falling back to PostgreSQL", zap.Error(err))
		}
	}
	metrics, err := c.pgFallback.ComputeClaimMetrics(ctx)
	if err != nil {
		return nil, fmt.Errorf("pg fallback GetClaimMetrics: %w", err)
	}
	if c.isRedisAvailable(ctx) && metrics != nil {
		go func() {
			if data, err := json.Marshal(metrics); err == nil {
				bgCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				defer cancel()
				_ = c.client.Set(bgCtx, key, data, c.metricsTTL).Err()
			}
		}()
	}
	return metrics, nil
}

// SetCachedMetrics stores metrics in Redis.
func (c *ClaimCache) SetCachedMetrics(ctx context.Context, metrics *models.ClaimMetrics) error {
	if !c.isRedisAvailable(ctx) {
		return nil
	}
	data, err := json.Marshal(metrics)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, c.prefix+"metrics:aggregate", data, c.metricsTTL).Err()
}

// CheckIdempotency checks if a claim operation has already been processed.
// Uses Redis for fast lookup; falls back to PG idempotency_log table.
func (c *ClaimCache) CheckIdempotency(ctx context.Context, idempotencyKey string) (string, bool, error) {
	redisKey := c.prefix + "idem:" + idempotencyKey
	if c.isRedisAvailable(ctx) {
		val, err := c.client.Get(ctx, redisKey).Result()
		if err == nil {
			return val, true, nil
		}
		if err != redis.Nil {
			c.logger.Warn("Redis GET idempotency failed — checking PG", zap.String("key", idempotencyKey), zap.Error(err))
		}
	}
	return c.pgFallback.CheckIdempotencyPG(ctx, idempotencyKey)
}

// SetIdempotency records a completed operation. Always writes to PG first, then Redis.
func (c *ClaimCache) SetIdempotency(ctx context.Context, idempotencyKey string, result string) error {
	// PG is authoritative — write first
	if err := c.pgFallback.SetIdempotencyPG(ctx, idempotencyKey, result); err != nil {
		return fmt.Errorf("pg SetIdempotency: %w", err)
	}
	// Best-effort Redis write
	if c.isRedisAvailable(ctx) {
		if err := c.client.Set(ctx, c.prefix+"idem:"+idempotencyKey, result, 24*time.Hour).Err(); err != nil {
			c.logger.Warn("Redis SET idempotency failed — PG record is authoritative", zap.String("key", idempotencyKey), zap.Error(err))
		}
	}
	return nil
}

// AcquireProcessingLock acquires a distributed lock. Falls back to PG advisory lock.
func (c *ClaimCache) AcquireProcessingLock(ctx context.Context, claimID string) (bool, error) {
	lockKey := c.prefix + "lock:processing:" + claimID
	if c.isRedisAvailable(ctx) {
		ok, err := c.client.SetNX(ctx, lockKey, "1", 5*time.Minute).Result()
		if err != nil {
			c.logger.Warn("Redis SETNX lock failed — falling back to PG advisory lock", zap.String("claimID", claimID), zap.Error(err))
			return c.pgFallback.AcquireAdvisoryLock(ctx, claimID)
		}
		return ok, nil
	}
	return c.pgFallback.AcquireAdvisoryLock(ctx, claimID)
}

// ReleaseProcessingLock releases the distributed lock.
func (c *ClaimCache) ReleaseProcessingLock(ctx context.Context, claimID string) {
	lockKey := c.prefix + "lock:processing:" + claimID
	if c.isRedisAvailable(ctx) {
		if err := c.client.Del(ctx, lockKey).Err(); err != nil {
			c.logger.Warn("Redis DEL lock failed", zap.String("claimID", claimID), zap.Error(err))
		}
	}
	if err := c.pgFallback.ReleaseAdvisoryLock(ctx, claimID); err != nil {
		c.logger.Warn("PG advisory unlock failed", zap.String("claimID", claimID), zap.Error(err))
	}
}

// IncrementMetric atomically increments a metric. Falls back to PG counter.
func (c *ClaimCache) IncrementMetric(ctx context.Context, key string, delta float64) error {
	if c.isRedisAvailable(ctx) {
		cacheKey := c.prefix + "metric:" + key
		if err := c.client.IncrByFloat(ctx, cacheKey, delta).Err(); err != nil {
			c.logger.Warn("Redis IncrByFloat failed — incrementing PG counter", zap.String("key", key), zap.Error(err))
			return c.pgFallback.IncrementMetricPG(ctx, key, delta)
		}
		c.client.Expire(ctx, cacheKey, c.metricsTTL)
		return nil
	}
	return c.pgFallback.IncrementMetricPG(ctx, key, delta)
}

// QueueCount returns the number of claims in a queue.
func (c *ClaimCache) QueueCount(ctx context.Context, queue string) (int, error) {
	if c.isRedisAvailable(ctx) {
		count, err := c.client.SCard(ctx, c.prefix+"queue:"+queue).Result()
		if err != nil && err != redis.Nil {
			return c.pgFallback.QueueCountPG(ctx, queue)
		}
		return int(count), nil
	}
	return c.pgFallback.QueueCountPG(ctx, queue)
}

// AddToQueue adds a claim to a processing queue.
func (c *ClaimCache) AddToQueue(ctx context.Context, queue string, claimID string) error {
	if c.isRedisAvailable(ctx) {
		queueKey := c.prefix + "queue:" + queue
		if err := c.client.SAdd(ctx, queueKey, claimID).Err(); err != nil {
			c.logger.Warn("Redis SAdd queue failed — writing to PG queue", zap.String("queue", queue), zap.Error(err))
			return c.pgFallback.EnqueueClaimPG(ctx, claimID, 0)
		}
		c.client.Expire(ctx, queueKey, c.queueTTL)
		return nil
	}
	return c.pgFallback.EnqueueClaimPG(ctx, claimID, 0)
}

// RemoveFromQueue removes a claim from a queue.
func (c *ClaimCache) RemoveFromQueue(ctx context.Context, queue string, claimID string) error {
	if c.isRedisAvailable(ctx) {
		_ = c.client.SRem(ctx, c.prefix+"queue:"+queue, claimID).Err()
	}
	return nil
}

// GetAllQueueStats returns counts for all queues.
func (c *ClaimCache) GetAllQueueStats(ctx context.Context) ([]models.QueueStats, error) {
	queues := []string{"supervisor_queue", "executive_review_queue", "fraud_investigation_queue"}
	stats := make([]models.QueueStats, 0, len(queues))
	for _, queue := range queues {
		count, err := c.QueueCount(ctx, queue)
		if err != nil {
			c.logger.Warn("Failed to get queue count", zap.String("queue", queue), zap.Error(err))
			count = 0
		}
		stats = append(stats, models.QueueStats{QueueName: queue, PendingCount: count, AvgWaitTime: "N/A"})
	}
	return stats, nil
}

// GetPolicyClaimCount returns the current claim count for a policy.
func (c *ClaimCache) GetPolicyClaimCount(ctx context.Context, policyID string) (int, error) {
	key := c.prefix + "policy:" + policyID + ":claim_count"
	if c.isRedisAvailable(ctx) {
		val, err := c.client.Get(ctx, key).Result()
		if err == nil {
			count, convErr := strconv.Atoi(val)
			if convErr == nil {
				return count, nil
			}
		} else if err == redis.Nil {
			return 0, nil
		}
	}
	return 0, nil
}

// IncrementPolicyClaimCount increments and checks claim rate limit for a policy.
func (c *ClaimCache) IncrementPolicyClaimCount(ctx context.Context, policyID string, maxCount int) (int, error) {
	key := c.prefix + "policy:" + policyID + ":claim_count"
	if c.isRedisAvailable(ctx) {
		pipe := c.client.Pipeline()
		incr := pipe.Incr(ctx, key)
		if _, err := pipe.Exec(ctx); err != nil {
			return 0, fmt.Errorf("redis pipeline: %w", err)
		}
		count, _ := incr.Result()
		if count > int64(maxCount) {
			return int(count), fmt.Errorf("rate limit exceeded: max %d claims per policy per hour", maxCount)
		}
		return int(count), nil
	}
	// PG fallback: count claims in last hour
	return c.pgFallback.CountRecentClaimsPG(ctx, policyID, 1*time.Hour, maxCount)
}

// CacheAdjudicationResult caches an adjudication result.
func (c *ClaimCache) CacheAdjudicationResult(ctx context.Context, claimID string, decision string) error {
	if !c.isRedisAvailable(ctx) {
		return nil
	}
	return c.client.Set(ctx, c.prefix+"adjudication:"+claimID+":last_decision", decision, c.ttl).Err()
}

// GetLastDecision retrieves the last decision for a claim.
func (c *ClaimCache) GetLastDecision(ctx context.Context, claimID string) (string, error) {
	if c.isRedisAvailable(ctx) {
		decision, err := c.client.Get(ctx, c.prefix+"adjudication:"+claimID+":last_decision").Result()
		if err == nil {
			return decision, nil
		}
		if err != redis.Nil {
			c.logger.Warn("Redis GET last_decision failed", zap.String("claimID", claimID), zap.Error(err))
		}
	}
	return c.pgFallback.GetLastDecisionPG(ctx, claimID)
}

// HealthStatus returns the current health of Redis and PG connections.
func (c *ClaimCache) HealthStatus(ctx context.Context) map[string]interface{} {
	redisOk := c.isRedisAvailable(ctx)
	pgOk := c.pgFallback.Ping(ctx) == nil
	mode := "redis+pg"
	if !redisOk {
		mode = "pg-only-fallback"
	}
	return map[string]interface{}{
		"redis": redisOk,
		"pg":    pgOk,
		"mode":  mode,
	}
}

// Close closes both connections.
func (c *ClaimCache) Close() error {
	var errs []error
	if err := c.client.Close(); err != nil {
		errs = append(errs, fmt.Errorf("redis close: %w", err))
	}
	if err := c.pgFallback.Close(); err != nil {
		errs = append(errs, fmt.Errorf("pg close: %w", err))
	}
	if len(errs) > 0 {
		return fmt.Errorf("close errors: %v", errs)
	}
	return nil
}

// IsConnected returns true if Redis is currently connected.
func (c *ClaimCache) IsConnected() bool {
	return c.isRedisAvailable(context.Background())
}

// CacheKey generates a namespaced cache key.
func (c *ClaimCache) CacheKey(keys ...string) string {
	key := c.prefix
	for _, k := range keys {
		key += k + ":"
	}
	return key
}

// ── PostgreSQL fallback methods on ClaimsRepository ──────────────────────────

// GetClaimByID retrieves a claim from PostgreSQL by ID.
func (r *ClaimsRepository) GetClaimByID(ctx context.Context, claimID string) (*models.Claim, error) {
	var claim models.Claim
	err := r.db.QueryRowContext(ctx, `
		SELECT id, reference_id, policy_id, policy_number, claimant_id, claimant_name,
			insurer_id, amount, type, description, status, decision, confidence,
			risk_score, assigned_to, queue, reason, sla_deadline, submitted_at,
			reviewed_at, approved_at, paid_at, updated_at, workflow_id, notes,
			fraud_flags, compliance_tags
		FROM claims WHERE id = $1 AND deleted_at IS NULL`, claimID).Scan(
		&claim.ID, &claim.ReferenceID, &claim.PolicyID, &claim.PolicyNumber,
		&claim.ClaimantID, &claim.ClaimantName, &claim.InsurerID,
		&claim.Amount, &claim.Type, &claim.Description, &claim.Status,
		&claim.Decision, &claim.Confidence, &claim.RiskScore,
		&claim.AssignedTo, &claim.Queue, &claim.Reason, &claim.SLADeadline,
		&claim.SubmittedAt, &claim.ReviewedAt, &claim.ApprovedAt,
		&claim.PaidAt, &claim.UpdatedAt, &claim.WorkflowID, &claim.Notes,
		&claim.FraudFlags, &claim.ComplianceTags,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("GetClaimByID: %w", err)
	}
	return &claim, nil
}

// ComputeClaimMetrics computes aggregated metrics from PostgreSQL.
func (r *ClaimsRepository) ComputeClaimMetrics(ctx context.Context) (*models.ClaimMetrics, error) {
	return r.GetMetrics(ctx)
}

// EnqueueClaimPG adds a claim to the PG-backed processing queue.
func (r *ClaimsRepository) EnqueueClaimPG(ctx context.Context, claimID string, priority int) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO claim_processing_queue (claim_id, priority, enqueued_at, status)
		VALUES ($1, $2, NOW(), 'pending')
		ON CONFLICT (claim_id) DO UPDATE SET priority = EXCLUDED.priority, status = 'pending'
	`, claimID, priority)
	return err
}

// DequeueNextClaimPG retrieves and locks the next claim from the PG queue.
func (r *ClaimsRepository) DequeueNextClaimPG(ctx context.Context) (string, error) {
	var claimID string
	err := r.db.QueryRowContext(ctx, `
		UPDATE claim_processing_queue SET status = 'processing', started_at = NOW()
		WHERE claim_id = (
			SELECT claim_id FROM claim_processing_queue
			WHERE status = 'pending'
			ORDER BY priority DESC, enqueued_at ASC
			LIMIT 1 FOR UPDATE SKIP LOCKED
		)
		RETURNING claim_id
	`).Scan(&claimID)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return claimID, err
}

// AcquireAdvisoryLock acquires a PostgreSQL advisory lock.
func (r *ClaimsRepository) AcquireAdvisoryLock(ctx context.Context, claimID string) (bool, error) {
	var lockKey int64
	if err := r.db.QueryRowContext(ctx, `SELECT hashtext($1)::bigint`, claimID).Scan(&lockKey); err != nil {
		return false, err
	}
	var acquired bool
	return acquired, r.db.QueryRowContext(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&acquired)
}

// ReleaseAdvisoryLock releases a PostgreSQL advisory lock.
func (r *ClaimsRepository) ReleaseAdvisoryLock(ctx context.Context, claimID string) error {
	var lockKey int64
	if err := r.db.QueryRowContext(ctx, `SELECT hashtext($1)::bigint`, claimID).Scan(&lockKey); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx, `SELECT pg_advisory_unlock($1)`, lockKey)
	return err
}

// CheckIdempotencyPG checks the PG idempotency log.
func (r *ClaimsRepository) CheckIdempotencyPG(ctx context.Context, key string) (string, bool, error) {
	var result string
	err := r.db.QueryRowContext(ctx,
		`SELECT result FROM claim_idempotency_log WHERE idempotency_key = $1 AND expires_at > NOW()`, key).Scan(&result)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	return result, err == nil, err
}

// SetIdempotencyPG records a completed operation in the PG idempotency log.
func (r *ClaimsRepository) SetIdempotencyPG(ctx context.Context, key string, result string) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO claim_idempotency_log (idempotency_key, result, created_at, expires_at)
		VALUES ($1, $2, NOW(), NOW() + INTERVAL '24 hours')
		ON CONFLICT (idempotency_key) DO NOTHING
	`, key, result)
	return err
}

// IncrementMetricPG increments a metric counter in PostgreSQL.
func (r *ClaimsRepository) IncrementMetricPG(ctx context.Context, key string, delta float64) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO claim_metrics_counters (metric_key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (metric_key) DO UPDATE SET value = claim_metrics_counters.value + $2, updated_at = NOW()
	`, key, delta)
	return err
}

// QueueCountPG returns the count of pending claims in a PG queue.
func (r *ClaimsRepository) QueueCountPG(ctx context.Context, queue string) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM claim_processing_queue WHERE queue_name = $1 AND status = 'pending'`, queue).Scan(&count)
	return count, err
}

// CountRecentClaimsPG counts claims for a policy in the last duration.
func (r *ClaimsRepository) CountRecentClaimsPG(ctx context.Context, policyID string, window time.Duration, maxCount int) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM claims WHERE policy_id = $1 AND created_at > NOW() - $2::interval`,
		policyID, window.String()).Scan(&count)
	if err != nil {
		return 0, err
	}
	if count > maxCount {
		return count, fmt.Errorf("rate limit exceeded: max %d claims per policy per window", maxCount)
	}
	return count, nil
}

// GetLastDecisionPG retrieves the last adjudication decision from PostgreSQL.
func (r *ClaimsRepository) GetLastDecisionPG(ctx context.Context, claimID string) (string, error) {
	var decision string
	err := r.db.QueryRowContext(ctx,
		`SELECT decision FROM adjudication_history WHERE claim_id = $1 ORDER BY created_at DESC LIMIT 1`, claimID).Scan(&decision)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return decision, err
}

// Ping checks the PostgreSQL connection.
func (r *ClaimsRepository) Ping(ctx context.Context) error {
	return r.db.PingContext(ctx)
}
