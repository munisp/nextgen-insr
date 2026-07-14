package db

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/claims-adjudication-engine/config"
	"github.com/claims-adjudication-engine/models"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// ClaimCache provides Redis-backed caching for claims and metrics
type ClaimCache struct {
	client     *redis.Client
	logger     *zap.Logger
	prefix     string
	ttl        time.Duration
	queueTTL   time.Duration
	metricsTTL time.Duration
}

// NewClaimCache creates a new Redis cache instance
func NewClaimCache(cfg *config.RedisConfig, logger *zap.Logger) (*ClaimCache, error) {
	var client *redis.Client

	if cfg.ClusterMode && len(cfg.ClusterNodes) > 0 {
		client = redis.NewClusterClient(&redis.ClusterOptions{
			Addrs:             cfg.ClusterNodes,
			Password:          cfg.Password,
			MaxRetries:      cfg.MaxRetries,
			PoolSize:        cfg.PoolSize,
			MinIdleConns:    cfg.MinConns,
			ConnMaxIdleTime: cfg.ConnMaxIdleTime,
		})
	} else {
		client = redis.NewClient(&redis.Options{
			Addr:            cfg.RedisAddr(),
			Password:        cfg.Password,
			DB:              cfg.DB,
			MaxRetries:      cfg.MaxRetries,
			PoolSize:        cfg.PoolSize,
			MinIdleConns:    cfg.MinConns,
			ConnMaxIdleTime: cfg.ConnMaxIdleTime,
		})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		logger.Warn("Redis connection failed, caching disabled", zap.Error(err))
		return &ClaimCache{
			client:     client,
			logger:     logger,
			prefix:     "ngapp:claims:",
			ttl:        10 * time.Minute,
			queueTTL:   1 * time.Minute,
			metricsTTL: 30 * time.Second,
		}, nil
	}

	logger.Info("Redis connection established", zap.String("addr", cfg.RedisAddr()))

	return &ClaimCache{
		client:     client,
		logger:     logger,
		prefix:     "ngapp:claims:",
		ttl:        10 * time.Minute,
		queueTTL:   1 * time.Minute,
		metricsTTL: 30 * time.Second,
	}, nil
}

// Close closes the Redis connection
func (c *ClaimCache) Close() error {
	return c.client.Close()
}

// IsConnected returns true if Redis is connected
func (c *ClaimCache) IsConnected() bool {
	ctx := context.Background()
	return c.client.Ping(ctx).Err() == nil
}

// CacheKey generates a cache key with prefix
func (c *ClaimCache) CacheKey(keys ...string) string {
	key := c.prefix
	for _, k := range keys {
		key += k + ":"
	}
	return key
}

// GetCachedClaim retrieves a claim from cache
func (c *ClaimCache) GetCachedClaim(ctx context.Context, claimID string) (*models.Claim, error) {
	cacheKey := c.CacheKey("claim", claimID)

	data, err := c.client.Get(ctx, cacheKey).Bytes()
	if err == redis.Nil {
		return nil, nil // cache miss
	}
	if err != nil {
		c.logger.Error("Failed to get claim from cache", zap.String("key", cacheKey), zap.Error(err))
		return nil, err
	}

	var claim models.Claim
	if err := json.Unmarshal(data, &claim); err != nil {
		c.logger.Error("Failed to unmarshal cached claim", zap.Error(err))
		return nil, err
	}

	c.logger.Debug("Cache hit for claim", zap.String("claim_id", claimID))
	return &claim, nil
}

// SetCachedClaim stores a claim in cache
func (c *ClaimCache) SetCachedClaim(ctx context.Context, claim *models.Claim) error {
	cacheKey := c.CacheKey("claim", claim.ID)

	data, err := json.Marshal(claim)
	if err != nil {
		return fmt.Errorf("failed to marshal claim for cache: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey, data, c.ttl).Err(); err != nil {
		c.logger.Error("Failed to set claim in cache", zap.String("claim_id", claim.ID), zap.Error(err))
		return err
	}

	c.logger.Debug("Claim cached", zap.String("claim_id", claim.ID))
	return nil
}

// InvalidateClaim removes a claim from cache
func (c *ClaimCache) InvalidateClaim(ctx context.Context, claimID string) error {
	cacheKey := c.CacheKey("claim", claimID)
	return c.client.Del(ctx, cacheKey).Err()
}

// GetCachedMetrics retrieves metrics from cache
func (c *ClaimCache) GetCachedMetrics(ctx context.Context) (*models.ClaimMetrics, error) {
	cacheKey := c.CacheKey("metrics")

	data, err := c.client.Get(ctx, cacheKey).Bytes()
	if err == redis.Nil {
		return nil, nil // cache miss
	}
	if err != nil {
		c.logger.Error("Failed to get metrics from cache", zap.Error(err))
		return nil, err
	}

	var metrics models.ClaimMetrics
	if err := json.Unmarshal(data, &metrics); err != nil {
		c.logger.Error("Failed to unmarshal cached metrics", zap.Error(err))
		return nil, err
	}

	return &metrics, nil
}

// SetCachedMetrics stores metrics in cache
func (c *ClaimCache) SetCachedMetrics(ctx context.Context, metrics *models.ClaimMetrics) error {
	cacheKey := c.CacheKey("metrics")

	data, err := json.Marshal(metrics)
	if err != nil {
		return fmt.Errorf("failed to marshal metrics for cache: %w", err)
	}

	if err := c.client.Set(ctx, cacheKey, data, c.metricsTTL).Err(); err != nil {
		c.logger.Error("Failed to set metrics in cache", zap.Error(err))
		return err
	}

	return nil
}

// IncrementMetric atomically increments a metric in cache
func (c *ClaimCache) IncrementMetric(ctx context.Context, key string, delta float64) error {
	cacheKey := c.CacheKey("metrics", key)
	if err := c.client.IncrByFloat(ctx, cacheKey, delta).Err(); err != nil {
		return fmt.Errorf("failed to increment metric %s: %w", key, err)
	}
	c.client.Expire(ctx, cacheKey, c.metricsTTL)
	return nil
}

// QueueCount returns the current number of claims in a queue
func (c *ClaimCache) QueueCount(ctx context.Context, queue string) (int, error) {
	queueKey := c.CacheKey("queue", queue)
	count, err := c.client.SCard(ctx, queueKey).Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get queue count: %w", err)
	}
	return int(count), nil
}

// AddToQueue adds a claim to a queue
func (c *ClaimCache) AddToQueue(ctx context.Context, queue string, claimID string) error {
	queueKey := c.CacheKey("queue", queue)
	if err := c.client.SAdd(ctx, queueKey, claimID).Err(); err != nil {
		return fmt.Errorf("failed to add to queue: %w", err)
	}
	c.client.Expire(ctx, queueKey, c.queueTTL)
	return nil
}

// RemoveFromQueue removes a claim from a queue
func (c *ClaimCache) RemoveFromQueue(ctx context.Context, queue string, claimID string) error {
	queueKey := c.CacheKey("queue", queue)
	return c.client.SRem(ctx, queueKey, claimID).Err()
}

// GetAllQueueStats returns counts for all queues
func (c *ClaimCache) GetAllQueueStats(ctx context.Context) ([]models.QueueStats, error) {
	queues := []string{"supervisor_queue", "executive_review_queue", "fraud_investigation_queue"}
	stats := make([]models.QueueStats, 0)

	for _, queue := range queues {
		queueKey := c.CacheKey("queue", queue)
		count, err := c.client.SCard(ctx, queueKey).Result()
		if err != nil && err != redis.Nil {
			c.logger.Error("Failed to get queue count", zap.String("queue", queue), zap.Error(err))
			continue
		}

		stats = append(stats, models.QueueStats{
			QueueName:    queue,
			PendingCount: int(count),
			AvgWaitTime:  "N/A",
		})
	}

	return stats, nil
}

// GetPolicyClaimCount returns the number of claims for a policy in the last 24h
func (c *ClaimCache) GetPolicyClaimCount(ctx context.Context, policyID string) (int, error) {
	key := c.CacheKey("policy", policyID, "claim_count")
	count, err := c.client.Get(ctx, key).Int()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("failed to get policy claim count: %w", err)
	}
	return count, nil
}

// IncrementPolicyClaimCount increments the claim count for a policy
func (c *ClaimCache) IncrementPolicyClaimCount(ctx context.Context, policyID string, maxCount int) (int, error) {
	key := c.CacheKey("policy", policyID, "claim_count")

	pipe := c.client.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, 1*time.Hour)
	_, err := pipe.Exec(ctx)
	if err != nil {
		return 0, fmt.Errorf("failed to increment policy claim count: %w", err)
	}

	count, _ := incr.Result()
	if count > int64(maxCount) {
		return int(count), fmt.Errorf("rate limit exceeded: max %d claims per policy per hour", maxCount)
	}

	return int(count), nil
}

// SetRateLimitFlag sets a rate limit flag for a policy within a time window
func (c *ClaimCache) SetRateLimitFlag(ctx context.Context, policyID string, window time.Duration) error {
	key := c.CacheKey("policy", policyID, "rate_limit")
	return c.client.Set(ctx, key, "1", window).Err()
}

// HasRateLimitFlag checks if a rate limit flag exists
func (c *ClaimCache) HasRateLimitFlag(ctx context.Context, policyID string) (bool, error) {
	key := c.CacheKey("policy", policyID, "rate_limit")
	exists, err := c.client.Exists(ctx, key).Result()
	return exists > 0, err
}

// CacheAdjudicationResult caches an adjudication result
func (c *ClaimCache) CacheAdjudicationResult(ctx context.Context, claimID string, decision string) error {
	cacheKey := c.CacheKey("adjudication", claimID, "last_decision")
	return c.client.Set(ctx, cacheKey, decision, c.ttl).Err()
}

// GetLastDecision retrieves the last decision for a claim
func (c *ClaimCache) GetLastDecision(ctx context.Context, claimID string) (string, error) {
	cacheKey := c.CacheKey("adjudication", claimID, "last_decision")
	decision, err := c.client.Get(ctx, cacheKey).Result()
	if err == redis.Nil {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return decision, nil
}
